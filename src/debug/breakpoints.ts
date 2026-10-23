import { RangeSet, StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state'
import { Decoration, EditorView, gutter, GutterMarker, type DecorationSet } from '@codemirror/view'
import { create } from 'zustand'
import { useStore } from '../store/store'
import { allViews } from '../editor/views'
import { lensPath } from '../editor/codeLens'

/**
 * Breakpoints: a red dot in the gutter, toggled by clicking there or with the
 * keymap. They're kept per project, follow the code as you edit above them,
 * and can carry a condition. While paused, the current line is highlighted.
 */

export interface Breakpoint {
  /** 1-based. */
  line: number
  condition?: string
}

interface BreakpointState {
  /** By file path (lower case, forward slashes). */
  byFile: Record<string, { path: string; points: Breakpoint[] }>
  /** Lines the debugger confirmed it can stop at, by file key. */
  verified: Record<string, number[]>
}

export const fileKey = (path: string) => path.replace(/\\/g, '/').toLowerCase()
const storageKey = (root: string) => `whisk.breakpoints.${fileKey(root)}`

export const useBreakpoints = create<BreakpointState>(() => ({ byFile: {}, verified: {} }))

function save() {
  const root = useStore.getState().root
  if (!root) return
  try {
    localStorage.setItem(storageKey(root), JSON.stringify(useBreakpoints.getState().byFile))
  } catch {
    // Not remembered between sessions; they still work now.
  }
}

function load(root: string | null) {
  let byFile: BreakpointState['byFile'] = {}
  try {
    byFile = root ? (JSON.parse(localStorage.getItem(storageKey(root)) ?? '{}') as BreakpointState['byFile']) : {}
  } catch {
    byFile = {}
  }
  useBreakpoints.setState({ byFile, verified: {} })
}

export function breakpointsIn(path: string): Breakpoint[] {
  return useBreakpoints.getState().byFile[fileKey(path)]?.points ?? []
}

export function setFileBreakpoints(path: string, points: Breakpoint[]) {
  const key = fileKey(path)
  const sorted = [...points].sort((a, b) => a.line - b.line)
  useBreakpoints.setState((s) => {
    const byFile = { ...s.byFile }
    if (sorted.length) byFile[key] = { path, points: sorted }
    else delete byFile[key]
    return { byFile }
  })
  save()
}

export function toggleBreakpoint(path: string, line: number) {
  const points = breakpointsIn(path)
  setFileBreakpoints(path, points.some((p) => p.line === line) ? points.filter((p) => p.line !== line) : [...points, { line }])
}

export function clearAllBreakpoints() {
  useBreakpoints.setState({ byFile: {}, verified: {} })
  save()
}

// ---- In the editor ----

class BreakpointMarker extends GutterMarker {
  constructor(readonly bp: Breakpoint, readonly verified: boolean) {
    super()
  }
  eq(other: GutterMarker) {
    return other instanceof BreakpointMarker && other.bp.condition === this.bp.condition && other.verified === this.verified
  }
  toDOM() {
    const dot = document.createElement('span')
    dot.className = `cm-bp${this.bp.condition ? ' conditional' : ''}${this.verified ? '' : ' unverified'}`
    dot.title = this.bp.condition ? `Stops when ${this.bp.condition}` : 'Breakpoint'
    return dot
  }
}

class ExecMarker extends GutterMarker {
  toDOM() {
    const arrow = document.createElement('span')
    arrow.className = 'cm-exec-arrow'
    return arrow
  }
}

const setMarkers = StateEffect.define<{ points: Breakpoint[]; verified: number[] | null }>()
export const setExecLine = StateEffect.define<number | null>()

/** Breakpoint markers at line starts, moved along by edits. */
const markersField = StateField.define<RangeSet<BreakpointMarker>>({
  create: () => RangeSet.empty as RangeSet<BreakpointMarker>,
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setMarkers)) {
        const doc = tr.state.doc
        const ranges = e.value.points
          .filter((p) => p.line >= 1 && p.line <= doc.lines)
          .map((p) => new BreakpointMarker(p, !e.value.verified || e.value.verified.includes(p.line)).range(doc.line(p.line).from))
        return RangeSet.of(ranges, true)
      }
    }
    return tr.docChanged ? value.map(tr.changes) : value
  }
})

