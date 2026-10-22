import { EditorView } from '@codemirror/view'
import { EditorSelection, type Text } from '@codemirror/state'

/** Every open tab keeps its own EditorView; this tracks them by path. */

const views = new Map<string, EditorView>()
const savedDocs = new Map<string, Text>()
const waiters = new Map<string, ((view: EditorView) => void)[]>()
const pendingReveal = new Map<string, number>()

const key = (path: string) => path.replace(/\\/g, '/').toLowerCase()

export function registerView(path: string, view: EditorView) {
  const k = key(path)
  views.set(k, view)
  savedDocs.set(k, view.state.doc)
  waiters.get(k)?.forEach((resolve) => resolve(view))
  waiters.delete(k)
  const line = pendingReveal.get(k)
  if (line !== undefined) {
    pendingReveal.delete(k)
    requestAnimationFrame(() => revealLine(path, line))
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

/** Moves the cursor to a 1-based line and centres it, now or once the file's view exists. */
export function revealLine(path: string, line: number) {
  const view = getView(path)
  if (!view) {
    pendingReveal.set(key(path), line)
    return
  }
  const target = view.state.doc.line(Math.max(1, Math.min(line, view.state.doc.lines)))
  view.dispatch({
    selection: EditorSelection.cursor(target.from),
    effects: EditorView.scrollIntoView(target.from, { y: 'center' })
  })
  view.focus()
}
