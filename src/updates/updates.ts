import { create } from 'zustand'
import { listen } from '@tauri-apps/api/event'
import { getVersion } from '@tauri-apps/api/app'
import { ipc, type Release, type UpdateInfo } from '../lib/ipc'
import { useSettings } from '../store/settings'
import { useStore } from '../store/store'

/**
 * Update state and the background checker. Updates come from GitHub releases;
 * with automatic updates on, a newer version is downloaded quietly and the
 * status bar offers to restart into it.
 */

export type UpdatePhase = 'idle' | 'checking' | 'none' | 'available' | 'downloading' | 'ready' | 'installing' | 'error'

interface UpdateStore {
  currentVersion: string
  phase: UpdatePhase
  info: UpdateInfo | null
  /** 0–1 while downloading, when the size is known. */
  progress: number | null
  error: string | null
  lastChecked: number | null
  releases: Release[] | null
  set(patch: Partial<Omit<UpdateStore, 'set'>>): void
}

export const useUpdates = create<UpdateStore>((set) => ({
  currentVersion: '',
  phase: 'idle',
  info: null,
  progress: null,
  error: null,
  lastChecked: null,
  releases: null,
  set: (patch) => set(patch)
}))

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000
const FIRST_CHECK_DELAY_MS = 15_000

/** Compares versions like `1.2.0`, `1.2.0-beta.1`: numbers first, and a pre-release sorts before its release. */
export function compareVersions(a: string, b: string): number {
  const [coreA, preA] = a.replace(/^v/, '').split('-', 2)
  const [coreB, preB] = b.replace(/^v/, '').split('-', 2)
  const nums = (s: string) => s.split('.').map((n) => parseInt(n, 10) || 0)
  const na = nums(coreA)
  const nb = nums(coreB)
  for (let i = 0; i < Math.max(na.length, nb.length); i++) {
    const d = (na[i] ?? 0) - (nb[i] ?? 0)
    if (d !== 0) return Math.sign(d)
  }
  if (preA === preB) return 0
  if (!preA) return 1
  if (!preB) return -1
  return preA.localeCompare(preB, undefined, { numeric: true })
}

export async function loadReleases(): Promise<Release[]> {
  const releases = await ipc.listReleases()
  useUpdates.getState().set({ releases })
  return releases
}

/**
 * Finds the newest version to offer: the latest stable release, or with
 * pre-releases on, the newest installable release of any kind.
 */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  const { set, phase } = useUpdates.getState()
  if (phase === 'downloading' || phase === 'installing') return null
  set({ phase: 'checking', error: null })
  try {
    let info: UpdateInfo | null
    if (useSettings.getState().prereleases) {
      const releases = await loadReleases()
      const current = useUpdates.getState().currentVersion
      const newest = releases.filter((r) => r.installable).sort((a, b) => compareVersions(b.version, a.version))[0]
      info = newest && compareVersions(newest.version, current) > 0 ? await ipc.checkUpdate(newest.tag) : null
    } else {
      info = await ipc.checkUpdate()
    }
    set({ phase: info ? 'available' : 'none', info, lastChecked: Date.now() })
    return info
  } catch (e) {
    set({ phase: 'error', error: String(e), lastChecked: Date.now() })
    return null
  }
}

/** Prepares a specific release (newer or older) for installing. */
export async function selectVersion(tag: string): Promise<UpdateInfo | null> {
  const { set } = useUpdates.getState()
  set({ phase: 'checking', error: null })
  try {
    const info = await ipc.checkUpdate(tag)
    set({ phase: info ? 'available' : 'none', info })
    return info
  } catch (e) {
    set({ phase: 'error', error: String(e) })
    return null
  }
}

export async function downloadUpdate(): Promise<boolean> {
  const { set } = useUpdates.getState()
  set({ phase: 'downloading', progress: 0, error: null })
  try {
    await ipc.downloadUpdate()
    set({ phase: 'ready', progress: 1 })
    return true
  } catch (e) {
    set({ phase: 'error', error: String(e), progress: null })
    return false
  }
}

export async function installUpdate() {
  const { set } = useUpdates.getState()
  const dirty = Object.values(useStore.getState().dirty).some(Boolean)
  if (dirty && !window.confirm('You have unsaved changes. Restart and update anyway? Unsaved changes will be lost.')) return
  set({ phase: 'installing' })
  try {
    await ipc.installUpdate()
  } catch (e) {
    set({ phase: 'error', error: String(e) })
  }
}

async function backgroundCheck() {
  if (!useSettings.getState().autoUpdate) return
  const phase = useUpdates.getState().phase
  if (phase === 'ready' || phase === 'downloading' || phase === 'installing') return
  const info = await checkForUpdate()
  if (info && (await downloadUpdate())) {
    useStore.getState().toast(`Whisk ${info.version} is ready. Restart from the status bar to update.`, 'success')
  }
}

let started = false

export function startUpdater() {
  if (started) return
  started = true
  getVersion().then((v) => useUpdates.getState().set({ currentVersion: v }))
  listen<{ downloaded: number; total: number | null }>('update-progress', (e) => {
    const { downloaded, total } = e.payload
    useUpdates.getState().set({ progress: total ? downloaded / total : null })
  })
  // Development builds aren't installed, so there's nothing to update.
  if (import.meta.env.DEV) return
  setTimeout(backgroundCheck, FIRST_CHECK_DELAY_MS)
  setInterval(backgroundCheck, CHECK_EVERY_MS)
}
