import { ipc } from '../lib/ipc'
import { samePath } from '../lib/paths'
import { isFileTab, useStore, type Tab } from '../store/store'
import { useSettings } from '../store/settings'
import { getView, revealLine } from './views'

/**
 * Remembers each project's open tabs, the active one and the cursor in each,
 * and reopens them next time that folder is opened. Kept in localStorage per
 * folder, saved as tabs change and when Whisk closes.
 */

export interface SavedTab {
  path: string
  /** 1-based. */
  line: number
  col: number
  /** Set when it was in the right-hand pane. */
  pane?: 1
}

export interface Session {
  tabs: SavedTab[]
  active: string | null
}

const SAVE_DELAY_MS = 400

const keyFor = (root: string) => `whisk.session.${root.replace(/\\/g, '/').toLowerCase()}`

/** True while a session is being reopened, so the half-restored tab list isn't saved over it. */
let restoring = false

function sessionOf(tabs: Tab[], active: string | null): Session {
  return {
    tabs: tabs.filter(isFileTab).map((t) => {
      const pane = t.pane === 1 ? { pane: 1 as const } : {}
      const view = getView(t.path)
      if (!view) return { path: t.path, line: 1, col: 0, ...pane }
      const head = view.state.selection.main.head
      const line = view.state.doc.lineAt(head)
      return { path: t.path, line: line.number, col: head - line.from, ...pane }
    }),
    active
  }
}

function write(root: string, session: Session) {
  try {
    localStorage.setItem(keyFor(root), JSON.stringify(session))
  } catch {
    // Storage unavailable: nothing is remembered, nothing breaks.
  }
}

export function saveSession() {
  const { root, tabs, active } = useStore.getState()
  if (!root || restoring) return
  write(root, sessionOf(tabs, active))
}

export function loadSession(root: string): Session | null {
  try {
    const raw = localStorage.getItem(keyFor(root))
    return raw ? (JSON.parse(raw) as Session) : null
  } catch {
    return null
  }
}

/** Reopens the tabs saved for `root`, skipping files that no longer exist. */
export async function restoreSession(root: string) {
  if (!useSettings.getState().reopenFiles) return
  const session = loadSession(root)
  if (!session || session.tabs.length === 0) return
  restoring = true
  try {
    const store = useStore.getState()
    for (const tab of session.tabs) {
      if (useStore.getState().root !== root) return
      if ((await ipc.pathState(tab.path)) === 'missing') continue
      const isActive = !!session.active && samePath(tab.path, session.active)
      if (!(await store.openFile(tab.path))) continue
      useStore.getState().moveToPane(tab.path, tab.pane ?? 0)
      revealLine(tab.path, tab.line, tab.col, isActive)
    }
    const active = session.active && useStore.getState().tabs.find((t) => samePath(t.path, session.active!))
    if (active) useStore.getState().setActive(active.path)
  } finally {
    restoring = false
    saveSession()
  }
}

let timer = 0
let installed = false

/** Saves as tabs open, close and switch, as the cursor moves, and when the window closes. */
export function installSessionSaving() {
  if (installed) return
  installed = true
  useStore.subscribe((s, prev) => {
    if (s.root !== prev.root) {
      // Switching folders: save the one being left, while its editors still exist.
      clearTimeout(timer)
      if (prev.root && !restoring) write(prev.root, sessionOf(prev.tabs, prev.active))
      return
    }
    if (s.tabs === prev.tabs && s.active === prev.active && s.cursor === prev.cursor) return
    clearTimeout(timer)
    timer = window.setTimeout(saveSession, SAVE_DELAY_MS)
  })
  window.addEventListener('beforeunload', saveSession)
  window.addEventListener('pagehide', saveSession)
}
