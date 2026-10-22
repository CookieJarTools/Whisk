import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { braceFlavor, scopeField } from './scopes'
import { dominantLineEnding, lineEnding } from './lineEnding'

// Like DamageSystem.cs: mostly Windows endings, with some plain ones mixed in.
const MIXED = [
  'namespace Game\r\n',
  '{\r\n',
  '\tpublic class Damage\n',
  '\t{\r\n',
  '\t\tvoid Apply()\n',
  '\t\t{\r\n',
  '\t\t\tif (hit)\n',
  '\t\t\t{\r\n',
  '\t\t\t\tHurt();\r\n',
  '\t\t\t}\n',
  '\t\t}\r\n',
  '\t}\r\n',
  '}\r\n'
].join('')

function open(text: string) {
  return EditorState.create({
    doc: text,
    extensions: [braceFlavor.of('c'), scopeField, lineEnding.of(dominantLineEnding(text))]
  })
}

describe('files with mixed line endings', () => {
  it('open with every block on a line the editor knows about', () => {
    const state = open(MIXED)
    const { blocks, symbols } = state.field(scopeField)
    expect(state.doc.lines).toBe(14)
    expect(blocks.map((b) => [b.openLine, b.closeLine])).toEqual([
      [2, 13],
      [4, 12],
      [6, 11],
      [8, 10]
    ])
    expect(symbols.map((s) => s.name)).toEqual(['Game', 'Damage', 'Apply'])
  })

  it('save with the ending most lines use', () => {
    expect(dominantLineEnding(MIXED)).toBe('\r\n')
    expect(dominantLineEnding('a\nb\nc\r\n')).toBe('\n')
    expect(dominantLineEnding('one line')).toBe('\n')
    const state = open(MIXED)
    const saved = state.doc.sliceString(0, state.doc.length, state.facet(lineEnding))
    expect(saved).toBe(MIXED.replace(/\r?\n/g, '\r\n'))
  })
})
