import type { ContextItem, IdeApi, IdePlugin, SymbolInfo } from '../api'

/**
 * Sends a method or type to Claude, ready for a question. "Ask Claude" sends
 * just the declaration; "+ context" also sends the members of the type it sits
 * in and the project types it uses.
 *
 * Two places it can go, switchable from the command palette:
 * - desktop: copies the prompt and opens the Claude app with it prefilled
 * - code: opens Claude Code in a terminal in the project folder
 */

type Target = 'desktop' | 'code'

const TARGET_KEY = 'claude.target'
/** Longer prompts are too big for a URL; they go by clipboard only. */
const MAX_URL_PROMPT = 6000

function qualifiedName(symbol: SymbolInfo): string {
  return [...symbol.containers, symbol.name].join('.')
}

export function buildPrompt(symbol: SymbolInfo, context: ContextItem[]): string {
  const lines = [
    `I'm working on the ${symbol.kind} \`${qualifiedName(symbol)}\` in \`${symbol.relativePath}\` (lines ${symbol.startLine}–${symbol.endLine}, ${symbol.language}).`,
    '',
    '```' + symbol.fence,
    symbol.text,
    '```'
  ]
  if (context.length) {
    lines.push('', 'Related code from the project, for context:')
    for (const item of context) {
      lines.push('', `#### ${item.title} — \`${item.source}\``, '```' + item.fence, item.text, '```')
    }
  }
  lines.push('', '')
  return lines.join('\n')
}

async function sendToDesktop(ide: IdeApi, prompt: string) {
  // Open Claude even if the copy fails; the prompt can still go via the URL.
  const copied = await ide.ui.copy(prompt).then(() => true, () => false)
  const url = prompt.length <= MAX_URL_PROMPT ? `claude://claude.ai/new?q=${encodeURIComponent(prompt)}` : 'claude://'
  await ide.shell.openUrl(url)
  if (!copied) ide.ui.toast('Opened Claude, but couldn\'t copy the prompt to the clipboard.', 'error')
  else if (prompt.length > MAX_URL_PROMPT) ide.ui.toast('Opened Claude. The prompt is too long to fill in, so paste it (Ctrl+V).', 'success')
  else ide.ui.toast('Opened Claude. The prompt is on your clipboard too, if it isn\'t filled in.', 'success')
}

async function sendToClaudeCode(ide: IdeApi, symbol: SymbolInfo, prompt: string) {
  if (!(await ide.shell.which('claude'))) {
    ide.ui.toast('Claude Code (the `claude` command) isn\'t on PATH, so sending to the desktop app instead.', 'error')
    return sendToDesktop(ide, prompt)
  }
  const file = await ide.shell.writeTemp(`claude-${symbol.name}.md`, prompt)
  const cwd = ide.workspace.root() ?? symbol.path.replace(/[\\/][^\\/]*$/, '')
  await ide.shell.runInTerminal(cwd, [
    'claude',
    `Read ${file}. It has code from this project I want to work on. Summarise it in one line, then wait for my question.`
  ])
}

async function deliver(ide: IdeApi, symbol: SymbolInfo, prompt: string) {
  const target = ide.settings.get<Target>(TARGET_KEY, 'desktop')
  return target === 'code' ? sendToClaudeCode(ide, symbol, prompt) : sendToDesktop(ide, prompt)
}

async function askWithContext(ide: IdeApi, symbol: SymbolInfo) {
  const context = await ide.context.forSymbol(symbol)
  return deliver(ide, symbol, buildPrompt(symbol, context))
}

const claudePlugin: IdePlugin = {
  id: 'claude',
  name: 'Claude',
  activate(ctx) {
    ctx.registerSymbolAction({
      id: 'ask',
      label: '✦ Ask Claude',
      title: 'Ask Claude about this',
      run: (symbol, ide) => deliver(ide, symbol, buildPrompt(symbol, []))
    })
    ctx.registerSymbolAction({
      id: 'ask-context',
      label: '+ context',
      title: 'Ask Claude, with related code',
      run: (symbol, ide) => askWithContext(ide, symbol)
    })
    ctx.registerCommand({
      id: 'ask-cursor',
      title: 'Claude: Ask about the code at the cursor',
      keys: ['Ctrl+Alt+A'],
      run: (ide) => {
        const symbol = ide.editor.symbolAtCursor()
        if (symbol) return askWithContext(ide, symbol)
        ide.ui.toast('Put the cursor inside a method or class first.')
      }
    })
    ctx.registerCommand({
      id: 'use-desktop',
      title: 'Claude: Send to the Claude desktop app',
      run: (ide) => {
        ide.settings.set<Target>(TARGET_KEY, 'desktop')
        ide.ui.toast('Claude actions now open the desktop app.', 'success')
      }
    })
    ctx.registerCommand({
      id: 'use-code',
      title: 'Claude: Send to Claude Code in a terminal',
      run: (ide) => {
        ide.settings.set<Target>(TARGET_KEY, 'code')
        ide.ui.toast('Claude actions now open Claude Code in a terminal.', 'success')
      }
    })
  }
}

export default claudePlugin
