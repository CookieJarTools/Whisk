import { useEffect, useRef } from 'react'
import { Compartment, EditorState, StateEffect, StateField } from '@codemirror/state'
import { Decoration, EditorView, lineNumbers, type DecorationSet } from '@codemirror/view'
import { editorTheme } from '../editor/theme'
import { languageFor } from '../lib/languages'
import { ide } from '../plugins/host'

/** Read-only view of a file around a search hit, with the hit highlighted. */

const setHit = StateEffect.define<{ from: number; to: number } | null>()
const hitMark = Decoration.mark({ class: 'cm-search-hit' })
const hitLine = Decoration.line({ class: 'cm-search-hit-line' })

const hitField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    for (const e of tr.effects) {
      if (!e.is(setHit)) continue
      if (!e.value) return Decoration.none
      const line = tr.state.doc.lineAt(e.value.from)
      const ranges = [hitLine.range(line.from)]
      if (e.value.to > e.value.from) ranges.push(hitMark.range(e.value.from, e.value.to))
      return Decoration.set(ranges, true)
    }
    return tr.docChanged ? value.map(tr.changes) : value
  },
  provide: (f) => EditorView.decorations.from(f)
})

export function TextPreview({ path, line, col, length }: { path: string; line: number; col: number; length: number }) {
  const host = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const language = useRef(new Compartment())
  const loadedPath = useRef<string | null>(null)

  useEffect(() => {
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        extensions: [
          lineNumbers(),
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          language.current.of([]),
          hitField,
          editorTheme
        ]
      })
    })
    viewRef.current = view
    return () => view.destroy()
  }, [])

  useEffect(() => {
    let cancelled = false
    const show = (view: EditorView) => {
      const doc = view.state.doc
      const target = doc.line(Math.max(1, Math.min(line, doc.lines)))
      const from = Math.min(target.from + col, target.to)
      view.dispatch({
        effects: [setHit.of({ from, to: Math.min(from + length, target.to) }), EditorView.scrollIntoView(from, { y: 'center' })]
      })
    }
    const view = viewRef.current
    if (!view) return
    if (loadedPath.current === path) {
      show(view)
      return
    }
    ide.workspace.readFile(path).then(async (text) => {
      if (cancelled) return
      loadedPath.current = path
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } })
      show(view)
      const support = await languageFor(path).load()
      if (!cancelled) view.dispatch({ effects: language.current.reconfigure(support) })
    })
    return () => {
      cancelled = true
    }
  }, [path, line, col, length])

  return <div className="search-preview" ref={host} />
}
