import { create } from 'zustand'
import { hoverTooltip, type EditorView } from '@codemirror/view'
import { useStore } from '../store/store'
import { usePanel } from '../store/panel'
import { relativePath } from '../lib/paths'
import { getView, revealLine, whenView } from '../editor/views'
import { saveAllDirty } from '../editor/autoSave'
import type { RunConfig } from '../run/configs'
import { openTerminal } from '../terminal/terminals'
import { DapClient } from './dap'
import { adapterFor, customDebuggerFor } from './adapters'
import { fileKey, setExecLine, useBreakpoints } from './breakpoints'

/**
 * The debug session: starts the adapter for a run configuration, sends it the
 * breakpoints, and keeps the panel up to date as the program stops and runs.
 */

export interface Frame {
  id: number
  name: string
  path?: string
  line: number
  column: number
}

export interface Variable {
  name: string
  value: string
  type?: string
  variablesReference: number
}

export interface ConsoleLine {
  kind: 'out' | 'err' | 'info' | 'input' | 'result' | 'error'
  text: string
}

type Status = 'idle' | 'starting' | 'running' | 'paused'

interface DebugState {
  state: Status
  config: RunConfig | null
  threads: { id: number; name: string }[]
  threadId: number | null
  frames: Frame[]
  frameId: number | null
  scopes: { name: string; variablesReference: number; expensive?: boolean }[]
  /** Loaded children by variablesReference. */
  children: Record<number, Variable[]>
  console: ConsoleLine[]
  stopReason: string | null
  stop(): void
}

export const useDebug = create<DebugState>(() => ({
  state: 'idle',
  config: null,
  threads: [],
  threadId: null,
  frames: [],
  frameId: null,
  scopes: [],
  children: {},
  console: [],
  stopReason: null,
  stop: () => void stopDebugging()
}))

let client: DapClient | null = null
let capabilities: any = {}
let execPath: string | null = null
/** Which file each breakpoint the adapter numbered is in, for its later "breakpoint" events. */
const breakpointFiles = new Map<number, { path: string; line: number }>()
const MAX_CONSOLE = 5000

function print(kind: ConsoleLine['kind'], text: string) {
  useDebug.setState((s) => {
    const lines = [...s.console, ...text.replace(/\r?\n$/, '').split(/\r?\n/).map((t) => ({ kind, text: t }))]
    return { console: lines.length > MAX_CONSOLE ? lines.slice(-MAX_CONSOLE) : lines }
  })
}

function clearExecLine() {
  if (!execPath) return
  getView(execPath)?.dispatch({ effects: setExecLine.of(null) })
  execPath = null
}

async function showExecLine(path: string, line: number) {
  clearExecLine()
  if (!(await useStore.getState().openFile(path))) return
  const view = await whenView(path)
  if (!view) return
  const pos = view.state.doc.line(Math.min(Math.max(1, line), view.state.doc.lines)).from
  view.dispatch({ effects: setExecLine.of(pos) })
  execPath = path
  revealLine(path, line)
}

/** Sends one file's breakpoints, and records which ones the debugger accepted. */
async function sendBreakpoints(path: string, points: { line: number; condition?: string }[]) {
  if (!client) return
  try {
    const body = await client.request('setBreakpoints', {
      source: { path, name: path.split(/[\\/]/).pop() },
      breakpoints: points.map((p) => ({ line: p.line, ...(p.condition ? { condition: p.condition } : {}) })),
      lines: points.map((p) => p.line),
      sourceModified: false
    })
    const returned: any[] = body.breakpoints ?? []
    returned.forEach((b, i) => {
      if (typeof b.id === 'number') breakpointFiles.set(b.id, { path, line: b.line ?? points[i]?.line })
    })
    const verified = returned.map((b, i) => (b.verified ? (b.line ?? points[i]?.line) : null)).filter((n: number | null) => n !== null)
    useBreakpoints.setState((s) => ({ verified: { ...s.verified, [fileKey(path)]: verified } }))
  } catch (e) {
    print('error', `Couldn’t set breakpoints in ${path}: ${e instanceof Error ? e.message : e}`)
  }
}

