import { create } from 'zustand'
import { ipc } from '../lib/ipc'
import { baseName, samePath } from '../lib/paths'
import { isMarkdown } from '../lib/languages'

/** Tabs of Search Everywhere, plus the single-purpose popups that share its window. */
export type SearchMode = 'all' | 'types' | 'files' | 'symbols' | 'actions' | 'text' | 'structure' | 'line' | 'recent'

export type MarkdownMode = 'edit' | 'split' | 'preview'
export type ServerState = 'starting' | 'ready' | 'missing' | 'failed' | 'stopped'

export interface Tab {
  path: string
  name: string
  /** Contents when the tab was opened; the live text lives in the tab's EditorView. */
  initialText: string
  /** Which side of a split it's in (left when unset). */
  pane?: Pane
  /** Set for a side-by-side comparison rather than a file. */
  diff?: DiffSpec
}

export type Pane = 0 | 1

/** Two texts compared side by side. The right one is a file on disk when `path` is set. */
export interface DiffSpec {
  leftTitle: string
  left: string
  rightTitle: string
  right: string
  path?: string
}

export const isFileTab = (t: Tab) => !t.diff

/**
 * Keeps each pane's active tab pointing at a tab in that pane, falls back to
 * the other pane when the focused one empties, and derives `active`.
 */
export function settlePanes(tabs: Tab[], paneActive: [string | null, string | null], focused: Pane) {
  const settled: [string | null, string | null] = [null, null]
  for (const p of [0, 1] as Pane[]) {
    const own = tabs.filter((t) => (t.pane ?? 0) === p)
    settled[p] = own.some((t) => t.path === paneActive[p]) ? paneActive[p] : (own[0]?.path ?? null)
  }
  // The right pane closes when it has nothing left; its neighbour takes over.
  let focusedPane: Pane = settled[focused] ? focused : focused === 1 ? 0 : 1
  if (!settled[focusedPane]) focusedPane = 0
  return { paneActive: settled, focusedPane, active: settled[focusedPane] }
}

/** The tab next to `path` within its pane, for when it closes. */
function neighbour(tabs: Tab[], path: string): string | null {
  const tab = tabs.find((t) => t.path === path)
  const own = tabs.filter((t) => (t.pane ?? 0) === (tab?.pane ?? 0))
  const i = own.findIndex((t) => t.path === path)
  return (own[i + 1] ?? own[i - 1])?.path ?? null
}

export interface Toast {
  id: number
  message: string
  kind: 'info' | 'success' | 'error'
}

export interface MenuItem {
  label?: string
  hint?: string
  type?: 'divider' | 'header'
  onSelect?: () => void
}

export interface Problems {
  errors: number
  warnings: number
  infos: number
}

export interface CursorInfo {
  line: number
  col: number
  /** Declarations around the cursor, outermost first; depth picks the lane colour. */
  crumbs: { name: string; depth: number }[]
}

interface State {
  root: string | null
  recent: string[]
  expanded: Record<string, boolean>
  tabs: Tab[]
  /** The focused pane's active tab. */
  active: string | null
  /** Each pane's active tab; the right one is null when the editor isn't split. */
  paneActive: [string | null, string | null]
  focusedPane: Pane
  dirty: Record<string, boolean>
  cursor: CursorInfo | null
  /** Problem counts per open file, from Whisk's rules and the language server. */
  problems: Record<string, Problems>
  markdownMode: MarkdownMode
  markdownText: Record<string, string>
  servers: Record<string, { state: ServerState; message?: string }>
  palette: { open: boolean; mode: SearchMode; query: string }
  menu: { x: number; y: number; items: MenuItem[] } | null
  toasts: Toast[]
  showHidden: boolean
  treeVersion: number
  sidebarWidth: number
  settingsOpen: boolean
  /** Which Settings page to show when it opens. */
  settingsSection: string | null
  wizardOpen: boolean

