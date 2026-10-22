import { create } from 'zustand'
import type { CommandDef, IdeApi, IdePlugin, PluginContext, SymbolAction } from './api'
import { gatherContext } from './context'
import { ipc } from '../lib/ipc'
import { joinPath } from '../lib/paths'
import { useStore } from '../store/store'
import { allViews, getView } from '../editor/views'
import { scopeField, symbolForActions } from '../editor/scopes'
import { toSymbolInfo } from '../editor/symbolInfo'
import { refreshLenses } from '../editor/codeLens'

const actions: SymbolAction[] = []
const commands: CommandDef[] = []
export interface LoadedPlugin {
  id: string
  name: string
  source: 'built-in' | 'user'
}

/** Kept in a store so the status bar and Settings update when plugins finish loading. */
export const usePlugins = create<{ loaded: LoadedPlugin[] }>(() => ({ loaded: [] }))

export const getSymbolActions = (): readonly SymbolAction[] => actions
export const getCommands = (): readonly CommandDef[] => commands
export const getLoadedPlugins = () => usePlugins.getState().loaded

function refreshAllLenses() {
  for (const view of allViews()) view.dispatch({ effects: refreshLenses.of(null) })
}

export const ide: IdeApi = {
  workspace: {
    root: () => useStore.getState().root,
    readFile: (path) => {
      const view = getView(path)
      return view ? Promise.resolve(view.state.doc.toString()) : ipc.readText(path)
    },
    findTypes: async (names) => {
      const root = useStore.getState().root
      return root ? ipc.findTypeDefinitions(root, names, ['cs', 'ts', 'tsx', 'js', 'java', 'rs']) : []
    }
  },
  editor: {
    activePath: () => useStore.getState().active,
    selectedText: () => {
      const view = getView(useStore.getState().active)
      if (!view) return ''
      const { from, to } = view.state.selection.main
      return view.state.sliceDoc(from, to)
    },
    symbolAtCursor: () => {
      const path = useStore.getState().active
      const view = getView(path)
      if (!view || !path) return null
      const scope = view.state.field(scopeField, false)
      const symbol = scope && symbolForActions(scope.symbols, view.state.selection.main.head)
      return symbol ? toSymbolInfo(view.state, path, symbol) : null
    }
  },
  context: { forSymbol: gatherContext },
  ui: {
    toast: (message, kind) => useStore.getState().toast(message, kind),
    // Native clipboard: the web one refuses writes that happen after an await, long after the click.
    copy: (text) => ipc.copyText(text)
  },
  shell: {
    openUrl: (url) => ipc.openExternal(url),
    which: (program) => ipc.which(program),
    runInTerminal: (cwd, args) => ipc.openInTerminal(cwd, args),
    writeTemp: (name, content) => ipc.writeTemp(name, content)
  },
  settings: {
    get<T>(key: string, fallback: T): T {
      try {
        const raw = localStorage.getItem(`whisk.setting.${key}`)
        return raw === null ? fallback : (JSON.parse(raw) as T)
      } catch {
        return fallback
      }
    },
    set<T>(key: string, value: T) {
      try {
        localStorage.setItem(`whisk.setting.${key}`, JSON.stringify(value))
      } catch {
        // Settings fall back to defaults when storage is unavailable.
      }
    }
  }
}

function contextFor(pluginId: string): PluginContext {
  return {
    ...ide,
    registerSymbolAction(action) {
      actions.push({ ...action, id: `${pluginId}.${action.id}` })
      refreshAllLenses()
    },
    registerCommand(command) {
      commands.push({ ...command, id: `${pluginId}.${command.id}` })
    }
  }
}

async function activate(plugin: IdePlugin, source: 'built-in' | 'user') {
  try {
    await plugin.activate(contextFor(plugin.id))
    usePlugins.setState((s) => ({ loaded: [...s.loaded, { id: plugin.id, name: plugin.name, source }] }))
  } catch (e) {
    useStore.getState().toast(`Plugin ${plugin.name} failed to start: ${e}`, 'error')
  }
}

/** User plugins: `~/.whisk/plugins/<folder>/plugin.js`, an ES module whose default export is an IdePlugin. */
async function loadUserPlugins() {
  const dir = await ipc.pluginsDir()
  const entries = await ipc.listDir(dir)
  for (const entry of entries.filter((e) => e.is_dir)) {
    const file = joinPath(entry.path, 'plugin.js')
    try {
      const code = await ipc.readText(file)
      const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))
      const mod = await import(/* @vite-ignore */ url)
      URL.revokeObjectURL(url)
      const plugin = mod.default as IdePlugin
      if (plugin?.id && typeof plugin.activate === 'function') await activate(plugin, 'user')
    } catch (e) {
      console.warn(`Skipping plugin in ${entry.path}:`, e)
    }
  }
}

let started = false

export async function loadPlugins(builtIns: IdePlugin[]) {
  if (started) return
  started = true
  for (const plugin of builtIns) await activate(plugin, 'built-in')
  await loadUserPlugins().catch((e) => console.warn('User plugins not loaded:', e))
}

export async function openPluginsFolder() {
  const dir = await ipc.pluginsDir()
  await ipc.openPath(dir)
}
