import { RangeSet, StateEffect, StateField } from '@codemirror/state'
import { gutter, GutterMarker, type EditorView } from '@codemirror/view'
import { useStore } from '../store/store'
import { lensPath } from '../editor/codeLens'
import { baseName } from '../lib/paths'
import { ipc } from '../lib/ipc'
import { age, isUncommitted, parseBlame, repoRelative, runGit, tryGit, type BlameLine } from './git'
import { useGit } from './store'

/**
 * "Annotate with git blame": who last changed each line and when, in a gutter
 * beside the line numbers. Newer changes are brighter. Click one for the
 * commit's message and its diff. Lines typed since stay blank.
 */

const setBlame = StateEffect.define<RangeSet<BlameMarker> | null>()

class BlameMarker extends GutterMarker {
  constructor(readonly line: BlameLine, readonly first: boolean, readonly fade: number) {
    super()
  }
  eq(other: BlameMarker) {
    return other.line === this.line && other.first === this.first
  }
  toDOM() {
    const el = document.createElement('span')
    el.className = 'cm-blame-entry'
    // Only the first line of each run of the same commit is labelled, as in Rider.
    if (this.first) {
      const date = isUncommitted(this.line)
        ? ''
        : new Date(this.line.time * 1000).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' })
      el.textContent = `${date.padEnd(9)}${this.line.author}`
    }
    el.style.opacity = String(this.fade)
    return el
  }
}

const blameField = StateField.define<RangeSet<BlameMarker> | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setBlame)) return e.value
    return value && tr.docChanged ? value.map(tr.changes) : value
  }
})

const blameGutter = gutter({
  class: 'cm-blame-gutter',
  markers: (view) => view.state.field(blameField) ?? RangeSet.empty,
  domEventHandlers: {
    mousedown(view, line, event) {
      let found: BlameLine | null = null
      view.state.field(blameField)?.between(line.from, line.from, (_from, _to, marker) => {
        found = marker.line
      })
      if (!found) return false
      openCommitMenu(view, found, event as MouseEvent)
      return true
    }
  }
})

export const blameExtension = [blameField, blameGutter]

export function isBlameShown(view: EditorView): boolean {
  return !!view.state.field(blameField, false)
}

/** Turns blame on (or off, when it's showing) for an editor. */
export async function toggleBlame(view: EditorView): Promise<boolean> {
  if (isBlameShown(view)) {
    view.dispatch({ effects: setBlame.of(null) })
    return true
  }
  const repo = useGit.getState().repo
  const path = view.state.facet(lensPath)
  const rel = repo ? repoRelative(repo, path) : null
  if (!repo || !rel) {
    useStore.getState().toast('This file isn’t in a git repository.')
    return false
  }
  let lines: BlameLine[]
  try {
    // Blame the text as it is in the editor, so unsaved edits line up.
    lines = parseBlame(await runGit(repo, ['blame', '--porcelain', '--contents', '-', '--', rel], view.state.doc.toString()))
  } catch (e) {
    useStore.getState().toast(/no such path|does not exist/i.test(String(e)) ? 'This file hasn’t been committed yet.' : String(e), 'error')
    return false
  }
  const times = lines.filter((l) => !isUncommitted(l)).map((l) => l.time)
  const oldest = Math.min(...times)
  const newest = Math.max(...times)
  const doc = view.state.doc
  const markers = lines.slice(0, doc.lines).map((line, i) => {
    const fade = isUncommitted(line) || newest === oldest ? 1 : 0.45 + (0.55 * (line.time - oldest)) / (newest - oldest)
    return new BlameMarker(line, i === 0 || lines[i - 1] !== line, fade).range(doc.line(i + 1).from)
  })
  view.dispatch({ effects: setBlame.of(RangeSet.of(markers)) })
  return true
}

/** Opens a commit's change to one file side by side. */
export async function showCommitDiff(path: string, hash: string) {
  const repo = useGit.getState().repo
  const rel = repo ? repoRelative(repo, path) : null
  if (!repo || !rel) return
  const before = (await tryGit(repo, ['show', `${hash}^:${rel}`])) ?? ''
  const after = (await tryGit(repo, ['show', `${hash}:${rel}`])) ?? ''
  useStore.getState().openDiff(`commit:${hash}:${rel}`, `${baseName(path)} @ ${hash.slice(0, 7)}`, {
    leftTitle: `${hash.slice(0, 7)}^ (before)`,
    left: before,
    rightTitle: `${hash.slice(0, 7)} (after)`,
    right: after,
    path
  })
}

function openCommitMenu(view: EditorView, line: BlameLine, event: MouseEvent) {
  const path = view.state.facet(lensPath)
  if (isUncommitted(line)) {
    useStore.getState().openMenu(event.clientX, event.clientY, [{ type: 'header', label: 'Not committed yet' }])
    return
  }
  useStore.getState().openMenu(event.clientX, event.clientY, [
    { type: 'header', label: line.summary.length > 60 ? line.summary.slice(0, 58) + '…' : line.summary },
    { type: 'header', label: `${line.author} · ${age(line.time)} · ${line.hash.slice(0, 7)}` },
    { type: 'divider' },
    { label: 'Show this commit’s change to the file', onSelect: () => void showCommitDiff(path, line.hash) },
    { label: 'Copy commit hash', onSelect: () => void ipc.copyText(line.hash) }
  ])
}
