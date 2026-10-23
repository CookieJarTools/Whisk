import { useStore } from '../store/store'
import { useSettings } from '../store/settings'
import { saveFile } from './actions'

/**
 * Rider-style auto save: unsaved files are written when Whisk loses focus
 * (switching to another app) and after a few seconds without typing. Both
 * are settings, on by default as in Rider.
 */

export async function saveAllDirty() {
  const { dirty } = useStore.getState()
  for (const [path, isDirty] of Object.entries(dirty)) {
    if (isDirty) await saveFile(path)
  }
}

let idleTimer = 0
let installed = false

function scheduleIdleSave() {
  clearTimeout(idleTimer)
  const { autoSaveIdle, autoSaveIdleSeconds } = useSettings.getState()
  if (!autoSaveIdle) return
  if (!Object.values(useStore.getState().dirty).some(Boolean)) return
  idleTimer = window.setTimeout(() => void saveAllDirty(), Math.max(1, autoSaveIdleSeconds) * 1000)
}

export function installAutoSave() {
  if (installed) return
  installed = true
  window.addEventListener('blur', () => {
    if (useSettings.getState().autoSaveOnBlur) void saveAllDirty()
  })
  // Every edit or cursor move restarts the idle countdown.
  useStore.subscribe((s, prev) => {
    if (s.dirty !== prev.dirty || s.cursor !== prev.cursor) scheduleIdleSave()
  })
  useSettings.subscribe((s, prev) => {
    if (s.autoSaveIdle !== prev.autoSaveIdle || s.autoSaveIdleSeconds !== prev.autoSaveIdleSeconds) scheduleIdleSave()
  })
}
