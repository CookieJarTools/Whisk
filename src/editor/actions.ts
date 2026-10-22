import type { EditorView } from '@codemirror/view'
import { LSPPlugin, renameSymbol } from '@codemirror/lsp-client'
import { ipc } from '../lib/ipc'
import { useStore } from '../store/store'
import { markSaved, getView } from './views'
import { lineEnding } from './lineEnding'

const saveListeners = new Set<(path: string) => void>()

/** Called after any file is saved from an editor. */
export function onFileSaved(listener: (path: string) => void) {
  saveListeners.add(listener)
}

export async function saveFile(path: string) {
  const view = getView(path)
  if (!view) return
  const doc = view.state.doc
  try {
    await ipc.writeText(path, doc.sliceString(0, doc.length, view.state.facet(lineEnding)))
    markSaved(path, doc)
    useStore.getState().setDirty(path, false)
    saveListeners.forEach((listener) => listener(path))
  } catch (e) {
    useStore.getState().toast(String(e), 'error')
  }
}

export function hasLanguageServer(view: EditorView): boolean {
  return !!LSPPlugin.get(view)
}

export const rename = (view: EditorView) => hasLanguageServer(view) && renameSymbol(view)
