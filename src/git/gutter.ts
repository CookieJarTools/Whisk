import { Chunk } from '@codemirror/merge'
import { RangeSet, StateEffect, StateField, type EditorState, type Text } from '@codemirror/state'
import { gutter, GutterMarker, type EditorView } from '@codemirror/view'
import { useStore } from '../store/store'
import { lensPath } from '../editor/codeLens'
import { baseName } from '../lib/paths'
import { allViews } from '../editor/views'
import { headText, useGit } from './store'

/**
 * Coloured marks beside lines changed since the last commit, as in Rider:
 * green for added lines, blue for changed ones, a red notch where lines were
 * deleted. Click one to see what was there, roll it back, or open the diff.
 */

interface ChangeState {
  /** The file as of the last commit; null when it's new or not in a repository. */
  base: Text | null
  chunks: readonly Chunk[]
}

export const setGitBase = StateEffect.define<string | null>()

const DIFF_CONFIG = { scanLimit: 2000, timeout: 200 }

export const changesField = StateField.define<ChangeState>({
  create: () => ({ base: null, chunks: [] }),
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setGitBase)) {
        const base = e.value === null ? null : tr.state.toText(e.value)
        return { base, chunks: base ? Chunk.build(base, tr.state.doc, DIFF_CONFIG) : [] }
      }
    }
    if (!tr.docChanged || !value.base) return value
    return { base: value.base, chunks: Chunk.updateB(value.chunks, value.base, tr.state.doc, tr.changes, DIFF_CONFIG) }
  }
})

type Kind = 'added' | 'modified' | 'deleted'

class ChangeMarker extends GutterMarker {
  elementClass: string
  constructor(readonly kind: Kind) {
    super()
    this.elementClass = `cm-git-${kind}`
  }
  eq(other: ChangeMarker) {
    return other.kind === this.kind
  }
}

const MARKERS: Record<Kind, ChangeMarker> = {
  added: new ChangeMarker('added'),
  modified: new ChangeMarker('modified'),
  deleted: new ChangeMarker('deleted')
}

export function kindOf(chunk: Chunk): Kind {
  if (chunk.fromA === chunk.toA) return 'added'
  if (chunk.fromB === chunk.toB) return 'deleted'
  return 'modified'
}

/** The document lines a chunk covers (1-based, inclusive). */
export function chunkLines(chunk: Chunk, doc: Text): [number, number] {
  const first = doc.lineAt(Math.min(chunk.fromB, doc.length)).number
  if (chunk.fromB === chunk.toB) return [first, first]
  const last = doc.lineAt(Math.min(Math.max(chunk.fromB, chunk.endB), doc.length)).number
  return [first, last]
}

function markers(state: EditorState): RangeSet<GutterMarker> {
  const { chunks } = state.field(changesField)
  const doc = state.doc
  const ranges = []
  for (const chunk of chunks) {
    const kind = kindOf(chunk)
    const [first, last] = chunkLines(chunk, doc)
    for (let n = first; n <= last; n++) ranges.push(MARKERS[kind].range(doc.line(n).from))
  }
  return RangeSet.of(ranges, true)
}

function chunkAt(state: EditorState, lineNumber: number): Chunk | null {
  return state.field(changesField).chunks.find((c) => {
    const [first, last] = chunkLines(c, state.doc)
    return lineNumber >= first && lineNumber <= last
  }) ?? null
}

function rollbackChunk(view: EditorView, chunk: Chunk) {
  const { base } = view.state.field(changesField)
  if (!base) return
  const state = view.state
  // As @codemirror/merge's rejectChunk: chunk ends sit one past the last line break.
  let insert = base.sliceString(chunk.fromA, Math.max(chunk.fromA, chunk.toA - 1))
  if (chunk.fromA !== chunk.toA && chunk.toB <= state.doc.length) insert += state.lineBreak
  view.dispatch({ changes: { from: chunk.fromB, to: Math.min(state.doc.length, chunk.toB), insert }, userEvent: 'input.rollback' })
}

/** Opens the whole file's changes side by side. */
export function showFileDiff(view: EditorView) {
  const path = view.state.facet(lensPath)
  const { base } = view.state.field(changesField)
  useStore.getState().openDiff(`git:${path}`, `${baseName(path)} (changes)`, {
    leftTitle: `${baseName(path)} · last commit`,
    left: base?.toString() ?? '',
    rightTitle: `${baseName(path)} · your copy`,
    right: view.state.doc.toString(),
    path
  })
}

function openChunkMenu(view: EditorView, chunk: Chunk, event: MouseEvent) {
  const { base } = view.state.field(changesField)
  const before = base ? base.sliceString(chunk.fromA, Math.min(chunk.endA, base.length)) : ''
  const preview = before.split('\n').slice(0, 6).map((l) => l.trim()).filter(Boolean)
  useStore.getState().openMenu(event.clientX, event.clientY, [
    ...(preview.length
      ? [{ type: 'header' as const, label: 'Was:' }, ...preview.map((l) => ({ type: 'header' as const, label: l.length > 60 ? l.slice(0, 58) + '…' : l }))]
      : [{ type: 'header' as const, label: 'New lines' }]),
    { type: 'divider' },
    { label: 'Roll back this change', onSelect: () => rollbackChunk(view, chunk) },
    { label: 'Show diff', onSelect: () => showFileDiff(view) }
  ])
}

export const changeGutter = [
  changesField,
  gutter({
    class: 'cm-git-gutter',
    markers: (view) => markers(view.state),
    domEventHandlers: {
      mousedown(view, line, event) {
        const chunk = chunkAt(view.state, view.state.doc.lineAt(line.from).number)
        if (!chunk) return false
        openChunkMenu(view, chunk, event as MouseEvent)
        return true
      }
    }
  })
]

/** Loads what the file looked like in the last commit, for the markers to compare against. */
export async function loadGitBase(view: EditorView, path: string) {
  if (!useGit.getState().repo) return
  const text = await headText(path)
  if (view.dom.isConnected) view.dispatch({ effects: setGitBase.of(text) })
}

// When HEAD moves (a commit, pull or branch switch) or the repository is found,
// every open editor reloads what it compares against.
useGit.subscribe((s, prev) => {
  if (s.headVersion === prev.headVersion) return
  for (const view of allViews()) void loadGitBase(view, view.state.facet(lensPath))
})

/** Moves the cursor to the next (or previous) change since the last commit, wrapping round. */
export function gotoChange(view: EditorView, direction: 1 | -1): boolean {
  const { chunks } = view.state.field(changesField, false) ?? { chunks: [] }
  if (chunks.length === 0) {
    useStore.getState().toast('No changes in this file since the last commit.')
    return false
  }
  const head = view.state.selection.main.head
  const line = view.state.doc.lineAt(head).number
  const starts = chunks.map((c) => chunkLines(c, view.state.doc)[0])
  const index = direction === 1 ? starts.findIndex((n) => n > line) : starts.map((n, i) => [n, i]).filter(([n]) => n < line).pop()?.[1] ?? -1
  const target = starts[index >= 0 ? index : direction === 1 ? 0 : starts.length - 1]
  const pos = view.state.doc.line(target).from
  view.dispatch({ selection: { anchor: pos }, scrollIntoView: true })
  return true
}