async function sendAllBreakpoints() {
  for (const { path, points } of Object.values(useBreakpoints.getState().byFile)) await sendBreakpoints(path, points)
}

async function loadScopes(frameId: number) {
  if (!client) return
  const body = await client.request('scopes', { frameId }).catch(() => ({ scopes: [] }))
  const scopes = (body.scopes ?? []).map((s: any) => ({ name: s.name, variablesReference: s.variablesReference, expensive: s.expensive }))
  useDebug.setState({ scopes, children: {} })
  // Open the first (usually "Locals") straight away.
  const first = scopes.find((s: any) => !s.expensive)
  if (first) await loadChildren(first.variablesReference)
}

export async function loadChildren(ref: number) {
  if (!client || ref <= 0 || useDebug.getState().children[ref]) return
  const body = await client.request('variables', { variablesReference: ref }).catch(() => ({ variables: [] }))
  const vars: Variable[] = (body.variables ?? []).map((v: any) => ({ name: v.name, value: v.value, type: v.type, variablesReference: v.variablesReference ?? 0 }))
  useDebug.setState((s) => ({ children: { ...s.children, [ref]: vars } }))
}

export async function selectFrame(frame: Frame) {
  useDebug.setState({ frameId: frame.id })
  if (frame.path) void showExecLine(frame.path, frame.line)
  await loadScopes(frame.id)
}

async function onStopped(body: any) {
  if (!client) return
  const threads = await client.request('threads').then((b) => b.threads ?? []).catch(() => [])
  const threadId = body.threadId ?? useDebug.getState().threadId ?? threads[0]?.id ?? null
  useDebug.setState({ state: 'paused', threads, threadId, stopReason: body.description ?? body.reason ?? null })
  if (body.reason === 'exception') print('error', `Stopped on an exception${body.text ? `: ${body.text}` : ''}`)
  if (threadId === null) return
  const stack = await client.request('stackTrace', { threadId, startFrame: 0, levels: 50 }).catch(() => ({ stackFrames: [] }))
  const frames: Frame[] = (stack.stackFrames ?? []).map((f: any) => ({ id: f.id, name: f.name, path: f.source?.path, line: f.line, column: f.column }))
  useDebug.setState({ frames })
  usePanel.getState().show('debug')
  const top = frames.find((f) => f.path) ?? frames[0]
  if (top) await selectFrame(top)
}

function onEvent(event: string, body: any) {
  switch (event) {
    case 'output':
      if (body.category !== 'telemetry') print(body.category === 'stderr' ? 'err' : body.category === 'console' ? 'info' : 'out', body.output ?? '')
      break
    case 'stopped':
      void onStopped(body)
      break
    case 'continued':
      clearExecLine()
      useDebug.setState({ state: 'running', frames: [], scopes: [], children: {}, stopReason: null })
      break
    case 'exited':
      print('info', `Program exited with code ${body.exitCode}`)
      break
    case 'terminated':
      void endSession()
      break
    case 'breakpoint': {
      // Adapters confirm pending breakpoints later, often by id alone.
      const b = body.breakpoint
      const known = typeof b?.id === 'number' ? breakpointFiles.get(b.id) : undefined
      const path = b?.source?.path ?? known?.path
      const line = b?.line ?? known?.line
      if (path && b.verified && line) {
        const key = fileKey(path)
        useBreakpoints.setState((s) => ({ verified: { ...s.verified, [key]: [...new Set([...(s.verified[key] ?? []), line])] } }))
      }
      break
    }
  }
}

async function onReverseRequest(command: string, args: any): Promise<unknown> {
  if (command === 'runInTerminal') {
    const [program, ...rest] = args.args ?? []
    await openTerminal({ kind: 'run', title: args.title ?? 'Debug', cwd: args.cwd, program, args: rest, env: args.env ?? undefined })
    return {}
  }
  throw new Error(`Whisk doesn’t support ${command} yet`)
}

