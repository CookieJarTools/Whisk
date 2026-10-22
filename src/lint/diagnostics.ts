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

const autoSync = ViewPlugin.fromClass(
  class {
    private timer = 0
    constructor(readonly view: EditorView) {}
    update(update: ViewUpdate) {
      if (!update.docChanged) return
      clearTimeout(this.timer)
      this.timer = window.setTimeout(() => LSPPlugin.get(this.view)?.client.sync(), SYNC_DELAY_MS)
    }
    destroy() {
      clearTimeout(this.timer)
    }
  }
)

/** Replaces the LSP client's own diagnostics handling with one that merges with Whisk's rules. */
export function mergedServerDiagnostics(): LSPClientExtension {
  return {
    clientCapabilities: { textDocument: { publishDiagnostics: { versionSupport: true } } },
    notificationHandlers: {
      'textDocument/publishDiagnostics': (client, params) => {
        const file = client.workspace.getFile(params.uri)
        if (!file || (params.version != null && params.version !== file.version)) return false
        const view = file.getView()
        const plugin = view && LSPPlugin.get(view)
        if (!view || !plugin) return false
        const diagnostics: Diagnostic[] = params.diagnostics.map((item: any) => ({
          from: plugin.unsyncedChanges.mapPos(plugin.fromPosition(item.range.start, plugin.syncedDoc)),
          to: plugin.unsyncedChanges.mapPos(plugin.fromPosition(item.range.end, plugin.syncedDoc)),
          severity: SEVERITY[item.severity ?? 1] ?? 'error',
          message: item.message,
          // Anything but "whisk", so it's kept apart from Whisk's own results.
          source: item.source && item.source !== WHISK_SOURCE ? String(item.source) : 'server'
        }))
        publishDiagnostics(view, 'server', diagnostics)
        return true
      }
    },
    editorExtension: autoSync
  }
}
