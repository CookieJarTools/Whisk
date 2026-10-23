import { ViewPlugin, type EditorView, type ViewUpdate } from '@codemirror/view'
import { scopeField, symbolsAt, type CodeSymbol } from './scopes'
import { revealLine } from './views'
import { lensPath } from './codeLens'

/**
 * The headers of the class and method you're scrolled into stay pinned at the
 * top of the editor, so you always know where you are. Click one to jump to it.
 */

const MAX_LINES = 4
const LANES = 12

/** The symbols to pin when `topLine` is the first visible line: those whose header has scrolled off. */
export function pinnedSymbols(symbols: CodeSymbol[], topPos: number, topLine: number): CodeSymbol[] {
  return symbolsAt(symbols, topPos)
    .filter((s) => s.headerLine < topLine && s.block.closeLine > topLine)
    .slice(-MAX_LINES)
}

export const stickyHeader = ViewPlugin.fromClass(
  class {
    dom: HTMLElement
    key = ''

    constructor(readonly view: EditorView) {
      this.dom = document.createElement('div')
      this.dom.className = 'cm-sticky'
      view.dom.appendChild(this.dom)
      this.onScroll = this.onScroll.bind(this)
      view.scrollDOM.addEventListener('scroll', this.onScroll, { passive: true })
      requestAnimationFrame(() => this.render())
    }

    onScroll() {
      this.render()
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.geometryChanged || update.viewportChanged) this.render()
    }

    render() {
      const view = this.view
      const info = view.state.field(scopeField, false)
      // Leave room for the pinned lines themselves, so the first line under them counts.
      let pinned: CodeSymbol[] = []
      if (info) {
        const lineHeight = view.defaultLineHeight
        for (let guess = 0; guess <= MAX_LINES; guess++) {
          const block = view.lineBlockAtHeight(view.scrollDOM.scrollTop + guess * lineHeight)
          const topLine = view.state.doc.lineAt(block.from).number
          pinned = pinnedSymbols(info.symbols, block.from, topLine)
          if (pinned.length <= guess) break
        }
      }
      const key = pinned.map((s) => s.from).join(',') + '|' + view.contentDOM.getBoundingClientRect().left + '|' + view.scrollDOM.offsetTop
      if (key === this.key) return
      this.key = key
      this.dom.replaceChildren()
      this.dom.style.display = pinned.length ? '' : 'none'
      this.dom.style.top = `${view.scrollDOM.offsetTop}px`
      this.dom.style.left = `${view.contentDOM.getBoundingClientRect().left - view.dom.getBoundingClientRect().left}px`
      for (const symbol of pinned) {
        const row = document.createElement('div')
        row.className = 'cm-sticky-line'
        row.style.setProperty('--lane', `var(--lane-${symbol.block.depth % LANES})`)
        const text = view.state.doc.line(symbol.headerLine).text
        const indent = text.match(/^\s*/)![0]
        row.style.paddingLeft = `${indent.replace(/\t/g, ' '.repeat(view.state.tabSize)).length}ch`
        const body = text.trim()
        const at = body.indexOf(symbol.name)
        if (at >= 0) {
          row.append(body.slice(0, at))
          const name = document.createElement('span')
          name.className = 'cm-sticky-name'
          name.textContent = symbol.name
          row.append(name, body.slice(at + symbol.name.length))
        } else row.textContent = body
        row.title = `Line ${symbol.headerLine}`
        row.onmousedown = (e) => {
          e.preventDefault()
          revealLine(view.state.facet(lensPath), symbol.headerLine)
        }
        this.dom.appendChild(row)
      }
    }

    destroy() {
      this.view.scrollDOM.removeEventListener('scroll', this.onScroll)
      this.dom.remove()
    }
  }
)
