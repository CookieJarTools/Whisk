import { EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { useStore } from '../store/store'
import { getView, whenView } from './views'
import { samePath } from '../lib/paths'

/**
 * Rider-style Back / Forward: every jump (go to definition, a search result, a
 * symbol) records where you were, so Back returns there.
 */

interface Location {
  path: string
  pos: number
}

const MAX_HISTORY = 100
const backStack: Location[] = []
const forwardStack: Location[] = []

function here(): Location | null {
  const path = useStore.getState().active
  const view = getView(path)
  return path && view ? { path, pos: view.state.selection.main.head } : null
}

/** Call before moving the cursor somewhere far away. */
export function recordJump() {
  const loc = here()
  if (!loc) return
  const last = backStack[backStack.length - 1]
  if (last && samePath(last.path, loc.path) && last.pos === loc.pos) return
  backStack.push(loc)
  if (backStack.length > MAX_HISTORY) backStack.shift()
  forwardStack.length = 0
}

async function show(path: string, from: number, to = from) {
  if (!(await useStore.getState().openFile(path))) return
  const view = await whenView(path)
  if (!view) return
  const max = view.state.doc.length
  const a = Math.min(from, max)
  const b = Math.min(to, max)
  view.dispatch({
    selection: EditorSelection.range(a, b),
    effects: EditorView.scrollIntoView(a, { y: 'center' })
  })
  view.focus()
}

export async function goBack() {
  const target = backStack.pop()
  if (!target) return
  const loc = here()
  if (loc) forwardStack.push(loc)
  await show(target.path, target.pos)
}

export async function goForward() {
  const target = forwardStack.pop()
  if (!target) return
  const loc = here()
  if (loc) backStack.push(loc)
  await show(target.path, target.pos)
}

/** Opens `path` at a 1-based line, optionally selecting `length` characters from UTF-16 column `col`. */
export async function jumpTo(path: string, line: number, col = 0, length = 0) {
  recordJump()
  if (!(await useStore.getState().openFile(path))) return
  const view = await whenView(path)
  if (!view) return
  const doc = view.state.doc
  const target = doc.line(Math.max(1, Math.min(line, doc.lines)))
  const from = Math.min(target.from + col, target.to)
  await show(path, from, Math.min(from + length, target.to))
}

// Recently viewed files, newest first (Ctrl+E).
const recentFiles: string[] = []
const MAX_RECENT = 30

useStore.subscribe((s, prev) => {
  if (!s.active || s.active === prev.active) return
  const i = recentFiles.findIndex((p) => samePath(p, s.active!))
  if (i >= 0) recentFiles.splice(i, 1)
  recentFiles.unshift(s.active)
  if (recentFiles.length > MAX_RECENT) recentFiles.pop()
})

export function getRecentFiles(): readonly string[] {
  return recentFiles
}