  openFolder(path: string): void
  closeFolder(): void
  toggleDir(path: string): void
  openFile(path: string): Promise<boolean>
  closeTab(path: string): void
  setActive(path: string): void
  /** Moves a tab to the left or right pane, splitting the editor if needed. */
  moveToPane(path: string, pane: Pane): void
  focusPane(pane: Pane): void
  /** Opens (or replaces) a side-by-side comparison tab. */
  openDiff(key: string, title: string, spec: DiffSpec): void
  setDirty(path: string, dirty: boolean): void
  setCursor(cursor: CursorInfo | null): void
  setProblems(path: string, problems: Problems): void
  setMarkdownMode(mode: MarkdownMode): void
  setMarkdownText(path: string, text: string): void
  setServer(key: string, state: ServerState, message?: string): void
  openPalette(mode?: SearchMode, query?: string): void
  closePalette(): void
  openMenu(x: number, y: number, items: MenuItem[]): void
  closeMenu(): void
  toast(message: string, kind?: Toast['kind']): void
  setShowHidden(show: boolean): void
  refreshTree(): void
  setSidebarWidth(width: number): void
  setSettingsOpen(open: boolean, section?: string): void
  setWizardOpen(open: boolean): void
  expandTo(paths: string[]): void
}

const RECENT_KEY = 'whisk.recent'
const ROOT_KEY = 'whisk.root'
const HIDDEN_KEY = 'whisk.showHidden'
const SIDEBAR_KEY = 'whisk.sidebarWidth'

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function saveJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage can be unavailable; the app works without it.
  }
}

let nextToastId = 1

/** `\\?\F:\Dev` → `F:\Dev`: Windows long-path form confuses path comparisons and language servers. */
function withoutLongPathPrefix(path: string): string {
  return path.startsWith('\\\\?\\') ? path.slice(4) : path
}

