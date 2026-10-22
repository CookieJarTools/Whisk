/**
 * Shortcut strings look like `Ctrl+Shift+F`, `Alt+1` or `F12`, with modifiers
 * always in the order Ctrl, Alt, Shift, Meta. Keys come from `KeyboardEvent.code`
 * (the physical key), so bindings work the same on any keyboard layout and
 * Ctrl+Alt isn't swallowed as AltGr.
 */

/** Rider's double-tap of Shift. */
export const DOUBLE_SHIFT = 'Shift Shift'

const MODIFIERS = ['Ctrl', 'Alt', 'Shift', 'Meta'] as const

const CODE_NAMES: Record<string, string> = {
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Minus: '-',
  Equal: '=',
  Backquote: '`',
  Space: 'Space',
  Enter: 'Enter',
  NumpadEnter: 'Enter',
  Escape: 'Esc',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  NumpadAdd: 'Num+',
  NumpadSubtract: 'Num-',
  NumpadMultiply: 'Num*',
  NumpadDivide: 'Num/'
}

function keyName(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit\d$/.test(code)) return code.slice(5)
  if (/^Numpad\d$/.test(code)) return 'Num' + code.slice(6)
  if (/^F\d{1,2}$/.test(code)) return code
  return CODE_NAMES[code] ?? null
}

const KEY_NAMES: Record<string, string> = {
  ' ': 'Space',
  Escape: 'Esc',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right'
}

/**
 * For events without a `code` (synthetic input, some remote-desktop tools and
 * on-screen keyboards), name the key from `key` instead.
 */
function nameFromKey(key: string): string | null {
  if (KEY_NAMES[key]) return KEY_NAMES[key]
  if (/^F\d{1,2}$/.test(key)) return key
  if (key.length === 1) return key.toUpperCase()
  return /^(Enter|Tab|Backspace|Delete|Insert|Home|End|PageUp|PageDown)$/.test(key) ? key : null
}

export function isModifierKey(key: string): boolean {
  return key === 'Control' || key === 'Shift' || key === 'Alt' || key === 'Meta' || key === 'AltGraph'
}

/** The shortcut a key press makes, or null for a bare modifier or an unknown key. */
export function eventToShortcut(e: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>): string | null {
  if (isModifierKey(e.key)) return null
  const name = e.code ? keyName(e.code) : nameFromKey(e.key)
  if (!name) return null
  const parts: string[] = []
  if (e.ctrlKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  if (e.metaKey) parts.push('Meta')
  parts.push(name)
  return parts.join('+')
}

/** Puts a hand-written shortcut into canonical form: `shift+ctrl+f` → `Ctrl+Shift+F`. */
export function normalizeShortcut(shortcut: string): string {
  if (shortcut.trim().toLowerCase() === DOUBLE_SHIFT.toLowerCase()) return DOUBLE_SHIFT
  const parts = shortcut.split('+').map((p) => p.trim())
  // A trailing empty part means the key itself was `+`.
  const key = parts[parts.length - 1] === '' ? '+' : parts.pop()!
  const mods = new Set(parts.filter(Boolean).map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()))
  if (mods.has('Control')) mods.add('Ctrl')
  if (mods.has('Cmd')) mods.add('Meta')
  const ordered = MODIFIERS.filter((m) => mods.has(m))
  const name = key.length === 1 ? key.toUpperCase() : key.charAt(0).toUpperCase() + key.slice(1)
  return [...ordered, name].join('+')
}

/**
 * Detects Shift tapped twice with nothing else pressed in between.
 * Feed it every keydown and keyup; it returns true on the second tap's release.
 */
export class DoubleShiftDetector {
  private lastTap = 0
  private clean = false

  constructor(private readonly windowMs = 400) {}

  keydown(e: Pick<KeyboardEvent, 'key' | 'repeat'>) {
    if (e.key === 'Shift') {
      if (!e.repeat) this.clean = true
    } else {
      this.clean = false
      this.lastTap = 0
    }
  }

  keyup(e: Pick<KeyboardEvent, 'key'>, now = performance.now()): boolean {
    if (e.key !== 'Shift' || !this.clean) return false
    this.clean = false
    if (now - this.lastTap <= this.windowMs) {
      this.lastTap = 0
      return true
    }
    this.lastTap = now
    return false
  }
}
