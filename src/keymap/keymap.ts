import { useSettings } from '../store/settings'
import { useStore } from '../store/store'
import { getCommands, ide } from '../plugins/host'
import { getView } from '../editor/views'
import { BUILT_IN_ACTIONS, type Action } from './actions'
import { DOUBLE_SHIFT, DoubleShiftDetector, eventToShortcut, normalizeShortcut } from './keys'
import { PRESETS, type PresetId } from './presets'

/**
 * The live keymap: preset defaults, then plugin defaults, then the user's
 * overrides for the current preset. One capture-phase listener on the window
 * dispatches every shortcut, so the editor never sees keys an action claims.
 */

export function allActions(): Action[] {
  const pluginActions: Action[] = getCommands().map((c) => ({
    id: c.id,
    title: c.title,
    category: 'Plugins',
    run: () => void c.run(ide)
  }))
  return [...BUILT_IN_ACTIONS, ...pluginActions]
}

/** Defaults for an action in a preset, before the user's changes. */
export function defaultBindings(actionId: string, preset: PresetId = useSettings.getState().keymapPreset): string[] {
  const fromPreset = PRESETS[preset].bindings[actionId]
  if (fromPreset) return fromPreset
  return getCommands().find((c) => c.id === actionId)?.keys?.map(normalizeShortcut) ?? []
}

export function bindingsFor(actionId: string): string[] {
  const { keymapPreset, keyOverrides } = useSettings.getState()
  return keyOverrides[keymapPreset]?.[actionId] ?? defaultBindings(actionId, keymapPreset)
}

export function isModified(actionId: string): boolean {
  const { keymapPreset, keyOverrides } = useSettings.getState()
  return !!keyOverrides[keymapPreset]?.[actionId]
}

/** Actions bound to `shortcut`, other than `except`. */
export function actionsBoundTo(shortcut: string, except?: string): Action[] {
  return allActions().filter((a) => a.id !== except && bindingsFor(a.id).includes(shortcut))
}

/** First binding, for menus and hints. */
export function shortcutLabel(actionId: string): string {
  return bindingsFor(actionId)[0] ?? ''
}

export function setBindings(actionId: string, bindings: string[]) {
  const { keymapPreset, keyOverrides, set } = useSettings.getState()
  const forPreset = { ...(keyOverrides[keymapPreset] ?? {}) }
  const defaults = defaultBindings(actionId, keymapPreset)
  if (bindings.length === defaults.length && bindings.every((b, i) => b === defaults[i])) delete forPreset[actionId]
  else forPreset[actionId] = bindings
  set({ keyOverrides: { ...keyOverrides, [keymapPreset]: forPreset } })
}

export function resetBindings(actionId?: string) {
  const { keymapPreset, keyOverrides, set } = useSettings.getState()
  if (!actionId) {
    set({ keyOverrides: { ...keyOverrides, [keymapPreset]: {} } })
    return
  }
  const forPreset = { ...(keyOverrides[keymapPreset] ?? {}) }
  delete forPreset[actionId]
  set({ keyOverrides: { ...keyOverrides, [keymapPreset]: forPreset } })
}

function lookup(shortcut: string): Action | undefined {
  return allActions().find((a) => bindingsFor(a.id).includes(shortcut))
}

/** Set while the keymap settings page is recording a new shortcut. */
let recording = false
export function setRecording(on: boolean) {
  recording = on
}

/** Plain text-editing keys a text field must keep, even if an action uses them. */
const TEXT_FIELD_KEYS = /^(Ctrl\+(Shift\+)?(A|C|V|X|Z|Y|Left|Right|Backspace|Delete|Home|End)|Shift\+.|.)$/

function inTextField(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')
}

function dispatch(shortcut: string, event?: KeyboardEvent): boolean {
  const action = lookup(shortcut)
  if (!action) return false
  if (action.editor && !getView(useStore.getState().active)) return false
  if (event && inTextField(event.target) && (action.editor || TEXT_FIELD_KEYS.test(shortcut))) return false
  event?.preventDefault()
  event?.stopPropagation()
  action.run()
  return true
}

const doubleShift = new DoubleShiftDetector()

function onKeyDown(e: KeyboardEvent) {
  if (recording) return
  doubleShift.keydown(e)
  const shortcut = eventToShortcut(e)
  if (shortcut) dispatch(shortcut, e)
}

function onKeyUp(e: KeyboardEvent) {
  if (recording) return
  if (doubleShift.keyup(e)) dispatch(DOUBLE_SHIFT)
}

let installed = false

export function installKeymap() {
  if (installed) return
  installed = true
  window.addEventListener('keydown', onKeyDown, true)
  window.addEventListener('keyup', onKeyUp, true)
}