export const useStore = create<State>((set, get) => ({
  root: ((r) => (r ? withoutLongPathPrefix(r) : null))(loadJson<string | null>(ROOT_KEY, null)),
  recent: loadJson<string[]>(RECENT_KEY, []),
  expanded: {},
  tabs: [],
  active: null,
  paneActive: [null, null],
  focusedPane: 0,
  dirty: {},
  cursor: null,
  problems: {},
  markdownMode: 'split',
  markdownText: {},
  servers: {},
  palette: { open: false, mode: 'all', query: '' },
  menu: null,
  toasts: [],
  showHidden: loadJson<boolean>(HIDDEN_KEY, false),
  treeVersion: 0,
  sidebarWidth: loadJson<number>(SIDEBAR_KEY, 260),
  settingsOpen: false,
  settingsSection: null,
  wizardOpen: false,

  openFolder(rawPath) {
    const path = withoutLongPathPrefix(rawPath)
    const recent = [path, ...get().recent.filter((p) => !samePath(p, path)).map(withoutLongPathPrefix)].slice(0, 8)
    saveJson(RECENT_KEY, recent)
    saveJson(ROOT_KEY, path)
    set({ root: path, recent, expanded: { [path]: true }, tabs: [], active: null, paneActive: [null, null], focusedPane: 0, dirty: {}, cursor: null })
  },

  closeFolder() {
    saveJson(ROOT_KEY, null)
    set({ root: null, tabs: [], active: null, paneActive: [null, null], focusedPane: 0, dirty: {}, cursor: null })
  },

  toggleDir(path) {
    set((s) => ({ expanded: { ...s.expanded, [path]: !s.expanded[path] } }))
  },

  async openFile(path) {
    const existing = get().tabs.find((t) => samePath(t.path, path))
    if (existing) {
      get().setActive(existing.path)
      return true
    }
    try {
      const text = await ipc.readText(path)
      set((s) => {
        const tab: Tab = { path, name: baseName(path), initialText: text, pane: s.focusedPane }
        const paneActive: [string | null, string | null] = [...s.paneActive]
        paneActive[s.focusedPane] = path
        const tabs = [...s.tabs, tab]
        return {
          tabs,
          ...settlePanes(tabs, paneActive, s.focusedPane),
          markdownText: isMarkdown(path) ? { ...s.markdownText, [path]: text } : s.markdownText
        }
      })
      return true
    } catch (e) {
      get().toast(String(e), 'error')
      return false
    }
  },

  closeTab(path) {
    set((s) => {
      const tab = s.tabs.find((t) => t.path === path)
      const paneActive: [string | null, string | null] = [...s.paneActive]
      const pane = tab?.pane ?? 0
      if (paneActive[pane] === path) paneActive[pane] = neighbour(s.tabs, path)
      const tabs = s.tabs.filter((t) => t.path !== path)
      const dirty = { ...s.dirty }
      delete dirty[path]
      const settled = settlePanes(tabs, paneActive, s.focusedPane)
      return { tabs, ...settled, dirty, cursor: settled.active ? s.cursor : null }
    })
  },

  setActive: (path) =>
    set((s) => {
      const pane = s.tabs.find((t) => t.path === path)?.pane ?? 0
      const paneActive: [string | null, string | null] = [...s.paneActive]
      paneActive[pane] = path
      return settlePanes(s.tabs, paneActive, pane)
    }),

  moveToPane: (path, pane) =>
    set((s) => {
      const tab = s.tabs.find((t) => t.path === path)
      if (!tab || (tab.pane ?? 0) === pane) return s
      const paneActive: [string | null, string | null] = [...s.paneActive]
      const from = tab.pane ?? 0
      if (paneActive[from] === path) paneActive[from] = neighbour(s.tabs, path)
      paneActive[pane] = path
      const tabs = s.tabs.map((t) => (t.path === path ? { ...t, pane } : t))
      return { tabs, ...settlePanes(tabs, paneActive, pane) }
    }),

  focusPane: (pane) => set((s) => (s.paneActive[pane] ? settlePanes(s.tabs, s.paneActive, pane) : s)),

  openDiff(key, title, spec) {
    set((s) => {
      const path = `diff:${key}`
      const tab: Tab = { path, name: title, initialText: '', diff: spec, pane: s.focusedPane }
      const exists = s.tabs.some((t) => t.path === path)
      const tabs = exists ? s.tabs.map((t) => (t.path === path ? { ...tab, pane: t.pane } : t)) : [...s.tabs, tab]
      const paneActive: [string | null, string | null] = [...s.paneActive]
      const pane = tabs.find((t) => t.path === path)!.pane ?? 0
      paneActive[pane] = path
      return { tabs, ...settlePanes(tabs, paneActive, pane) }
    })
  },
  setDirty: (path, dirty) => set((s) => (s.dirty[path] === dirty ? s : { dirty: { ...s.dirty, [path]: dirty } })),
  setCursor: (cursor) => set({ cursor }),
  setProblems: (path, problems) => set((s) => ({ problems: { ...s.problems, [path]: problems } })),
  setMarkdownMode: (mode) => set({ markdownMode: mode }),
  setMarkdownText: (path, text) => set((s) => ({ markdownText: { ...s.markdownText, [path]: text } })),
  setServer: (key, state, message) => set((s) => ({ servers: { ...s.servers, [key]: { state, message } } })),
  openPalette: (mode = 'all', query = '') => set({ palette: { open: true, mode, query } }),
  closePalette: () => set((s) => ({ palette: { ...s.palette, open: false } })),
  openMenu: (x, y, items) => set({ menu: { x, y, items } }),
  closeMenu: () => set({ menu: null }),

  toast(message, kind = 'info') {
    const id = nextToastId++
    set((s) => ({ toasts: [...s.toasts, { id, message, kind }] }))
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), kind === 'error' ? 8000 : 5000)
  },

  setShowHidden(show) {
    saveJson(HIDDEN_KEY, show)
    set({ showHidden: show })
  },
  refreshTree: () => set((s) => ({ treeVersion: s.treeVersion + 1 })),
  setSettingsOpen: (open, section) => set({ settingsOpen: open, settingsSection: section ?? null }),
  setWizardOpen: (open) => set({ wizardOpen: open }),
  setSidebarWidth(width) {
    saveJson(SIDEBAR_KEY, width)
    set({ sidebarWidth: width })
  },
  expandTo(paths) {
    set((s) => (paths.every((p) => s.expanded[p]) ? s : { expanded: { ...s.expanded, ...Object.fromEntries(paths.map((p) => [p, true])) } }))
  }
}))
