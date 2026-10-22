import { describe, expect, it } from 'vitest'
import { DOUBLE_SHIFT, DoubleShiftDetector, eventToShortcut, normalizeShortcut } from './keys'
import { PRESETS, PRESET_ORDER } from './presets'
import { BUILT_IN_ACTIONS } from './actions'

const key = (code: string, mods: Partial<Record<'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey', boolean>> = {}, k = 'x') => ({
  key: k,
  code,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods
})

describe('shortcuts', () => {
  it('names key presses by physical key, modifiers in a fixed order', () => {
    expect(eventToShortcut(key('KeyF', { shiftKey: true, ctrlKey: true }))).toBe('Ctrl+Shift+F')
    expect(eventToShortcut(key('F12'))).toBe('F12')
    expect(eventToShortcut(key('Comma', { ctrlKey: true }))).toBe('Ctrl+,')
    expect(eventToShortcut(key('ArrowLeft', { ctrlKey: true, altKey: true }))).toBe('Ctrl+Alt+Left')
    expect(eventToShortcut(key('ShiftLeft', { shiftKey: true }, 'Shift'))).toBeNull()
  })

  it('normalises hand-written shortcuts', () => {
    expect(normalizeShortcut('shift+ctrl+f')).toBe('Ctrl+Shift+F')
    expect(normalizeShortcut('alt+1')).toBe('Alt+1')
    expect(normalizeShortcut('shift shift')).toBe(DOUBLE_SHIFT)
  })

  it('detects a double tap of Shift, and nothing else', () => {
    const d = new DoubleShiftDetector(400)
    d.keydown({ key: 'Shift', repeat: false })
    expect(d.keyup({ key: 'Shift' }, 1000)).toBe(false)
    d.keydown({ key: 'Shift', repeat: false })
    expect(d.keyup({ key: 'Shift' }, 1200)).toBe(true)

    // Shift+A in between breaks it (that's typing a capital).
    d.keydown({ key: 'Shift', repeat: false })
    d.keyup({ key: 'Shift' }, 2000)
    d.keydown({ key: 'Shift', repeat: false })
    d.keydown({ key: 'A', repeat: false })
    expect(d.keyup({ key: 'Shift' }, 2100)).toBe(false)

    // Too slow.
    d.keydown({ key: 'Shift', repeat: false })
    d.keyup({ key: 'Shift' }, 3000)
    d.keydown({ key: 'Shift', repeat: false })
    expect(d.keyup({ key: 'Shift' }, 3600)).toBe(false)
  })
})

describe('presets', () => {
  const known = new Set(BUILT_IN_ACTIONS.map((a) => a.id))

  for (const id of PRESET_ORDER) {
    it(`${id}: binds only real actions, each key once, in canonical form`, () => {
      const seen = new Map<string, string>()
      for (const [actionId, keys] of Object.entries(PRESETS[id].bindings)) {
        expect(known.has(actionId), `unknown action ${actionId}`).toBe(true)
        for (const k of keys) {
          expect(normalizeShortcut(k)).toBe(k)
          expect(seen.get(k), `${k} bound to both ${seen.get(k)} and ${actionId}`).toBeUndefined()
          seen.set(k, actionId)
        }
      }
    })
  }

  it('puts Search Everywhere on double Shift in every preset', () => {
    for (const id of PRESET_ORDER) expect(PRESETS[id].bindings['search.everywhere']).toContain(DOUBLE_SHIFT)
  })
})

describe('shortcuts without a key code', () => {
  it('falls back to the key name', () => {
    expect(eventToShortcut(key('', { ctrlKey: true }, 'f'))).toBe('Ctrl+F')
    expect(eventToShortcut(key('', {}, 'F12'))).toBe('F12')
    expect(eventToShortcut(key('', { altKey: true }, 'ArrowLeft'))).toBe('Alt+Left')
  })
})