/** Waits for an event from the adapter, or gives up after `ms`. */
function waitForEvent(name: string, ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const previous = onEventHook
    const timer = setTimeout(() => {
      onEventHook = previous
      reject(new Error(`The debugger didn’t start (no ${name} after ${ms / 1000}s)`))
    }, ms)
    onEventHook = (event) => {
      if (event !== name) return
      clearTimeout(timer)
      onEventHook = previous
      resolve()
    }
  })
}
let onEventHook: (event: string) => void = () => {}

/** Stop on exceptions nothing catches, as Rider does: the adapter's defaults, or its "unhandled" filter. */
function exceptionFilters(): string[] {
  const all: { filter: string; default?: boolean }[] = capabilities.exceptionBreakpointFilters ?? []
  const defaults = all.filter((f) => f.default).map((f) => f.filter)
  if (defaults.length) return defaults
  const unhandled = all.find((f) => /^(user-)?unhandled$|^uncaught$/.test(f.filter))
  return unhandled ? [unhandled.filter] : []
}

/** Fills in what "Current file" needs to debug with a custom debugger. */
function withDebugInfo(config: RunConfig): RunConfig {
  if (config.debug || config.id !== 'current-file') return config
  const { root, active } = useStore.getState()
  const custom = active ? customDebuggerFor(active) : undefined
  if (!custom || !root || !active) return config
  return { ...config, debug: { type: custom.id, program: relativePath(root, active) } }
}

export async function startDebugging(original: RunConfig) {
  const root = useStore.getState().root
  if (!root || useDebug.getState().state !== 'idle') return
  const config = withDebugInfo(original)
  const adapter = config.debug && adapterFor(config.debug.type)
  if (!config.debug || !adapter) {
    useStore.getState().toast(`Whisk can’t debug “${config.name}” yet. You can add a debugger for it in Settings › Debuggers.`)
    return
  }
  const resolved = await adapter.resolve()
  if (!resolved) {
    useStore.getState().toast(`Debugging needs ${adapter.label}. Install it in Settings › Debuggers.`, 'error')
    useStore.getState().setSettingsOpen(true, 'debuggers')
    return
  }

  await saveAllDirty()
  useDebug.setState({ state: 'starting', config, console: [], frames: [], scopes: [], children: {}, threads: [], stopReason: null })
  usePanel.getState().show('debug')
  print('info', `Debugging ${config.name} with ${adapter.label}`)

  try {
    const launch = await adapter.prepare(config, { root, log: (line) => print('out', line) })
    client = await DapClient.start(resolved.command, resolved.args, root)
    client.onEvent = (event, body) => {
      onEventHook(event)
      onEvent(event, body)
    }
    client.onReverseRequest = onReverseRequest
    client.onExit = () => void endSession()
    // Listen before asking, as some adapters send "initialized" right behind their answer.
    const initialized = waitForEvent('initialized', 20000)
    initialized.catch(() => {})
    capabilities = await client.request('initialize', {
      clientID: 'whisk',
      clientName: 'Whisk',
      adapterID: config.debug.type,
      linesStartAt1: true,
      columnsStartAt1: true,
      pathFormat: 'path',
      supportsVariableType: true,
      supportsRunInTerminalRequest: true,
      locale: 'en-GB'
    })
    // Adapters answer launch only after configuration is done, so don't wait on it here.
    const launched = client.request('launch', { name: config.name, ...launch })
    launched.catch(() => {})
    await Promise.race([initialized, launched.then(() => initialized)])
    await sendAllBreakpoints()
    await client.request('setExceptionBreakpoints', { filters: exceptionFilters() }).catch(() => {})
    if (capabilities.supportsConfigurationDoneRequest) await client.request('configurationDone')
    await launched
    if (useDebug.getState().state === 'starting') useDebug.setState({ state: 'running' })
  } catch (e) {
    print('error', e instanceof Error ? e.message : String(e))
    await endSession()
  }
}

