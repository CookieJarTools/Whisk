import { MergeView } from '@codemirror/merge'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import { EditorView, lineNumbers, highlightSpecialChars } from '@codemirror/view'
import { languageFor } from '../lib/languages'
import type { DiffSpec } from '../store/store'
import { editorTheme } from './theme'

/**
 * Two texts side by side with changes highlighted and long unchanged runs
 * folded away, as in Rider's diff viewer. Both sides are read-only.
 */
export function createDiffView(spec: DiffSpec, title: string, parent: HTMLElement): MergeView {
  const lang = languageFor(spec.path ?? title)
  const languages = [new Compartment(), new Compartment()]
  const side = (doc: string, compartment: Compartment): { doc: string; extensions: Extension[] } => ({
    doc,
    extensions: [
      lineNumbers(),
      highlightSpecialChars(),
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      EditorState.tabSize.of(4),
      editorTheme,
      compartment.of([])
    ]
  })
  const view = new MergeView({
    a: side(spec.left, languages[0]),
    b: side(spec.right, languages[1]),
    parent,
    gutter: true,
    highlightChanges: true,
    collapseUnchanged: { margin: 3, minSize: 8 }
  })
  lang.load().then((support) => {
    view.a.dispatch({ effects: languages[0].reconfigure(support) })
    view.b.dispatch({ effects: languages[1].reconfigure(support) })
  })
  return view
}
