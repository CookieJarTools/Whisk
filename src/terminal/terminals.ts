import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { create } from 'zustand'
import { ipc } from '../lib/ipc'
import { useStore } from '../store/store'
import { usePanel } from '../store/panel'

/**
 * Terminal sessions. Each has an xterm.js screen kept alive outside React (so
 * hiding the panel or switching tabs never loses scrollback) and a
 * pseudo-terminal in Rust running a shell or a program.
 */

export interface TerminalInfo {
  id: number
  title: string
  /** Set once the shell or program has ended. */
  exitCode?: number | null
  /** Program runs (from run configurations) rather than an interactive shell. */
  kind: 'shell' | 'run'
}

interface Session {
  term: Terminal
  fit: FitAddon
  ptyId: number | null
}

interface TerminalsState {
  terminals: TerminalInfo[]
  active: number | null
}

export const useTerminals = create<TerminalsState>(() => ({ terminals: [], active: null }))

const sessions = new Map<number, Session>()
const byPty = new Map<number, number>()
const exitListeners = new Map<number, (code: number | null) => void>()
let nextId = 1

function cssVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

function theme() {
  return {
    background: cssVar('--bg', '#0f1011'),
    foreground: cssVar('--text', '#eeeff1'),
    cursor: cssVar('--accent', '#6e79d6'),
    selectionBackground: 'rgba(110, 121, 214, 0.35)',
    black: '#1f2023',
    red: cssVar('--del', '#eb5757'),
    green: cssVar('--add', '#4cb782'),
    yellow: '#d6b656',
    blue: cssVar('--info', '#4ea7fc'),
    magenta: '#b884e0',
    cyan: '#3fb5b5',
    white: cssVar('--text-dim', '#9c9ea5'),
    brightBlack: cssVar('--text-faint', '#686a71'),
    brightRed: '#f07a7a',
    brightGreen: '#6fd19f',
    brightYellow: '#e8cb76',
    brightBlue: '#7cbcfd',
    brightMagenta: '#cda3ea',
    brightCyan: '#66cccc',
    brightWhite: '#ffffff'
  }
}

let listening: Promise<void> | null = null

function listenOnce(): Promise<void> {
  listening ??= (async () => {
    await listen<{ id: number; data: string }>('pty-output', (e) => {
      const id = byPty.get(e.payload.id)
      if (id !== undefined) sessions.get(id)?.term.write(e.payload.data)
    })
    await listen<{ id: number; code: number | null }>('pty-exit', (e) => {
      const id = byPty.get(e.payload.id)
      if (id === undefined) return
      byPty.delete(e.payload.id)
      const session = sessions.get(id)
      if (session) {
        session.ptyId = null
        const code = e.payload.code
        session.term.write(`\r\n\x1b[90m${code === 0 || code === null ? 'Process finished' : `Process exited with code ${code}`}\x1b[0m\r\n`)
      }
      useTerminals.setState((s) => ({ terminals: s.terminals.map((t) => (t.id === id ? { ...t, exitCode: e.payload.code } : t)) }))
      exitListeners.get(id)?.(e.payload.code)
      exitListeners.delete(id)
    })
  })()
  return listening
}

function fontSize(): number {
  return Math.max(11, Math.round(Number.parseFloat(cssVar('--editor-font-size', '13px')) - 1))
}

export interface TerminalOptions {
  title?: string
  cwd?: string
  /** A program to run instead of the shell. */
  program?: string
  args?: string[]
  /** A command line for the shell to run (instead of an interactive shell). */
  commandLine?: string
  env?: Record<string, string>
  kind?: TerminalInfo['kind']
  /** Called when the program or shell ends. */
  onExit?: (code: number | null) => void
}

