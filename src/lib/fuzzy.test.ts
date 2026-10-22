import { describe, expect, it } from 'vitest'
import { fuzzyMatch } from './fuzzy'

describe('fuzzyMatch', () => {
  it('matches CamelCase humps', () => {
    const m = fuzzyMatch('VCh', 'VoxelChunk')
    expect(m).not.toBeNull()
    expect(m!.positions).toEqual([0, 5, 6])
  })

  it('rejects out-of-order characters', () => {
    expect(fuzzyMatch('kv', 'VoxelChunk')).toBeNull()
  })

  it('ranks word-start and substring hits above scattered ones', () => {
    const humps = fuzzyMatch('wv', 'WorldVoxel')!.score
    const scattered = fuzzyMatch('wv', 'awkwardvalue')!.score
    expect(humps).toBeGreaterThan(scattered)
    const exact = fuzzyMatch('chunk', 'VoxelChunk')!.score
    expect(exact).toBeGreaterThan(humps)
  })

  it('prefers shorter texts on ties', () => {
    expect(fuzzyMatch('player', 'Player')!.score).toBeGreaterThan(fuzzyMatch('player', 'PlayerController')!.score)
  })
})
