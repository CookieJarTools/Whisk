import { listen } from '@tauri-apps/api/event'
import { ipc, type OpenArgs } from './ipc'
import { joinPath, samePath } from './paths'
import { useStore } from '../store/store'
import { revealLine } from '../editor/views'

/**
 * Folders and files Whisk was asked to open: at start-up, and when it's
 * launched again while already open (from Unity, or Explorer), which the
 * single-instance plugin forwards here instead of opening a second window.
 */
/** Markers of a project's top folder: a Unity project, or a git repository. */
const PROJECT_MARKERS = [['ProjectSettings', 'ProjectVersion.txt'], ['.git']]

/**
 * The project a file belongs to, found by looking upwards from it. Used when Whisk is given
 * just a file, as Unity does for projects without the Whisk package.
 */
async function projectFor(file: string): Promise<string | null> {
  let dir = parentOf(file)
  for (let depth = 0; dir && depth < 12; depth++, dir = parentOf(dir)) {
    for (const marker of PROJECT_MARKERS) {
      if ((await ipc.pathState(marker.reduce(joinPath, dir))) !== 'missing') return dir
    }
  }
  return null
}

function parentOf(path: string): string | null {
  const cut = path.replace(/[\\/]+$/, '').search(/[\\/][^\\/]*$/)
  return cut > 0 ? path.slice(0, cut) : null
}

export async function openArgs({ folder, files }: OpenArgs) {
  const store = useStore.getState()
  if (!folder && files.length && !(store.root && files[0].path.toLowerCase().startsWith(store.root.toLowerCase()))) {
    folder = await projectFor(files[0].path)
  }
  if (folder && !(store.root && samePath(store.root, folder))) store.openFolder(folder)
  for (const file of files) {
    if (!(await useStore.getState().openFile(file.path))) continue
    if (file.line > 0) revealLine(file.path, file.line, Math.max(0, file.col - 1))
  }
}

export function installOpenArgs() {
  void ipc.startupArgs().then(openArgs)
  void listen<OpenArgs>('open-args', (e) => void openArgs(e.payload))
}
