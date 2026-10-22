import type { EditorState } from '@codemirror/state'
import type { SymbolInfo } from '../plugins/api'
import { languageFor } from '../lib/languages'
import { relativePath } from '../lib/paths'
import { useStore } from '../store/store'
import type { CodeSymbol } from './scopes'

const FENCES: Record<string, string> = {
  typescriptreact: 'tsx',
  javascriptreact: 'jsx',
  shellscript: 'sh',
  plaintext: ''
}

export function fenceFor(path: string): string {
  const id = languageFor(path).lspId
  return FENCES[id] ?? id
}

export function toSymbolInfo(state: EditorState, path: string, symbol: CodeSymbol): SymbolInfo {
  const containers: string[] = []
  for (let p = symbol.parent; p; p = p.parent) containers.unshift(p.name)
  return {
    name: symbol.name,
    kind: symbol.kind,
    path,
    relativePath: relativePath(useStore.getState().root, path),
    language: languageFor(path).label,
    fence: fenceFor(path),
    startLine: state.doc.lineAt(symbol.from).number,
    endLine: symbol.block.closeLine,
    text: state.doc.sliceString(symbol.from, symbol.to),
    header: symbol.header,
    containers
  }
}
