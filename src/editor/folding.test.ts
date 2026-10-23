import { describe, expect, it } from 'vitest'
import { Text } from '@codemirror/state'
import { foldRanges } from './folding'
import { findSymbols, scanBlocks } from './scopes'
import { pinnedSymbols } from './stickyHeader'

const CS = ['class Player', '{', '    void Run()', '    {', '        Go();', '    }', '}'].join('\n')

describe('foldRanges', () => {
  it('folds braces-on-their-own-line blocks from the header line', () => {
    const doc = Text.of(CS.split('\n'))
    const ranges = foldRanges(doc, scanBlocks(CS, 'c'))
    expect([...ranges.keys()]).toEqual([1, 3])
    const run = ranges.get(3)!
    expect(doc.sliceString(run.from, run.to)).toBe('\n    {\n        Go();\n    ')
  })

  it('folds same-line braces after the brace', () => {
    const text = 'fn main() {\n    go();\n}'
    const ranges = foldRanges(Text.of(text.split('\n')), scanBlocks(text, 'c'))
    expect(ranges.get(1)).toEqual({ from: 11, to: 22 })
  })

  it('folds Python blocks after the colon', () => {
    const text = 'def run():\n    go()\n    stop()\n'
    const doc = Text.of(text.split('\n'))
    const r = foldRanges(doc, scanBlocks(text, 'indent')).get(1)!
    expect(doc.sliceString(r.from, r.to)).toBe('\n    go()\n    stop()')
  })
})

describe('pinnedSymbols', () => {
  it('pins the class and method whose headers scrolled off', () => {
    const doc = Text.of(CS.split('\n'))
    const symbols = findSymbols(doc, scanBlocks(CS, 'c'))
    const at = (line: number) => pinnedSymbols(symbols, doc.line(line).from, line).map((s) => s.name)
    expect(at(1)).toEqual([])
    expect(at(2)).toEqual(['Player'])
    expect(at(5)).toEqual(['Player', 'Run'])
  })
})
