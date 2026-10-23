import { StateEffect, StateField, type EditorState } from '@codemirror/state'
import { EditorView, ViewPlugin, keymap, showTooltip, type Tooltip, type ViewUpdate } from '@codemirror/view'
import { Prec } from '@codemirror/state'
import { LSPPlugin } from '@codemirror/lsp-client'
import {
  argumentIndex,
  docText,
  openingBracket,
  paramName,
  parameterRanges,
  parseDocs,
  signatureParts,
  type SignatureInfo
} from './signatureParts'

/**
 * Rider-style parameter info. The language server says which overloads exist;
 * Whisk works out which argument the cursor is in itself, by counting commas,
 * so the highlight moves the instant you type rather than after a round trip.
 * All overloads show at once, the matching one bright, with the current
 * parameter's notes first and the summary underneath.
 */

interface HelpData {
  signatures: SignatureInfo[]
  activeSignature?: number
  activeParameter?: number
}

interface HelpState {
  data: HelpData
  active: number
  /** The call's opening bracket. */
  open: number
  /** The argument the cursor is in. */
  arg: number
}

const MAX_OVERLOADS = 6

const setHelp = StateEffect.define<HelpState | null>()

function argumentAt(state: EditorState, open: number): number {
  const head = state.selection.main.head
  if (head <= open) return -1
  return argumentIndex(state.doc.sliceString(open + 1, head))
}

const helpField = StateField.define<HelpState | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setHelp)) return e.value
    if (!value || (!tr.docChanged && !tr.selection)) return value
    const open = tr.changes.mapPos(value.open)
    const arg = argumentAt(tr.state, open)
    if (arg < 0) return null
    return arg === value.arg && open === value.open ? value : { ...value, open, arg }
  },
  provide: (field) => showTooltip.compute([field], (state) => tooltipFor(state.field(field)))
})

const tooltipCache = new WeakMap<HelpState, Tooltip>()

function tooltipFor(help: HelpState | null): Tooltip | null {
  if (!help) return null
  let tip = tooltipCache.get(help)
  if (!tip) {
    tip = { pos: help.open, above: true, strictSide: false, arrow: false, create: () => ({ dom: render(help) }) }
    tooltipCache.set(help, tip)
  }
  return tip
}

/** The parameter a signature would bind the current argument to; the last one takes the rest (`params`, `...`). */
function paramFor(sig: SignatureInfo, arg: number): number | null {
  const count = sig.parameters?.length ?? 0
  if (count === 0) return null
  if (arg < count) return arg
  const last = sig.parameters![count - 1]
  const label = Array.isArray(last.label) ? sig.label.slice(last.label[0], last.label[1]) : last.label
  return /^(params\b|\.\.\.)|\.\.\./.test(label) ? count - 1 : null
}

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function signatureLine(sig: SignatureInfo, param: number | null, active: boolean): HTMLElement {
  const line = el('div', `sig-line${active ? ' active' : ''}`)
  for (const part of signatureParts(sig)) {
    const span = el('span', `sig-${part.kind}`, part.text)
    if (part.param !== undefined) {
      span.classList.add('sig-in-param')
      if (part.param === param) span.classList.add('sig-current')
    }
    line.appendChild(span)
  }
  return line
}

function render(help: HelpState): HTMLElement {
  const dom = el('div', 'sig')
  const sigs = help.data.signatures
  const shown = sigs.length <= MAX_OVERLOADS ? sigs : [sigs[help.active], ...sigs.filter((_, i) => i !== help.active).slice(0, MAX_OVERLOADS - 1)]
  for (const sig of shown) {
    const isActive = sig === sigs[help.active]
    const param = paramFor(sig, help.arg)
    const line = signatureLine(sig, param, isActive)
    // An overload with too few parameters for what's typed so far can't be the one.
    if (!isActive && param === null && help.arg > 0) line.classList.add('sig-cant')
    dom.appendChild(line)
  }
  if (sigs.length > shown.length) dom.appendChild(el('div', 'sig-more', `+${sigs.length - shown.length} more overloads`))

  const sig = sigs[help.active]
  const docs = parseDocs(docText(sig.documentation))
  const param = paramFor(sig, help.arg)
  if (param !== null) {
    const p = sig.parameters![param]
    const range = parameterRanges(sig)[param]
    const name = paramName(range ? sig.label.slice(range[0], range[1]) : String(p.label))
    const note = docText(p.documentation).trim() || docs.params[name]
    if (note) {
      const row = el('div', 'sig-param-doc')
      row.append(el('span', 'sig-param', name), el('span', 'sig-sep', ' — '), el('span', 'sig-note', note))
      dom.appendChild(row)
    }
  }
  if (docs.summary) dom.appendChild(el('div', 'sig-summary', docs.summary))
  if (docs.returns) {
    const row = el('div', 'sig-returns')
    row.append(el('span', 'sig-label', 'Returns '), el('span', 'sig-note', docs.returns))
    dom.appendChild(row)
  }
  return dom
}

