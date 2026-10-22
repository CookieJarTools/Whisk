import { layer, type EditorView, type LayerMarker } from '@codemirror/view'
import { scopeField, type Block } from './scopes'

/**
 * Draws a CrumbTree-style lane down the left of every multi-line `{ … }` block:
 * a rounded bracket that starts at the opening line and curves back in at the
 * closing one. The block holding the cursor is lit; the ones around it are
 * half-lit and everything else fades back, so the current scope reads first.
 */

const LANES = 12
/** How far left of the block's indentation the lane runs, in px. */
const RAIL_INSET = 7
const CORNER = 5

class RailsMarker implements LayerMarker {
  constructor(
    readonly svg: string,
    readonly left: number,
    readonly top: number,
    readonly width: number,
    readonly height: number
  ) {}

  eq(other: LayerMarker): boolean {
    return (
      other instanceof RailsMarker &&
      other.svg === this.svg &&
      other.left === this.left &&
      other.top === this.top &&
      other.width === this.width &&
      other.height === this.height
    )
  }

  draw(): HTMLElement {
    const el = document.createElement('div')
    this.apply(el)
    return el
  }

  update(dom: HTMLElement): boolean {
    this.apply(dom)
    return true
  }

  private apply(el: HTMLElement) {
    el.className = 'cm-scope-rails'
    el.style.cssText = `position:absolute;left:${this.left}px;top:${this.top}px;width:${this.width}px;height:${this.height}px;pointer-events:none`
    el.innerHTML = this.svg
  }
}

function indentColumns(text: string, tabSize: number): number {
  let col = 0
  for (const ch of text) {
    if (ch === ' ') col++
    else if (ch === '\t') col += tabSize - (col % tabSize)
    else break
  }
  return col
}

function railMarkers(view: EditorView): readonly LayerMarker[] {
  const scope = view.state.field(scopeField, false)
  if (!scope || scope.blocks.length === 0) return []
  const { from: vFrom, to: vTo } = view.viewport
  const visible = scope.blocks.filter((b) => b.to >= vFrom && b.from <= vTo)
  if (visible.length === 0) return []

  const firstLine = view.lineBlockAt(vFrom)
  const probe = view.coordsAtPos(firstLine.from)
  if (!probe) return []
  const scroller = view.scrollDOM.getBoundingClientRect()
  const baseLeft = scroller.left - view.scrollDOM.scrollLeft
  const baseTop = scroller.top - view.scrollDOM.scrollTop
  const textLeft = probe.left - baseLeft
  const top = firstLine.top
  const height = view.lineBlockAt(vTo).bottom - top
  const charWidth = view.defaultCharacterWidth
  const halfLine = view.defaultLineHeight / 2
  const { doc, tabSize } = view.state

  const head = view.state.selection.main.head
  const around = scope.blocks.filter((b) => b.from <= head && head <= b.to + 1)
  const active = around[around.length - 1]

  let maxX = 0
  const glow: string[] = []
  const lines: string[] = []
  for (const block of visible) {
    const open = doc.line(block.openLine)
    const close = doc.line(block.closeLine)
    const col = Math.min(indentColumns(open.text, tabSize), indentColumns(close.text, tabSize))
    const xText = textLeft + col * charWidth - 2
    const xRail = xText - RAIL_INSET + 2
    const y1 = view.lineBlockAt(open.from).top - top + halfLine
    const y2 = view.lineBlockAt(close.from).top - top + halfLine
    const r = Math.min(CORNER, (y2 - y1) / 2)
    const d = `M${xText} ${y1}Q${xRail} ${y1} ${xRail} ${y1 + r}L${xRail} ${y2 - r}Q${xRail} ${y2} ${xText} ${y2}`
    const colour = `var(--lane-${block.depth % LANES})`
    maxX = Math.max(maxX, xText + 4)
    lines.push(railPath(d, colour, block, active, around))
    if (block === active) {
      glow.push(`<path d="${d}" style="stroke:${colour}" stroke-width="6" opacity="0.16" fill="none" stroke-linecap="round"/>`)
    }
  }

  const svg = `<svg width="${maxX}" height="${height}" style="overflow:visible">${glow.join('')}${lines.join('')}</svg>`
  return [new RailsMarker(svg, 0, view.documentTop - baseTop + top, maxX, height)]
}

function railPath(d: string, colour: string, block: Block, active: Block | undefined, around: Block[]): string {
  const lit = block === active
  const opacity = lit ? 1 : around.includes(block) ? 0.5 : 0.22
  const width = lit ? 1.7 : 1.3
  return `<path d="${d}" style="stroke:${colour}" stroke-width="${width}" opacity="${opacity}" fill="none" stroke-linecap="round"/>`
}

export const scopeRails = layer({
  above: false,
  class: 'cm-scope-layer',
  markers: railMarkers,
  update: (u) => u.docChanged || u.selectionSet || u.viewportChanged || u.geometryChanged
})
