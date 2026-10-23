import { describe, expect, it } from 'vitest'
import { applyToText, offsetIn } from './edits'

const at = (line: number, character: number) => ({ line, character })

describe('offsetIn', () => {
  it('counts lines across any line ending', () => {
    const text = 'ab\r\ncd\nef'
    expect(offsetIn(text, at(1, 0))).toBe(4)
    expect(offsetIn(text, at(2, 1))).toBe(8)
  })

  it('clamps past the end of a line', () => {
    expect(offsetIn('ab\ncd', at(0, 99))).toBe(2)
  })
})

describe('applyToText', () => {
  it('applies several edits against the original positions', () => {
    const text = 'int a;\nint b;\n'
    const out = applyToText(text, [
      { range: { start: at(0, 4), end: at(0, 5) }, newText: 'first' },
      { range: { start: at(1, 4), end: at(1, 5) }, newText: 'second' }
    ])
    expect(out).toBe('int first;\nint second;\n')
  })

  it('handles inserts at the same spot in order', () => {
    const out = applyToText('x', [{ range: { start: at(0, 1), end: at(0, 1) }, newText: ';' }])
    expect(out).toBe('x;')
  })
})
