import { describe, expect, it } from 'vitest'
import { contains, toLocations } from './usages'

const range = (sl: number, sc: number, el: number, ec: number) => ({ start: { line: sl, character: sc }, end: { line: el, character: ec } })

describe('go to declaration or usages', () => {
  it('accepts every shape a server can answer textDocument/definition with', () => {
    const single = { uri: 'file:///a.cs', range: range(1, 2, 1, 5) }
    expect(toLocations(single)).toEqual([single])
    expect(toLocations([single])).toEqual([single])
    expect(toLocations(null)).toEqual([])
    const link = { targetUri: 'file:///b.cs', targetRange: range(0, 0, 9, 1), targetSelectionRange: range(3, 6, 3, 12) }
    // The name's own range, not the whole declaration, so a click on the name counts as "on the declaration".
    expect(toLocations([link])).toEqual([{ uri: 'file:///b.cs', range: range(3, 6, 3, 12) }])
  })

  it('knows when the cursor is on the declared name', () => {
    const name = range(7, 24, 7, 40)
    expect(contains(name, { line: 7, character: 24 })).toBe(true)
    expect(contains(name, { line: 7, character: 40 })).toBe(true)
    expect(contains(name, { line: 7, character: 23 })).toBe(false)
    expect(contains(name, { line: 8, character: 30 })).toBe(false)
  })
})
