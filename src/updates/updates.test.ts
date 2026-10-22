import { describe, expect, it } from 'vitest'
import { compareVersions } from './updates'

describe('compareVersions', () => {
  it('orders releases and pre-releases', () => {
    expect(compareVersions('0.2.0', '0.1.9')).toBe(1)
    expect(compareVersions('v1.0.0', '1.0.0')).toBe(0)
    expect(compareVersions('1.0.0-beta.2', '1.0.0')).toBe(-1)
    expect(compareVersions('1.0.0-beta.10', '1.0.0-beta.2')).toBe(1)
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1)
  })
})
