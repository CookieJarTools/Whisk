import { EditorView } from '@codemirror/view'
import { EditorSelection, type Text } from '@codemirror/state'

/** Every open tab keeps its own EditorView; this tracks them by path. */

const views = new Map<string, EditorView>()
const savedDocs = new Map<string, Text>()
const waiters = new Map<string, ((view: EditorView) => void)[]>()
const pendingReveal = new Map<string, { line: number; col: number; focus: boolean }>()

const key = (path: string) => path.replace(/\\/g, '/').toLowerCase()

export function registerView(path: string, view: EditorView) {
  const k = key(path)
  views.set(k, view)
  savedDocs.set(k, view.state.doc)
  waiters.get(k)?.forEach((resolve) => resolve(view))
  waiters.delete(k)
  const pending = pendingReveal.get(k)
  if (pending) {
    pendingReveal.delete(k)
    requestAnimationFrame(() => revealLine(path, pending.line, pending.col, pending.focus))
  }
}

export function unregisterView(path: string) {
  views.delete(key(path))
  savedDocs.delete(key(path))
}

export function getView(path: string | null): EditorView | null {
  return path ? (views.get(key(path)) ?? null) : null
}

export function allViews(): EditorView[] {
  return [...views.values()]
}

export function whenView(path: string, timeoutMs = 5000): Promise<EditorView | null> {
  const existing = getView(path)
  if (existing) return Promise.resolve(existing)
  return new Promise((resolve) => {
    const k = key(path)
    const list = waiters.get(k) ?? []
    list.push(resolve)
    waiters.set(k, list)
    setTimeout(() => resolve(getView(path)), timeoutMs)
  })
}

export function markSaved(path: string, doc: Text) {
  savedDocs.set(key(path), doc)
}

export function isDirty(path: string, doc: Text): boolean {
  const saved = savedDocs.get(key(path))
  return !!saved && !saved.eq(doc)
}

/**
 * Puts the cursor on a 1-based line and column and centres it, now or once the
 * file's view exists. `focus: false` leaves keyboard focus where it is, for
 * tabs restored in the background.
 */
export function revealLine(path: string, line: number, col = 0, focus = true) {
  const view = getView(path)
  if (!view) {
    pendingReveal.set(key(path), { line, col, focus })
    return
  }
  const target = view.state.doc.line(Math.max(1, Math.min(line, view.state.doc.lines)))
  const pos = Math.min(target.from + Math.max(0, col), target.to)
  view.dispatch({
    selection: EditorSelection.cursor(pos),
    effects: EditorView.scrollIntoView(pos, { y: 'center' })
  })
  if (focus) view.focus()
}
