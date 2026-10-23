import { forEachDiagnostic, setDiagnostics, type Diagnostic } from '@codemirror/lint'
import { ViewPlugin, type EditorView, type ViewUpdate } from '@codemirror/view'
import { LSPPlugin, type LSPClientExtension } from '@codemirror/lsp-client'

/**
 * Whisk's lint rules and the language server both report problems, but
 * CodeMirror keeps one list per editor and each `setDiagnostics` replaces it.
 * So every result is tagged with where it came from, and each side replaces
 * only its own, keeping the other's (at their current, edit-mapped positions).
 */

export const WHISK_SOURCE = 'whisk'

type Origin = 'whisk' | 'server'

function originOf(d: Diagnostic): Origin {
  return d.source === WHISK_SOURCE ? 'whisk' : 'server'
}

export function publishDiagnostics(view: EditorView, origin: Origin, diagnostics: Diagnostic[]) {
  const kept: Diagnostic[] = []
  forEachDiagnostic(view.state, (d, from, to) => {
    if (originOf(d) !== origin) kept.push({ ...d, from, to })
  })
  view.dispatch(setDiagnostics(view.state, [...kept, ...diagnostics]))
}

const SEVERITY: Record<number, Diagnostic['severity']> = { 1: 'error', 2: 'warning', 3: 'info', 4: 'hint' }

/** How long after typing stops before edits are sent to the server, so its errors stay current. */
const SYNC_DELAY_MS = 500
/** A moment after a file opens, so the server has the file before it's asked about it. */
const FIRST_PULL_DELAY_MS = 800

type LspPlugin = NonNullable<ReturnType<typeof LSPPlugin.get>>

function toDiagnostic(item: any, plugin: LspPlugin): Diagnostic {
  return {
    from: plugin.unsyncedChanges.mapPos(plugin.fromPosition(item.range.start, plugin.syncedDoc)),
    to: plugin.unsyncedChanges.mapPos(plugin.fromPosition(item.range.end, plugin.syncedDoc)),
    severity: SEVERITY[item.severity ?? 1] ?? 'error',
    message: item.message,
    // Anything but "whisk", so it's kept apart from Whisk's own results.
    source: item.source && item.source !== WHISK_SOURCE ? String(item.source) : 'server'
  }
}

/**
 * Asks the server for a file's errors. Newer servers (csharp-ls among them)
 * only answer when asked ("pull" diagnostics) rather than sending them.
 */
export async function pullDiagnostics(view: EditorView) {
  const plugin = LSPPlugin.get(view)
  if (!plugin?.client.serverCapabilities?.diagnosticProvider) return
  plugin.client.sync()
  let result: { kind: string; items?: any[] } | null
  try {
    result = await plugin.client.request<object, { kind: string; items?: any[] }>('textDocument/diagnostic', {
      textDocument: { uri: plugin.uri }
    })
  } catch {
    // Still loading the project, or the file isn't part of it: try again on the next edit.
    return
  }
  if (!result || result.kind !== 'full' || LSPPlugin.get(view) !== plugin) return
  publishDiagnostics(view, 'server', (result.items ?? []).map((item) => toDiagnostic(item, plugin)))
}

const autoSync = ViewPlugin.fromClass(
  class {
    private timer = 0
    constructor(readonly view: EditorView) {
      this.timer = window.setTimeout(() => void pullDiagnostics(this.view), FIRST_PULL_DELAY_MS)
    }
    update(update: ViewUpdate) {
      if (!update.docChanged) return
      clearTimeout(this.timer)
      this.timer = window.setTimeout(() => {
        const plugin = LSPPlugin.get(this.view)
        if (!plugin) return
        plugin.client.sync()
        void pullDiagnostics(this.view)
      }, SYNC_DELAY_MS)
    }
    destroy() {
      clearTimeout(this.timer)
    }
  }
)

/** Replaces the LSP client's own diagnostics handling with one that merges with Whisk's rules. */
export function mergedServerDiagnostics(): LSPClientExtension {
  return {
    clientCapabilities: { textDocument: { publishDiagnostics: { versionSupport: true }, diagnostic: { dynamicRegistration: false } } },
    notificationHandlers: {
      'textDocument/publishDiagnostics': (client, params) => {
        const file = client.workspace.getFile(params.uri)
        if (!file || (params.version != null && params.version !== file.version)) return false
        const view = file.getView()
        const plugin = view && LSPPlugin.get(view)
        if (!view || !plugin) return false
        publishDiagnostics(view, 'server', params.diagnostics.map((item: any) => toDiagnostic(item, plugin)))
        return true
      }
    },
    editorExtension: autoSync
  }
}
