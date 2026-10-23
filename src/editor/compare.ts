import { open } from '@tauri-apps/plugin-dialog'
import { ipc } from '../lib/ipc'
import { baseName } from '../lib/paths'
import { useStore } from '../store/store'
import { getView } from './views'

/** "Compare with…" actions: the active file against the clipboard or another file. */

function activeFile(): { path: string; text: string } | null {
  const path = useStore.getState().active
  const view = path ? getView(path) : null
  return path && view ? { path, text: view.state.doc.toString() } : null
}

export async function compareWithClipboard() {
  const file = activeFile()
  if (!file) return useStore.getState().toast('Open a file to compare first.')
  const clip = await ipc.pasteText().catch(() => '')
  if (!clip) return useStore.getState().toast('The clipboard has no text to compare with.')
  useStore.getState().openDiff(`clip:${file.path}`, `${baseName(file.path)} ↔ clipboard`, {
    leftTitle: baseName(file.path),
    left: file.text,
    rightTitle: 'Clipboard',
    right: clip,
    path: file.path
  })
}

export async function compareWithFile() {
  const file = activeFile()
  if (!file) return useStore.getState().toast('Open a file to compare first.')
  const picked = await open({ title: `Compare ${baseName(file.path)} with…`, defaultPath: useStore.getState().root ?? undefined })
  if (typeof picked !== 'string') return
  const other = getView(picked)?.state.doc.toString() ?? (await ipc.readText(picked))
  useStore.getState().openDiff(`file:${file.path}|${picked}`, `${baseName(file.path)} ↔ ${baseName(picked)}`, {
    leftTitle: file.path,
    left: file.text,
    rightTitle: picked,
    right: other,
    path: file.path
  })
}
