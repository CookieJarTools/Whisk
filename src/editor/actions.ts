import { EditorSelection } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { LSPPlugin, jumpToDefinition, findReferences, renameSymbol } from '@codemirror/lsp-client'
import { ipc } from '../lib/ipc'
import { SOURCE_EXTENSIONS } from '../lib/languages'
import { useStore } from '../store/store'
import { markSaved, revealLine, getView } from './views'
import { scopeField } from './scopes'

export async function saveFile(path: string) {
  const view = getView(path)
  if (!view) return
  const doc = view.state.doc
  try {
    await ipc.writeText(path, view.state.sliceDoc())
    markSaved(path, doc)
    useStore.getState().setDirty(path, false)
  } catch (e) {
    useStore.getState().toast(String(e), 'error')
  }
}

export function hasLanguageServer(view: EditorView): boolean {
  return !!LSPPlugin.get(view)
}

/**
 * Jumps to where the symbol under the cursor is declared. Uses the language
 * server when one is attached; otherwise falls back to declarations in this
 * file, then a project-wide search for a type of that name.
 */
export async function goToDefinition(view: EditorView): Promise<boolean> {
  if (hasLanguageServer(view)) return jumpToDefinition(view)
  const head = view.state.selection.main.head
  const word = view.state.wordAt(head)
  if (!word) return false
  const name = view.state.sliceDoc(word.from, word.to)

  const local = view.state.field(scopeField, false)?.symbols.find((s) => s.name === name)
  if (local) {
    view.dispatch({ selection: EditorSelection.cursor(view.state.doc.line(local.headerLine).from), scrollIntoView: true })
    return true
  }
  const root = useStore.getState().root
  if (!root) return false
  const [hit] = await ipc.findTypeDefinitions(root, [name], SOURCE_EXTENSIONS)
  if (!hit) {
    useStore.getState().toast(`No declaration found for ${name}`)
    return false
  }
  if (await useStore.getState().openFile(hit.path)) revealLine(hit.path, hit.line)
  return true
}

export const references = (view: EditorView) => hasLanguageServer(view) && findReferences(view)
export const rename = (view: EditorView) => hasLanguageServer(view) && renameSymbol(view)
