import { create } from 'zustand'
import type { PresetId } from '../keymap/presets'
import type { CustomServer } from '../lsp/catalogue'
import type { LintOverrides } from '../lint/config'

/** User preferences, saved to localStorage as one object. */
export interface Settings {
  /** Title bar slides in only when the mouse touches the top edge (Ctrl+Alt+T). */
  hideTitleBar: boolean
  /** Explorer slides in only when the mouse touches the left edge (Ctrl+Alt+S). */
  hideExplorer: boolean
  editorFontSize: number
  wordWrap: boolean
  scopeRails: boolean
  /** The plugin action row above declarations ("✦ Ask Claude · + context"). */
  codeLens: boolean
  keymapPreset: PresetId
  /** Per preset: action id → its bindings, for actions the user has changed. */
  keyOverrides: Partial<Record<PresetId, Record<string, string[]>>>
  /** Language servers the user added themselves. */
  customServers: CustomServer[]
  /** Check for updates in the background and download them, ready to install on restart. */
  autoUpdate: boolean
  /** Offer pre-release versions as updates. */
  prereleases: boolean
  /** Changes to the built-in lint rules; anything unset keeps the rule's default. */
  lint: LintOverrides
  /** Reopen each project's tabs from last time. */
  reopenFiles: boolean
  /** Save unsaved files when Whisk loses focus, like Rider. */
  autoSaveOnBlur: boolean
  /** Save unsaved files after this many idle seconds, like Rider. */
  autoSaveIdle: boolean
  autoSaveIdleSeconds: number
}

interface SettingsStore extends Settings {
  set(patch: Partial<Settings>): void
  /** Zen's compact mode: both bars hidden, or both shown (Ctrl+Alt+C). */
  toggleCompact(): void
}

const KEY = 'whisk.settings'

export const DEFAULT_SETTINGS: Settings = {
  hideTitleBar: false,
  hideExplorer: false,
  editorFontSize: 12.5,
  wordWrap: false,
  scopeRails: true,
  codeLens: true,
  keymapPreset: 'whisk',
  keyOverrides: {},
  customServers: [],
  autoUpdate: true,
  prereleases: false,
  lint: {},
  reopenFiles: true,
  autoSaveOnBlur: true,
  autoSaveIdle: true,
  autoSaveIdleSeconds: 15
}

export const FONT_SIZES = { min: 10, max: 20, step: 0.5 }

/** Keymap presets a saved setting may name; anything else (e.g. a renamed preset) falls back to the default. */
const KNOWN_PRESETS: PresetId[] = ['whisk', 'rider', 'vscode', 'visualstudio']

function load(): Settings {
  try {
    const saved: Settings = { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
    if (!KNOWN_PRESETS.includes(saved.keymapPreset)) saved.keymapPreset = DEFAULT_SETTINGS.keymapPreset
    return saved
  } catch {
    return DEFAULT_SETTINGS
  }
}

function save(settings: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings))
  } catch {
    // Preferences fall back to defaults when storage is unavailable.
  }
}

function pick(s: SettingsStore): Settings {
  const { hideTitleBar, hideExplorer, editorFontSize, wordWrap, scopeRails, codeLens, keymapPreset, keyOverrides, customServers, autoUpdate, prereleases, lint, reopenFiles, autoSaveOnBlur, autoSaveIdle, autoSaveIdleSeconds } = s
  return { hideTitleBar, hideExplorer, editorFontSize, wordWrap, scopeRails, codeLens, keymapPreset, keyOverrides, customServers, autoUpdate, prereleases, lint, reopenFiles, autoSaveOnBlur, autoSaveIdle, autoSaveIdleSeconds }
}

export const useSettings = create<SettingsStore>((set, get) => ({
  ...load(),
  set(patch) {
    set(patch)
    save(pick(get()))
  },
  toggleCompact() {
    const compact = get().hideTitleBar && get().hideExplorer
    get().set({ hideTitleBar: !compact, hideExplorer: !compact })
  }
}))

export const isCompact = (s: Settings) => s.hideTitleBar && s.hideExplorer
