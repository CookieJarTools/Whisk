import type { EditorView } from '@codemirror/view'
import { LSPPlugin } from '@codemirror/lsp-client'
import { getIndentUnit, indentUnit } from '@codemirror/language'
import { ipc } from '../lib/ipc'
import { uriToPath } from '../lib/paths'
import { getView } from '../editor/views'
import { useStore } from '../store/store'

/**
 * Applying edits a language server hands back: formatting, quick fixes,
 * refactorings. Open files change in their editor (so undo works); closed
 * files are edited on disk.
 */

export interface Position {
  line: number
  character: number
}

export interface TextEdit {
  range: { start: Position; end: Position }
  newText: string
}

export interface WorkspaceEdit {
  changes?: Record<string, TextEdit[]>
  documentChanges?: ({ textDocument: { uri: string }; edits: TextEdit[] } | { kind: string })[]
}

/** Offset of an LSP position in plain text (lines split on any ending, characters in UTF-16). */
export function offsetIn(text: string, pos: Position): number {
  let line = 0
  let i = 0
  while (line < pos.line && i < text.length) {
    const ch = text[i++]
    if (ch === '\n') line++
    else if (ch === '\r') {
      if (text[i] === '\n') i++
      line++
    }
  }
  let end = i
  while (end < text.length && text[end] !== '\n' && text[end] !== '\r') end++
  return Math.min(i + pos.character, end)
}

/** Applies edits to plain text, last first so earlier offsets stay valid. */
export function applyToText(text: string, edits: TextEdit[]): string {
  const located = edits
    .map((e) => ({ from: offsetIn(text, e.range.start), to: offsetIn(text, e.range.end), insert: e.newText }))
    .sort((a, b) => b.from - a.from || b.to - a.to)
  let out = text
  for (const e of located) out = out.slice(0, e.from) + e.insert + out.slice(e.to)
  return out
}

/** Applies edits to an open editor as one undoable change. */
export function applyToView(view: EditorView, edits: TextEdit[]): boolean {
  const plugin = LSPPlugin.get(view)
  if (!plugin || edits.length === 0) return false
  plugin.client.sync()
  const changes = edits.map((e) => ({
    from: plugin.unsyncedChanges.mapPos(plugin.fromPosition(e.range.start, plugin.syncedDoc)),
    to: plugin.unsyncedChanges.mapPos(plugin.fromPosition(e.range.end, plugin.syncedDoc)),
    insert: e.newText
  }))
  view.dispatch({ changes, userEvent: 'input.lsp' })
  return true
}

/** Applies a WorkspaceEdit across files. Returns how many files changed. */
export async function applyWorkspaceEdit(edit: WorkspaceEdit): Promise<number> {
  const byUri = new Map<string, TextEdit[]>()
  for (const [uri, edits] of Object.entries(edit.changes ?? {})) byUri.set(uri, edits)
  let skipped = 0
  for (const change of edit.documentChanges ?? []) {
    if ('textDocument' in change) byUri.set(change.textDocument.uri, [...(byUri.get(change.textDocument.uri) ?? []), ...change.edits])
    else skipped++
  }
  let changed = 0
  for (const [uri, edits] of byUri) {
    const path = uriToPath(uri)
    const view = getView(path)
    if (view && applyToView(view, edits)) changed++
    else if (!view) {
      const text = await ipc.readText(path)
      await ipc.writeText(path, applyToText(text, edits))
      changed++
    }
  }
  if (skipped) useStore.getState().toast(`${skipped} file create/rename step${skipped === 1 ? '' : 's'} in this change aren't supported yet and were skipped.`, 'error')
  return changed
}

/** Formatting options from the editor's own indentation. */
export function formattingOptions(view: EditorView) {
  const usesTabs = view.state.facet(indentUnit).includes('	')
  return {
    tabSize: usesTabs ? view.state.tabSize : getIndentUnit(view.state),
    insertSpaces: !usesTabs,
    trimTrailingWhitespace: true,
    insertFinalNewline: true
  }
}

const FORMAT_TIMEOUT_MS = 4000

/** Asks the language server to format the whole file. False if it can't, or takes too long. */
export async function formatView(view: EditorView): Promise<boolean> {
  const plugin = LSPPlugin.get(view)
  if (!plugin?.client.serverCapabilities?.documentFormattingProvider) return false
  plugin.client.sync()
  const request = plugin.client.request<object, TextEdit[] | null>('textDocument/formatting', {
    textDocument: { uri: plugin.uri },
    options: formattingOptions(view)
  })
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), FORMAT_TIMEOUT_MS))
  try {
    const edits = await Promise.race([request, timeout])
    return !!edits && applyToView(view, edits)
  } catch {
    return false
  }
}
