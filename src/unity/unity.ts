import { create } from 'zustand'
import { ipc } from '../lib/ipc'
import { joinPath } from '../lib/paths'
import { useStore } from '../store/store'

/**
 * Unity projects. Whisk ships a small Unity package (unity/com.cookiejar.ide.whisk) that
 * adds Whisk to Unity's script editor list, writes the .csproj/.sln files, and gets the
 * editor ready for the debugger. Setting up copies it into the project's Packages folder,
 * where it travels with the project (so teammates get it too) and Whisk keeps it current.
 */

export const PACKAGE_NAME = 'com.cookiejar.ide.whisk'

export type UnityState =
  | { kind: 'none' }
  /** A Unity project without the package. */
  | { kind: 'available' }
  | { kind: 'installed'; version: string }

interface UnityStore {
  state: UnityState
  /** Dismissed the set-up banner for this project. */
  dismissed: boolean
}

export const useUnity = create<UnityStore>(() => ({ state: { kind: 'none' }, dismissed: false }))

const dismissKey = (root: string) => `whisk.unity.dismissed.${root.replace(/\\/g, '/').toLowerCase()}`

const at = (root: string, ...parts: string[]) => parts.reduce((p, part) => joinPath(p, part), root)

export async function isUnityProject(root: string): Promise<boolean> {
  const [assets, version] = await Promise.all([ipc.pathState(at(root, 'Assets')), ipc.pathState(at(root, 'ProjectSettings', 'ProjectVersion.txt'))])
  return assets !== 'missing' && version !== 'missing'
}

async function versionIn(packageFolder: string): Promise<string | null> {
  const text = await ipc.readText(joinPath(packageFolder, 'package.json')).catch(() => null)
  if (!text) return null
  try {
    return String(JSON.parse(text).version ?? '') || null
  } catch {
    return null
  }
}

/** Compares dotted versions: positive when `a` is newer. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d) return d
  }
  return 0
}

const bundledPackage = () => ipc.bundledPath(`unity/${PACKAGE_NAME}`)

/** Copies the package into the project, replacing an older copy. */
async function installPackage(root: string) {
  await ipc.copyDir(await bundledPackage(), at(root, 'Packages', PACKAGE_NAME))
}

/** Asks the package (once Unity has loaded it) to make Whisk the script editor. */
async function requestMakeDefault(root: string) {
  await ipc.writeText(at(root, 'Library', 'Whisk', 'make-default'), new Date().toISOString())
}

/** Looks at the open project, and quietly updates the package if this Whisk has a newer one. */
export async function refreshUnity() {
  const root = useStore.getState().root
  if (!root || !(await isUnityProject(root))) return useUnity.setState({ state: { kind: 'none' } })
  let dismissed = false
  try {
    dismissed = localStorage.getItem(dismissKey(root)) === '1'
  } catch {
    dismissed = false
  }
  const installed = await versionIn(at(root, 'Packages', PACKAGE_NAME))
  if (!installed) return useUnity.setState({ state: { kind: 'available' }, dismissed })
  const bundled = await versionIn(await bundledPackage())
  if (bundled && compareVersions(bundled, installed) > 0) {
    await installPackage(root)
    useStore.getState().toast(`Updated the Whisk package in this Unity project to ${bundled}.`)
    return useUnity.setState({ state: { kind: 'installed', version: bundled }, dismissed })
  }
  useUnity.setState({ state: { kind: 'installed', version: installed }, dismissed })
}

/** The one-click set-up: add the package and make Whisk Unity's script editor. */
export async function setUpUnity({ makeDefault = true } = {}) {
  const root = useStore.getState().root
  if (!root) return
  try {
    await installPackage(root)
    if (makeDefault) await requestMakeDefault(root)
    await refreshUnity()
    useStore
      .getState()
      .toast(
        makeDefault
          ? 'Whisk is set up for Unity. Switch to Unity: once it has imported the package, Whisk is your script editor.'
          : 'Added the Whisk package. Pick Whisk in Unity under Preferences › External Tools.',
        'success'
      )
  } catch (e) {
    useStore.getState().toast(`Couldn't set up Unity: ${e}`, 'error')
  }
}

export async function makeWhiskDefault() {
  const root = useStore.getState().root
  if (!root) return
  await requestMakeDefault(root)
  useStore.getState().toast('Asked Unity to use Whisk. It takes effect as soon as Unity has focus.', 'success')
}

export function dismissUnityBanner() {
  const root = useStore.getState().root
  if (root) {
    try {
      localStorage.setItem(dismissKey(root), '1')
    } catch {
      // Not remembered; it shows again next time.
    }
  }
  useUnity.setState({ dismissed: true })
}

export interface EditorInstance {
  processId: number
  version: string
}

/** The Unity editor that has this project open, from the file Unity writes while it runs. */
export async function editorInstance(root: string): Promise<EditorInstance | null> {
  const text = await ipc.readText(at(root, 'Library', 'EditorInstance.json')).catch(() => null)
  if (!text) return null
  try {
    const json = JSON.parse(text)
    return typeof json.process_id === 'number' ? { processId: json.process_id, version: String(json.version ?? '') } : null
  } catch {
    return null
  }
}

/** Unity's editor listens for debuggers on 56000 plus the last three digits of its process id. */
export function debuggerPort(processId: number): number {
  return 56000 + (processId % 1000)
}

let installed = false

export function installUnity() {
  if (installed) return
  installed = true
  let root = useStore.getState().root
  void refreshUnity()
  useStore.subscribe((s) => {
    if (s.root === root) return
    root = s.root
    void refreshUnity()
  })
}
