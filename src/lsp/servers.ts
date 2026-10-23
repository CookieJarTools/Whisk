import { LSPClient, hoverTooltips, serverCompletion } from '@codemirror/lsp-client'
import { mergedServerDiagnostics, pullDiagnostics } from '../lint/diagnostics'
import { codeActionCapabilities } from './codeActions'
import { Compartment } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { ipc } from '../lib/ipc'
import { languageFor } from '../lib/languages'
import { baseName, extension, pathToUri } from '../lib/paths'
import { useStore } from '../store/store'
import { useSettings } from '../store/settings'
import { getView } from '../editor/views'
import { tauriTransport, type TauriTransport } from './transport'
import { IdeWorkspace } from './workspace'
import { BUILT_IN_SERVERS, type ServerDef } from './catalogue'

export type { ServerDef }

/** Built-in servers plus the user's own, theirs first so they can override a built-in. */
export function allServers(): ServerDef[] {
  const custom: ServerDef[] = useSettings.getState().customServers.map((c) => ({
    ...c,
    languages: c.extensions.map((e) => '.' + e).join(' '),
    homepage: '',
    custom: true
  }))
  return [...custom, ...BUILT_IN_SERVERS]
}

export function serverFor(path: string): ServerDef | null {
  const ext = extension(path)
  const name = baseName(path)
  return allServers().find((s) => s.extensions.includes(ext) || s.fileNames?.includes(name)) ?? null
}

interface Running {
  client: LSPClient
  transport: TauriTransport
  processId: number
}

const starting = new Map<string, Promise<Running | null>>()

/** Each view holds its LSP plugin here so it can be attached once the server is up. */
export const lspCompartment = new Compartment()

async function start(def: ServerDef, root: string): Promise<Running | null> {
  const key = def.key
  const store = useStore.getState()
  if (!(await ipc.which(def.command))) {
    store.setServer(key, 'missing', `${def.label} isn't installed. Install it from Settings › Language servers.`)
    return null
  }
  store.setServer(key, 'starting', `Starting ${def.label}…`)
  try {
    const processId = await ipc.lspStart(def.command, def.args, root)
    const rootUri = pathToUri(root)
    const transport = await tauriTransport(processId, rootUri, () => {
      starting.delete(key)
      useStore.getState().setServer(key, 'stopped', `${def.label} stopped`)
    })
    const client = new LSPClient({
      rootUri,
      timeout: 10_000,
      workspace: (c) => new IdeWorkspace(c),
      // No LSP keymaps: rename, definition, usages and format are keymap actions.
      // Parameter info is Whisk's own (editor/signatureHelp.ts); hover docs show after 150 ms rather than 300.
      extensions: [serverCompletion(), hoverTooltips({ hoverTime: 150 }), mergedServerDiagnostics(), codeActionCapabilities()],
      unhandledNotification: (_c, method, params) => {
        if (method === '$/progress' && params?.value?.kind !== 'end') {
          const v = params.value
          const text = [v?.title, v?.message].filter(Boolean).join(' — ')
          if (text) useStore.getState().setServer(key, 'ready', text)
        } else if (method === '$/progress') {
          useStore.getState().setServer(key, 'ready', `${def.label} ready`)
          // Loading (e.g. the solution) finished: ask again for errors in every open file it serves.
          for (const tab of useStore.getState().tabs) {
            const view = getView(tab.path)
            if (view && serverFor(tab.path)?.key === key) void pullDiagnostics(view)
          }
        }
      }
    }).connect(transport)
    await client.initializing
    useStore.getState().setServer(key, 'ready', `${def.label} ready`)
    return { client, transport, processId }
  } catch (e) {
    useStore.getState().setServer(key, 'failed', `${def.label} failed to start: ${e}`)
    return null
  }
}

function running(def: ServerDef): Promise<Running | null> {
  const root = useStore.getState().root
  if (!root) return Promise.resolve(null)
  let promise = starting.get(def.key)
  if (!promise) {
    promise = start(def, root).then((server) => {
      // Not installed or failed: forget it, so installing it later and reopening works.
      if (!server) starting.delete(def.key)
      return server
    })
    starting.set(def.key, promise)
  }
  return promise
}

/** Connects an editor to its language server, starting the server if needed. */
export function attachLanguageServer(view: EditorView, path: string) {
  const def = serverFor(path)
  if (!def) return
  running(def).then((server) => {
    if (!server || getView(path) !== view) return
    const languageId = def.languageId ?? languageFor(path).lspId
    view.dispatch({ effects: lspCompartment.reconfigure(server.client.plugin(pathToUri(path), languageId)) })
  })
}

/** After installing a server: connect every open file it serves. */
export function attachOpenFiles(key: string) {
  for (const tab of useStore.getState().tabs) {
    const view = getView(tab.path)
    if (view && serverFor(tab.path)?.key === key) attachLanguageServer(view, tab.path)
  }
}

export async function stopAllServers() {
  const all = [...starting.values()]
  starting.clear()
  for (const promise of all) {
    const server = await promise
    if (!server) continue
    server.client.disconnect()
    server.transport.dispose()
    await ipc.lspStop(server.processId)
  }
}
