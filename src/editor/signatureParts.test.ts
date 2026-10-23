import { describe, expect, it } from 'vitest'
import { argumentIndex, openingBracket, paramName, parseDocs, signatureParts, type SignatureInfo } from './signatureParts'

const kinds = (sig: SignatureInfo) =>
  signatureParts(sig)
    .filter((p) => p.text.trim())
    .map((p) => `${p.text}:${p.kind}`)

describe('signature parts', () => {
  it('colours a C# signature: return type, owner, name, then type + name per parameter', () => {
    const sig = { label: 'float Vector3.Distance(Vector3 a, Vector3 b)', parameters: [{ label: 'Vector3 a' }, { label: 'Vector3 b' }] }
    expect(kinds(sig)).toEqual([
      'float:type',
      'Vector3.:owner',
      'Distance:name',
      '(:punct',
      'Vector3:type',
      'a:param',
      ', :punct',
      'Vector3:type',
      'b:param',
      '):punct'
    ])
  })

  it('handles name-first languages and return types after the bracket', () => {
    const sig = { label: 'clamp(value: number, min: number = 0): number', parameters: [{ label: 'value: number' }, { label: 'min: number = 0' }] }
    const k = kinds(sig)
    expect(k).toContain('value:param')
    expect(k).toContain('= 0:default')
    expect(k.at(-1)).toBe('number:type')
    expect(k).toContain('clamp:name')
  })

  it('treats ref/out/params as keywords and keeps parameters tagged by index', () => {
    const sig = { label: 'void Log(ref int count, params object[] args)', parameters: [{ label: 'ref int count' }, { label: 'params object[] args' }] }
    const parts = signatureParts(sig)
    expect(parts.find((p) => p.text === 'ref')?.kind).toBe('keyword')
    expect(parts.find((p) => p.text === 'params')?.kind).toBe('keyword')
    expect(parts.find((p) => p.text === 'args')?.param).toBe(1)
  })

  it('uses [from, to] parameter labels when the server sends them', () => {
    const label = 'int Max(int a, int b)'
    const sig = { label, parameters: [{ label: [8, 13] as [number, number] }, { label: [15, 20] as [number, number] }] }
    expect(kinds(sig)).toContain('b:param')
  })

  it('finds the name a parameter is documented under', () => {
    expect(paramName('Vector3 b')).toBe('b')
    expect(paramName('value: number')).toBe('value')
    expect(paramName('int count = 3')).toBe('count')
  })
})

describe('signature docs', () => {
  it("reads csharp-ls's Parameters / Returns layout", () => {
    const docs = parseDocs(
      'Calculates the distance between two three-dimensional points.\n\nParameters:\na: The first three-dimensional point as a Vector3.\nb: The second three-dimensional point as a Vector3.\n\nReturns:\nThe scalar distance between points a and b.'
    )
    expect(docs.summary).toBe('Calculates the distance between two three-dimensional points.')
    expect(docs.params.b).toBe('The second three-dimensional point as a Vector3.')
    expect(docs.returns).toBe('The scalar distance between points a and b.')
  })

  it('reads JSDoc tags', () => {
    const docs = parseDocs('Clamps a value.\n@param value - The number to clamp\n@returns The clamped number')
    expect(docs.params.value).toBe('The number to clamp')
    expect(docs.returns).toBe('The clamped number')
    expect(docs.summary).toBe('Clamps a value.')
  })
})

describe('tracking the argument under the cursor', () => {
  it('counts top-level commas only', () => {
    expect(argumentIndex('')).toBe(0)
    expect(argumentIndex('a, b')).toBe(1)
    expect(argumentIndex('Foo(1, 2), new[] { 3, 4 }, "x, y", ')).toBe(3)
  })

  it('notices when the call has been closed', () => {
    expect(argumentIndex('a, b) + ')).toBe(-1)
  })

  it('finds the open bracket of the call around the cursor', () => {
    const text = 'var d = Vector3.Distance(a, Lerp(b, c), '
    expect(text[openingBracket(text)]).toBe('(')
    expect(openingBracket(text)).toBe(text.indexOf('('))
    expect(openingBracket('Foo(a); bar')).toBe(-1)
  })
})