const execField = StateField.define<number | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setExecLine)) return e.value
    return value !== null && tr.docChanged ? tr.changes.mapPos(value) : value
  }
})

const execLine = Decoration.line({ class: 'cm-exec-line' })

const execDecorations = EditorView.decorations.compute([execField], (state): DecorationSet => {
  const pos = state.field(execField)
  return pos === null || pos > state.doc.length ? Decoration.none : Decoration.set([execLine.range(state.doc.lineAt(pos).from)])
})

/** Breakpoint lines as the editor has them now (after any edits). */
function linesIn(state: EditorState): Breakpoint[] {
  const out: Breakpoint[] = []
  const iter = state.field(markersField).iter()
  for (; iter.value; iter.next()) out.push({ line: state.doc.lineAt(iter.from).number, condition: iter.value.bp.condition })
  return out
}

const same = (a: Breakpoint[], b: Breakpoint[]) => a.length === b.length && a.every((p, i) => p.line === b[i].line && p.condition === b[i].condition)

function editCondition(path: string, line: number) {
  const points = breakpointsIn(path)
  const current = points.find((p) => p.line === line)
  const condition = window.prompt('Stop here only when this is true (leave empty to always stop):', current?.condition ?? '')
  if (condition === null) return
  const next = points.filter((p) => p.line !== line)
  next.push({ line, condition: condition.trim() || undefined })
  setFileBreakpoints(path, next)
}

const breakpointGutter = gutter({
  class: 'cm-breakpoint-gutter',
  markers: (view) => view.state.field(markersField),
  lineMarker(view, line) {
    const exec = view.state.field(execField)
    return exec !== null && exec >= line.from && exec <= line.to ? new ExecMarker() : null
  },
  lineMarkerChange: (update) => update.startState.field(execField) !== update.state.field(execField),
  initialSpacer: () => new ExecMarker(),
  domEventHandlers: {
    mousedown(view, line, event) {
      const path = view.state.facet(lensPath)
      const number = view.state.doc.lineAt(line.from).number
      const e = event as MouseEvent
      if (e.button === 2) {
        const has = breakpointsIn(path).some((p) => p.line === number)
        useStore.getState().openMenu(e.clientX, e.clientY, [
          { label: has ? 'Edit condition…' : 'Add conditional breakpoint…', onSelect: () => editCondition(path, number) },
          ...(has ? [{ label: 'Remove breakpoint', onSelect: () => toggleBreakpoint(path, number) }] : []),
          { type: 'divider' as const },
          { label: 'Remove all breakpoints', onSelect: clearAllBreakpoints }
        ])
        return true
      }
      if (e.button !== 0) return false
      toggleBreakpoint(path, number)
      return true
    }
  }
})

/** Writes back where edits moved the breakpoints. */
const syncBack = EditorView.updateListener.of((update) => {
  if (!update.docChanged) return
  const path = update.state.facet(lensPath)
  const now = linesIn(update.state)
  if (!same(now, breakpointsIn(path))) setFileBreakpoints(path, now)
})

export const breakpointExtension: Extension = [markersField, execField, execDecorations, breakpointGutter, syncBack]

/** Shows the stored breakpoints in an editor (on open, and whenever they change). */
export function showBreakpoints(view: EditorView) {
  const path = view.state.facet(lensPath)
  const points = breakpointsIn(path)
  const verified = useBreakpoints.getState().verified[fileKey(path)] ?? null
  const current = view.state.field(markersField, false)
  if (!current) return
  view.dispatch({ effects: setMarkers.of({ points, verified }) })
}

/** Toggles a breakpoint on the cursor's line (the keymap's action). */
export function toggleAtCursor(view: EditorView): boolean {
  const path = view.state.facet(lensPath)
  toggleBreakpoint(path, view.state.doc.lineAt(view.state.selection.main.head).number)
  return true
}

let installed = false

export function installBreakpoints() {
  if (installed) return
  installed = true
  let root = useStore.getState().root
  load(root)
  useStore.subscribe((s) => {
    if (s.root === root) return
    root = s.root
    load(root)
  })
  useBreakpoints.subscribe((s, prev) => {
    if (s.byFile === prev.byFile && s.verified === prev.verified) return
    for (const view of allViews()) {
      const key = fileKey(view.state.facet(lensPath))
      if (s.byFile[key] !== prev.byFile[key] || s.verified[key] !== prev.verified[key]) showBreakpoints(view)
    }
  })
}