async function endSession() {
  if (useDebug.getState().state === 'idle' && !client) return
  const c = client
  client = null
  c?.dispose()
  clearExecLine()
  useBreakpoints.setState({ verified: {} })
  breakpointFiles.clear()
  useDebug.setState({ state: 'idle', frames: [], scopes: [], children: {}, threads: [], threadId: null, frameId: null, stopReason: null })
  print('info', 'Debugging stopped')
}

export async function stopDebugging() {
  if (!client) return endSession()
  const c = client
  // Ask nicely, but don't wait long for an adapter that's stuck.
  // Attached sessions (Unity) detach; anything Whisk started is ended.
  const terminateDebuggee = !adapterFor(useDebug.getState().config?.debug?.type ?? '')?.attach
  await Promise.race([c.request('disconnect', { terminateDebuggee }).catch(() => {}), new Promise((r) => setTimeout(r, 2000))])
  await endSession()
}

export async function restartDebugging() {
  const config = useDebug.getState().config
  await stopDebugging()
  if (config) await startDebugging(config)
}

function step(command: 'continue' | 'next' | 'stepIn' | 'stepOut') {
  const { threadId, state } = useDebug.getState()
  if (!client || state !== 'paused' || threadId === null) return
  clearExecLine()
  useDebug.setState({ state: 'running', frames: [], scopes: [], children: {} })
  void client.request(command, { threadId }).catch((e) => print('error', String(e)))
}

export const resume = () => step('continue')
export const stepOver = () => step('next')
export const stepInto = () => step('stepIn')
export const stepOut = () => step('stepOut')

export function pause() {
  const { threadId, threads } = useDebug.getState()
  if (client && useDebug.getState().state === 'running') void client.request('pause', { threadId: threadId ?? threads[0]?.id ?? 0 }).catch(() => {})
}

export async function evaluate(expression: string): Promise<void> {
  print('input', expression)
  if (!client) return print('error', 'Not debugging.')
  try {
    const body = await client.request('evaluate', { expression, frameId: useDebug.getState().frameId ?? undefined, context: 'repl' })
    print('result', body.result ?? '')
  } catch (e) {
    print('error', e instanceof Error ? e.message : String(e))
  }
}

export const isPaused = () => useDebug.getState().state === 'paused'
export const isDebugging = () => useDebug.getState().state !== 'idle'

/** While paused, hovering a name shows its value. */
export const debugHover = hoverTooltip(async (view: EditorView, pos: number) => {
  if (!client || !isPaused()) return null
  const word = view.state.wordAt(pos)
  if (!word) return null
  // Include member access to the left (player.health), as debuggers expect.
  let from = word.from
  while (from > 0 && /[\w.]/.test(view.state.sliceDoc(from - 1, from))) from--
  const expression = view.state.sliceDoc(from, word.to).replace(/^\.+/, '')
  const body = await client
    .request('evaluate', { expression, frameId: useDebug.getState().frameId ?? undefined, context: 'hover' })
    .catch(() => null)
  if (!body?.result) return null
  return {
    pos: from,
    end: word.to,
    above: true,
    create() {
      const dom = document.createElement('div')
      dom.className = 'cm-debug-hover'
      const name = document.createElement('span')
      name.className = 'cm-debug-hover-name'
      name.textContent = `${expression} = `
      dom.append(name, body.result)
      return { dom }
    }
  }
})

let installed = false

/** Breakpoints added or moved while debugging are sent straight away. */
export function installDebug() {
  if (installed) return
  installed = true
  useBreakpoints.subscribe((s, prev) => {
    if (!client || s.byFile === prev.byFile) return
    const keys = new Set([...Object.keys(s.byFile), ...Object.keys(prev.byFile)])
    for (const key of keys) {
      if (s.byFile[key] === prev.byFile[key]) continue
      const path = s.byFile[key]?.path ?? prev.byFile[key]?.path
      if (path) void sendBreakpoints(path, s.byFile[key]?.points ?? [])
    }
  })
}