/** Opens a terminal in the bottom panel and starts its shell (or program). */
export async function openTerminal(options: TerminalOptions = {}): Promise<number> {
  await listenOnce()
  const id = nextId++
  const term = new Terminal({
    fontFamily: cssVar('--font-mono', 'monospace'),
    fontSize: fontSize(),
    lineHeight: 1.25,
    cursorBlink: true,
    scrollback: 10000,
    allowProposedApi: true,
    theme: theme()
  })
  const fit = new FitAddon()
  term.loadAddon(fit)
  const session: Session = { term, fit, ptyId: null }
  sessions.set(id, session)

  // Ctrl+C copies when text is selected (and interrupts otherwise); Ctrl+V pastes.
  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown' || !e.ctrlKey || e.altKey) return true
    const key = e.key.toLowerCase()
    if (key === 'c' && term.hasSelection()) {
      void ipc.copyText(term.getSelection())
      term.clearSelection()
      return false
    }
    if (key === 'v') {
      void ipc.pasteText().then((text) => text && term.paste(text))
      return false
    }
    return true
  })
  term.onData((data) => {
    if (session.ptyId !== null) void invoke('pty_write', { id: session.ptyId, data }).catch(() => {})
  })
  term.onResize(({ cols, rows }) => {
    if (session.ptyId !== null) void invoke('pty_resize', { id: session.ptyId, cols, rows }).catch(() => {})
  })
  if (options.onExit) exitListeners.set(id, options.onExit)

  const kind = options.kind ?? 'shell'
  useTerminals.setState((s) => ({
    terminals: [...s.terminals, { id, title: options.title ?? `Terminal ${s.terminals.filter((t) => t.kind === 'shell').length + 1}`, kind }],
    active: id
  }))
  if (kind === 'shell') usePanel.getState().show('terminal')

  try {
    const ptyId = await invoke<number>('pty_spawn', {
      cwd: options.cwd ?? useStore.getState().root ?? '.',
      program: options.program ?? null,
      args: options.args ?? [],
      commandLine: options.commandLine ?? null,
      env: options.env ?? null,
      cols: term.cols,
      rows: term.rows
    })
    session.ptyId = ptyId
    byPty.set(ptyId, id)
    // The screen may have been sized while the shell was starting.
    void invoke('pty_resize', { id: ptyId, cols: term.cols, rows: term.rows }).catch(() => {})
  } catch (e) {
    term.write(`\x1b[31m${String(e)}\x1b[0m\r\n`)
    useTerminals.setState((s) => ({ terminals: s.terminals.map((t) => (t.id === id ? { ...t, exitCode: -1 } : t)) }))
    exitListeners.get(id)?.(-1)
    exitListeners.delete(id)
  }
  return id
}

/** Puts a terminal's screen into `parent` (creating it the first time) and sizes it to fit. */
export function attachTerminal(id: number, parent: HTMLElement) {
  const session = sessions.get(id)
  if (!session) return
  if (!session.term.element) session.term.open(parent)
  else if (session.term.element.parentElement !== parent) parent.appendChild(session.term.element)
  fitTerminal(id)
}

export function fitTerminal(id: number) {
  const session = sessions.get(id)
  if (!session?.term.element?.isConnected) return
  try {
    session.fit.fit()
  } catch {
    // Not laid out yet (hidden panel); the next resize fits it.
  }
}

export function focusTerminal(id: number) {
  sessions.get(id)?.term.focus()
}

/** Stops whatever the terminal is running, keeping its output. */
export function stopTerminal(id: number) {
  const ptyId = sessions.get(id)?.ptyId
  if (ptyId != null) void invoke('pty_kill', { id: ptyId })
}

export function closeTerminal(id: number) {
  const kind = useTerminals.getState().terminals.find((t) => t.id === id)?.kind
  stopTerminal(id)
  const session = sessions.get(id)
  session?.term.dispose()
  sessions.delete(id)
  exitListeners.delete(id)
  useTerminals.setState((s) => {
    const terminals = s.terminals.filter((t) => t.id !== id)
    const active = s.active === id ? (terminals[terminals.length - 1]?.id ?? null) : s.active
    return { terminals, active }
  })
  // Closing the last shell hides the panel rather than starting a new one.
  const panel = usePanel.getState()
  if (kind === 'shell' && panel.view === 'terminal' && !useTerminals.getState().terminals.some((t) => t.kind === 'shell')) panel.close()
}

export function clearTerminal(id: number) {
  sessions.get(id)?.term.clear()
}

/** Types text into a terminal as if the user had (used to send commands to a shell). */
export function sendToTerminal(id: number, text: string) {
  const ptyId = sessions.get(id)?.ptyId
  if (ptyId != null) void invoke('pty_write', { id: ptyId, data: text })
}

/** Keeps terminals in step with the editor font size. */
export function refreshTerminalFonts() {
  for (const [id, session] of sessions) {
    session.term.options.fontSize = fontSize()
    fitTerminal(id)
  }
}
