import { create } from 'zustand'
import { ipc } from '../lib/ipc'
import { joinPath, relativePath } from '../lib/paths'
import { useStore } from '../store/store'
import { usePanel } from '../store/panel'
import { closeTerminal, openTerminal, stopTerminal, useTerminals } from '../terminal/terminals'
import { saveAllDirty } from '../editor/autoSave'
import { currentFileConfig, detectConfigs, parseProjectConfigs, PROJECT_RUN_FILE, serializeProjectConfigs, type RunConfig } from './configs'

interface RunState {
  /** Shared ones from .whisk/run.json first, then the ones Whisk found. */
  configs: RunConfig[]
  selected: string | null
  /** Run configuration id → the terminal it's running in. */
  running: Record<string, number>
  loading: boolean
}

export const useRun = create<RunState>(() => ({ configs: [], selected: null, running: {}, loading: false }))

const selectedKey = (root: string) => `whisk.run.${root.replace(/\\/g, '/').toLowerCase()}`

function rememberSelection(id: string | null) {
  const root = useStore.getState().root
  if (!root) return
  try {
    localStorage.setItem(selectedKey(root), id ?? '')
  } catch {
    // Not remembered.
  }
}

function remembered(root: string): string | null {
  try {
    return localStorage.getItem(selectedKey(root)) || null
  } catch {
    return null
  }
}

/** Finds the project's run configurations again (on open, and after editing run.json). */
export async function loadConfigs() {
  const root = useStore.getState().root
  if (!root) {
    useRun.setState({ configs: [], selected: null })
    return
  }
  useRun.setState({ loading: true })
  try {
    const files = (await ipc.listFiles(root).catch(() => [] as string[])).map((p) => relativePath(root, p).replace(/\\/g, '/'))
    const read = (rel: string) => ipc.readText(joinPath(root, rel)).catch(() => null)
    const shared = parseProjectConfigs((await read(PROJECT_RUN_FILE)) ?? '')
    const found = await detectConfigs(files, read)
    if (useStore.getState().root !== root) return
    const configs = [...shared, ...found]
    const keep = useRun.getState().selected ?? remembered(root)
    const selected = configs.some((c) => c.id === keep) || keep === 'current-file' ? keep : (configs[0]?.id ?? 'current-file')
    useRun.setState({ configs, selected })
  } finally {
    useRun.setState({ loading: false })
  }
}

export function selectConfig(id: string) {
  useRun.setState({ selected: id })
  rememberSelection(id)
}

/** The selected configuration; "Current file" is worked out from the active editor each time. */
export function selectedConfig(): RunConfig | null {
  const { configs, selected } = useRun.getState()
  if (selected === 'current-file') return activeFileConfig()
  return configs.find((c) => c.id === selected) ?? null
}

export function activeFileConfig(): RunConfig | null {
  const { root, active } = useStore.getState()
  if (!root || !active || active.startsWith('diff:')) return null
  return currentFileConfig(relativePath(root, active).replace(/\\/g, '/'))
}

/** Runs a configuration in the Run panel, stopping an earlier run of it first. */
export async function runConfig(config: RunConfig) {
  const root = useStore.getState().root
  if (!root) return
  const previous = useRun.getState().running[config.id]
  if (previous !== undefined) {
    stopTerminal(previous)
    closeTerminal(previous)
  }
  // Save first, as an IDE should, so the run sees what's on screen.
  await saveAllDirty()
  usePanel.getState().show('run')
  const id = await openTerminal({
    kind: 'run',
    title: config.name,
    cwd: config.cwd ? joinPath(root, config.cwd) : root,
    commandLine: config.command,
    env: config.env,
    onExit: () =>
      useRun.setState((s) => {
        const running = { ...s.running }
        if (running[config.id] === id) delete running[config.id]
        return { running }
      })
  })
  useRun.setState((s) => ({ running: { ...s.running, [config.id]: id } }))
}

export function runSelected() {
  const config = selectedConfig()
  if (config && !config.command) return useStore.getState().toast(`“${config.name}” is for debugging: press the bug button.`)
  if (config) return runConfig(config)
  useStore.getState().toast(useRun.getState().selected === 'current-file' ? 'Whisk doesn’t know how to run this kind of file. Add a configuration for it.' : 'Pick something to run first.')
}

export function stopSelected() {
  const { running, selected } = useRun.getState()
  const config = selectedConfig()
  const id = running[config?.id ?? selected ?? ''] ?? Object.values(running)[0]
  if (id !== undefined) stopTerminal(id)
}

export function isRunning(configId: string | null): boolean {
  if (!configId) return false
  const id = useRun.getState().running[configId]
  return id !== undefined && useTerminals.getState().terminals.some((t) => t.id === id && t.exitCode === undefined)
}

/** Saves the shared configurations to .whisk/run.json and reloads. */
export async function saveProjectConfigs(configs: RunConfig[]) {
  const root = useStore.getState().root
  if (!root) return
  await ipc.writeText(joinPath(root, PROJECT_RUN_FILE), serializeProjectConfigs(configs))
  await loadConfigs()
  useStore.getState().refreshTree()
}

let installed = false

export function installRun() {
  if (installed) return
  installed = true
  let root = useStore.getState().root
  void loadConfigs()
  useStore.subscribe((s) => {
    if (s.root === root) return
    root = s.root
    useRun.setState({ selected: null, running: {} })
    void loadConfigs()
  })
}
