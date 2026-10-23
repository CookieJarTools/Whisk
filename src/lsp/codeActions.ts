import type { EditorView } from '@codemirror/view'
import { forEachDiagnostic, type Action as LintAction, type Diagnostic } from '@codemirror/lint'
import { LSPPlugin, type LSPClientExtension } from '@codemirror/lsp-client'
import { useStore, type MenuItem } from '../store/store'
import { applyWorkspaceEdit, type WorkspaceEdit } from './edits'

/**
 * Alt+Enter: quick fixes for the problems on the cursor's line, and the
 * refactorings the language server offers there, in one menu.
 */

/** A server diagnostic keeps the server's own copy, which code-action requests send back. */
export interface ServerDiagnostic extends Diagnostic {
  lsp?: unknown
}

interface Command {
  title: string
  command: string
  arguments?: unknown[]
}

export interface CodeAction {
  title: string
  kind?: string
  isPreferred?: boolean
  disabled?: { reason: string }
  edit?: WorkspaceEdit
  command?: Command
  data?: unknown
}

const REQUEST_TIMEOUT_MS = 3000

/** Kinds we ask servers for. Without this list servers send only bare commands. */
const KINDS = ['quickfix', 'refactor', 'refactor.extract', 'refactor.inline', 'refactor.rewrite', 'source', 'source.organizeImports']

export function codeActionCapabilities(): LSPClientExtension {
  return {
    clientCapabilities: {
      workspace: { applyEdit: true, workspaceEdit: { documentChanges: true } },
      textDocument: {
        codeAction: {
          codeActionLiteralSupport: { codeActionKind: { valueSet: KINDS } },
          isPreferredSupport: true,
          disabledSupport: true,
          dataSupport: true,
          resolveSupport: { properties: ['edit'] }
        }
      }
    }
  }
}

type Group = 'fix' | 'refactor' | 'source'

function groupOf(action: CodeAction): Group {
  const kind = action.kind ?? 'quickfix'
  if (kind.startsWith('refactor')) return 'refactor'
  if (kind.startsWith('source')) return 'source'
  return 'fix'
}

const GROUP_TITLES: Record<Group, string> = { fix: 'Quick fixes', refactor: 'Refactor', source: 'File' }

/** Usable actions in menu order: fixes (preferred first), then refactorings, then file-wide ones. */
export function orderActions(items: (CodeAction | Command)[]): { group: Group; action: CodeAction }[] {
  const order: Group[] = ['fix', 'refactor', 'source']
  return items
    .map((item) => (typeof item.command === 'string' ? { title: item.title, command: item as Command } : (item as CodeAction)))
    .filter((a) => !a.disabled)
    .map((action) => ({ group: groupOf(action), action }))
    .sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group) || Number(!!b.action.isPreferred) - Number(!!a.action.isPreferred))
}

function lineRange(view: EditorView) {
  const sel = view.state.selection.main
  return { from: view.state.doc.lineAt(sel.from).from, to: view.state.doc.lineAt(sel.to).to }
}

function diagnosticsNear(view: EditorView) {
  const { from, to } = lineRange(view)
  const found: { diagnostic: ServerDiagnostic; from: number; to: number }[] = []
  forEachDiagnostic(view.state, (diagnostic, dFrom, dTo) => {
    if (dFrom <= to && dTo >= from) found.push({ diagnostic, from: dFrom, to: dTo })
  })
  return found
}

async function serverActions(view: EditorView): Promise<CodeAction[] | Command[]> {
  const plugin = LSPPlugin.get(view)
  if (!plugin?.client.serverCapabilities?.codeActionProvider) return []
  plugin.client.sync()
  const sel = view.state.selection.main
  const doc = view.state.doc
  const request = plugin.client.request<object, (CodeAction | Command)[] | null>('textDocument/codeAction', {
    textDocument: { uri: plugin.uri },
    range: { start: plugin.toPosition(sel.from, doc), end: plugin.toPosition(sel.to, doc) },
    context: {
      diagnostics: diagnosticsNear(view).flatMap((d) => (d.diagnostic.lsp ? [d.diagnostic.lsp] : [])),
      triggerKind: 1
    }
  })
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), REQUEST_TIMEOUT_MS))
  try {
    return ((await Promise.race([request, timeout])) ?? []) as CodeAction[]
  } catch {
    return []
  }
}

async function runAction(view: EditorView, action: CodeAction) {
  const plugin = LSPPlugin.get(view)
  if (!plugin) return
  const client = plugin.client
  try {
    let resolved = action
    const provider = client.serverCapabilities?.codeActionProvider
    if (!action.edit && !action.command && typeof provider === 'object' && provider.resolveProvider) {
      resolved = await client.request<CodeAction, CodeAction>('codeAction/resolve', action)
    }
    if (resolved.edit) await applyWorkspaceEdit(resolved.edit)
    if (resolved.command) {
      await client.request('workspace/executeCommand', { command: resolved.command.command, arguments: resolved.command.arguments })
    }
  } catch (e) {
    useStore.getState().toast(`“${action.title}” failed: ${e instanceof Error ? e.message : String(e)}`, 'error')
  }
}

/** Opens the Alt+Enter menu at the cursor. */
export function showQuickFixes(view: EditorView): boolean {
  const near = diagnosticsNear(view)
  const lintItems: MenuItem[] = near.flatMap(({ diagnostic, from, to }) =>
    (diagnostic.actions ?? []).map((a: LintAction) => ({
      label: a.name,
      hint: diagnostic.message.length > 40 ? diagnostic.message.slice(0, 38) + '…' : diagnostic.message,
      onSelect: () => a.apply(view, from, to)
    }))
  )
  const head = view.coordsAtPos(view.state.selection.main.head)
  const x = head?.left ?? 200
  const y = (head?.bottom ?? 200) + 4
  const hasServer = !!LSPPlugin.get(view)?.client.serverCapabilities?.codeActionProvider
  const open = useStore.getState().openMenu

  if (hasServer) open(x, y, [...lintItems, { type: 'header', label: 'Asking the language server…' }])
  void serverActions(view).then((items) => {
    const menu: MenuItem[] = [...lintItems]
    let group: Group | null = null
    for (const { group: g, action } of orderActions(items)) {
      if (g !== group) {
        if (menu.length) menu.push({ type: 'divider' })
        menu.push({ type: 'header', label: GROUP_TITLES[g] })
        group = g
      }
      menu.push({ label: action.isPreferred ? `★ ${action.title}` : action.title, onSelect: () => void runAction(view, action) })
    }
    // Don't reopen a menu the user already closed.
    if (hasServer && !useStore.getState().menu) return
    if (menu.length) open(x, y, menu)
    else {
      useStore.getState().closeMenu()
      useStore.getState().toast('No quick fixes or refactorings here.')
    }
  })
  return true
}
