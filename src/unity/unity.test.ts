import { describe, expect, it } from 'vitest'
import { compareVersions, debuggerPort } from './unity'

describe('unity', () => {
  it('finds the editor debugger port from its process id', () => {
    // Checked against a running Unity 6000.4 editor: process 19392 listened on 56392.
    expect(debuggerPort(19392)).toBe(56392)
    expect(debuggerPort(25764)).toBe(56764)
  })

  it('compares package versions', () => {
    expect(compareVersions('1.0.1', '1.0.0')).toBeGreaterThan(0)
    expect(compareVersions('1.2', '1.10')).toBeLessThan(0)
    expect(compareVersions('2.0.0', '2.0')).toBe(0)
  })
})
