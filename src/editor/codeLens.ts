import { Facet, StateEffect, StateField, type EditorState } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import type { SymbolAction, SymbolKind } from '../plugins/api'
import { scopeField } from './scopes'
import { toSymbolInfo } from './symbolInfo'
// Circular with host.ts, but only used inside functions, never at module load.
import { getSymbolActions, ide } from '../plugins/host'

/** A quiet row of plugin actions above each declaration, like Rider's code vision. */

export const refreshLenses = StateEffect.define<null>()
export const lensPath = Facet.define<string, string>({ combine: (v) => v[0] ?? '' })

const DEFAULT_KINDS: SymbolKind[] = ['method', 'function', 'class', 'struct', 'interface', 'record']

function actionsFor(kind: SymbolKind): SymbolAction[] {
  return getSymbolActions().filter((a) => (a.kinds ?? DEFAULT_KINDS).includes(kind))
}

class LensWidget extends WidgetType {
  constructor(
    readonly indent: number,
    readonly actionIds: string[],
    readonly labels: string[]
  ) {
    super()
  }

  eq(other: LensWidget) {
    return other.indent === this.indent && other.actionIds.join() === this.actionIds.join()
  }

  toDOM(view: EditorView) {
    const row = document.createElement('div')
    row.className = 'cm-lens'
    row.style.marginLeft = `${this.indent}ch`
    this.actionIds.forEach((id, i) => {
      if (i > 0) {
        const sep = document.createElement('span')
        sep.className = 'cm-lens-sep'
        sep.textContent = '·'
        row.appendChild(sep)
      }
      const link = document.createElement('span')
      link.className = 'cm-lens-action'
      link.textContent = this.labels[i]
      link.addEventListener('mousedown', (e) => {
        e.preventDefault()
        e.stopPropagation()
        runLensAction(view, view.posAtDOM(row), id)
      })
      row.appendChild(link)
    })
    return row
  }

  ignoreEvent() {
    return true
  }
}

function runLensAction(view: EditorView, pos: number, actionId: string) {
  const path = view.state.facet(lensPath)
  const scope = view.state.field(scopeField, false)
  const symbol = scope?.symbols.find((s) => s.from === pos)
  const action = getSymbolActions().find((a) => a.id === actionId)
  if (!symbol || !action || !path) return
  Promise.resolve(action.run(toSymbolInfo(view.state, path, symbol), ide)).catch((e) =>
    ide.ui.toast(`${action.label} failed: ${e}`, 'error')
  )
}

function indentOf(text: string, tabSize: number): number {
  let col = 0
  for (const ch of text) {
    if (ch === ' ') col++
    else if (ch === '\t') col += tabSize
    else break
  }
  return col
}

function buildLenses(state: EditorState): DecorationSet {
  const scope = state.field(scopeField, false)
  if (!scope) return Decoration.none
  const ranges = []
  for (const symbol of scope.symbols) {
    const actions = actionsFor(symbol.kind)
    if (actions.length === 0) continue
    const line = state.doc.lineAt(symbol.from)
    const widget = new LensWidget(
      indentOf(line.text, state.tabSize),
      actions.map((a) => a.id),
      actions.map((a) => a.label)
    )
    ranges.push(Decoration.widget({ widget, block: true, side: -1 }).range(line.from))
  }
  return Decoration.set(ranges, true)
}

export const codeLens = StateField.define<DecorationSet>({
  create: buildLenses,
  update(value, tr) {
    if (tr.docChanged || tr.effects.some((e) => e.is(refreshLenses))) return buildLenses(tr.state)
    return value
  },
  provide: (field) => EditorView.decorations.from(field)
})
