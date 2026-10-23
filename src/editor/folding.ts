import { foldService } from '@codemirror/language'
import type { EditorState, Text } from '@codemirror/state'
import { scopeField, type Block, type ScopeInfo } from './scopes'

/**
 * Folding from Whisk's own block scanner, so every language with braces or
 * Python-style indentation folds, not just the ones whose grammar knows how.
 * A block folds from its header line: with the brace on its own line
 * (`void Run()` / `{`), the arrow sits on `void Run()`.
 */

export interface FoldRange {
  from: number
  to: number
}

/** Line number → what folds from it. */
export function foldRanges(doc: Text, blocks: Block[]): Map<number, FoldRange> {
  const ranges = new Map<number, FoldRange>()
  for (const block of blocks) {
    const open = doc.line(block.openLine)
    const braceAlone = !open.text.slice(0, block.from - open.from).trim()
    let line = open
    if (braceAlone && block.openLine > 1) {
      let n = block.openLine - 1
      while (n > 1 && !doc.line(n).text.trim()) n--
      const prev = doc.line(n)
      if (!/[;{}]\s*$/.test(prev.text)) line = prev
    }
    const isIndentBlock = doc.sliceString(block.from, block.from + 1) === ':'
    const from = line === open ? block.from + 1 : line.to
    const to = isIndentBlock ? block.to + 1 : block.to
    if (to > from && !ranges.has(line.number)) ranges.set(line.number, { from, to })
  }
  return ranges
}

const cache = new WeakMap<ScopeInfo, Map<number, FoldRange>>()

function rangesFor(state: EditorState): Map<number, FoldRange> {
  const info = state.field(scopeField, false)
  if (!info) return new Map()
  let ranges = cache.get(info)
  if (!ranges) {
    ranges = foldRanges(state.doc, info.blocks)
    cache.set(info, ranges)
  }
  return ranges
}

export const blockFolding = foldService.of((state, lineStart) => rangesFor(state).get(state.doc.lineAt(lineStart).number) ?? null)