function sameSignatures(a: HelpData, b: HelpData): boolean {
  return a.signatures.length === b.signatures.length && a.signatures.every((s, i) => s.label === b.signatures[i].label)
}

/** Asks the server for signatures; `open` is the call's bracket. */
async function request(view: EditorView, open: number, trigger: string | null) {
  const plugin = LSPPlugin.get(view)
  if (!plugin || !plugin.client.serverCapabilities?.signatureHelpProvider) return
  plugin.client.sync()
  const current = view.state.field(helpField, false) ?? null
  const head = view.state.selection.main.head
  const context = trigger
    ? { triggerKind: 2, triggerCharacter: trigger, isRetrigger: !!current, activeSignatureHelp: current?.data }
    : { triggerKind: 1, isRetrigger: !!current, activeSignatureHelp: current?.data }
  let result: HelpData | null
  try {
    result = await plugin.client.request<object, HelpData | null>('textDocument/signatureHelp', {
      textDocument: { uri: plugin.uri },
      position: plugin.toPosition(head),
      context
    })
  } catch {
    return
  }
  // The cursor may have left the call while the server was thinking.
  const now = view.state.field(helpField, false) ?? null
  const mappedOpen = now ? now.open : open
  const arg = argumentAt(view.state, mappedOpen)
  if (arg < 0) return
  if (!result || result.signatures.length === 0) {
    if (now) view.dispatch({ effects: setHelp.of(null) })
    return
  }
  const keep = now && sameSignatures(now.data, result)
  const active = keep ? now!.active : Math.min(result.activeSignature ?? 0, result.signatures.length - 1)
  view.dispatch({ effects: setHelp.of({ data: result, active, open: mappedOpen, arg }) })
}

const triggerPlugin = ViewPlugin.fromClass(
  class {
    update(update: ViewUpdate) {
      if (!update.docChanged || !update.transactions.some((tr) => tr.isUserEvent('input.type'))) return
      const plugin = LSPPlugin.get(update.view)
      const triggers: string[] = plugin?.client.serverCapabilities?.signatureHelpProvider?.triggerCharacters ?? ['(', ',']
      let typed = ''
      update.changes.iterChanges((_fa, _ta, _fb, _tb, inserted) => {
        const text = inserted.toString()
        for (const ch of triggers) if (text.includes(ch)) typed = ch
      })
      if (!typed) return
      const state = update.state
      const head = state.selection.main.head
      const open = openingBracket(state.doc.sliceString(Math.max(0, head - 2000), head))
      if (open < 0) return
      const absolute = Math.max(0, head - 2000) + open
      // Show straight away with what we know; the server fills in the rest.
      void request(update.view, absolute, typed)
    }
  }
)

/** Shows parameter info for the call around the cursor (Ctrl+Shift+Space / Rider's Ctrl+P). */
export function showParameterInfo(view: EditorView): boolean {
  const head = view.state.selection.main.head
  const from = Math.max(0, head - 2000)
  const open = openingBracket(view.state.doc.sliceString(from, head))
  if (open < 0) return false
  void request(view, from + open, null)
  return true
}

export const parameterInfo = [
  helpField,
  triggerPlugin,
  Prec.highest(
    keymap.of([
      {
        key: 'Escape',
        run: (view) => {
          if (!view.state.field(helpField, false)) return false
          view.dispatch({ effects: setHelp.of(null) })
          return true
        }
      }
    ])
  ),
  EditorView.baseTheme({
    '.cm-tooltip:has(> .sig)': { padding: 0 }
  })
]
