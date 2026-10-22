import {
  SearchQuery,
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  openSearchPanel,
  replaceAll,
  replaceNext,
  search,
  searchPanelOpen,
  setSearchQuery
} from '@codemirror/search'
import { EditorSelection, type EditorState } from '@codemirror/state'
import { EditorView, type Panel, type ViewUpdate } from '@codemirror/view'

/**
 * Rider-style find/replace bar, in place of CodeMirror's default form:
 *   [⌕ query ……………… Aa W .*]  3 of 12  ↑ ↓ │ ⇄ ×
 *   [  replacement ………………… ]  Replace  Replace all
 * Matches are highlighted and the nearest one selected as you type.
 */

const MAX_COUNT = 9999

const ICONS = {
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.5-4.5',
  up: 'M6 15l6-6 6 6',
  down: 'M6 9l6 6 6-6',
  replace: 'M4 7h12l-3-3M20 17H8l3 3',
  close: 'M6 6l12 12M18 6L6 18'
}

function icon(path: string, size = 14): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('width', String(size))
  svg.setAttribute('height', String(size))
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '1.8')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  p.setAttribute('d', path)
  svg.appendChild(p)
  return svg
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, children: (Node | string)[] = []): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  node.className = className
  for (const c of children) node.append(c)
  return node
}

function button(className: string, title: string, content: Node | string, onClick: () => void): HTMLButtonElement {
  const b = el('button', className, [content])
  b.type = 'button'
  b.title = title
  b.addEventListener('mousedown', (e) => e.preventDefault())
  b.addEventListener('click', onClick)
  return b
}

export function countMatches(state: EditorState, query: SearchQuery): { total: number; current: number } {
  if (!query.valid || !query.search) return { total: 0, current: 0 }
  const sel = state.selection.main
  const cursor = query.getCursor(state)
  let total = 0
  let current = 0
  for (let r = cursor.next(); !r.done; r = cursor.next()) {
    total++
    if (r.value.from === sel.from && r.value.to === sel.to) current = total
    if (total >= MAX_COUNT) break
  }
  return { total, current }
}

const panels = new WeakMap<EditorView, FindPanel>()

class FindPanel implements Panel {
  readonly dom: HTMLElement
  readonly top = true
  private readonly searchInput: HTMLInputElement
  private readonly replaceInput: HTMLInputElement
  private readonly replaceRow: HTMLElement
  private readonly counter: HTMLElement
  private readonly toggles: Record<'caseSensitive' | 'wholeWord' | 'regexp', HTMLButtonElement>
  private readonly replaceToggle: HTMLButtonElement
  private query: SearchQuery

  constructor(private readonly view: EditorView) {
    this.query = getSearchQuery(view.state)
    this.searchInput = el('input', 'find-input')
    this.searchInput.placeholder = 'Find'
    this.searchInput.spellcheck = false
    this.searchInput.value = this.query.search
    this.replaceInput = el('input', 'find-input')
    this.replaceInput.placeholder = 'Replace with'
    this.replaceInput.spellcheck = false
    this.replaceInput.value = this.query.replace

    const toggle = (key: 'caseSensitive' | 'wholeWord' | 'regexp', label: string, title: string) =>
      button('find-toggle', title, label, () => this.commit({ [key]: !this.query[key] }))
    this.toggles = {
      caseSensitive: toggle('caseSensitive', 'Aa', 'Match case (Alt+C)'),
      wholeWord: toggle('wholeWord', 'W', 'Whole words (Alt+W)'),
      regexp: toggle('regexp', '.*', 'Regular expression (Alt+X)')
    }
    this.counter = el('span', 'find-count')
    this.replaceToggle = button('find-btn', 'Replace (Ctrl+R)', icon(ICONS.replace), () => this.showReplace(!this.replaceToggle.classList.contains('on')))

    const field = el('div', 'find-field', [
      el('span', 'find-field-icon', [icon(ICONS.search, 13)]),
      this.searchInput,
      el('span', 'find-toggles', [this.toggles.caseSensitive, this.toggles.wholeWord, this.toggles.regexp])
    ])
    const searchRow = el('div', 'find-row', [
      field,
      this.counter,
      button('find-btn', 'Previous match (Shift+Enter)', icon(ICONS.up), () => this.step(-1)),
      button('find-btn', 'Next match (Enter)', icon(ICONS.down), () => this.step(1)),
      el('span', 'find-sep'),
      this.replaceToggle,
      button('find-btn find-close', 'Close (Esc)', icon(ICONS.close), () => this.close())
    ])
    this.replaceRow = el('div', 'find-row', [
      el('div', 'find-field', [el('span', 'find-field-icon'), this.replaceInput]),
      button('find-text-btn', 'Replace this match (Enter)', 'Replace', () => replaceNext(this.view)),
      button('find-text-btn', 'Replace every match (Ctrl+Alt+Enter)', 'Replace all', () => replaceAll(this.view))
    ])
    this.replaceRow.hidden = true
    this.dom = el('div', 'cm-find', [searchRow, this.replaceRow])

    this.searchInput.addEventListener('input', () => this.commit({ search: this.searchInput.value }, true))
    this.replaceInput.addEventListener('input', () => this.commit({ replace: this.replaceInput.value }))
    this.searchInput.addEventListener('keydown', (e) => this.onKey(e, false))
    this.replaceInput.addEventListener('keydown', (e) => this.onKey(e, true))
    panels.set(view, this)
    this.render()
  }

  mount() {
    this.focus()
  }

  update(update: ViewUpdate) {
    const query = getSearchQuery(update.state)
    if (!query.eq(this.query)) {
      this.query = query
      if (document.activeElement !== this.searchInput) this.searchInput.value = query.search
      if (document.activeElement !== this.replaceInput) this.replaceInput.value = query.replace
    }
    if (update.docChanged || update.selectionSet || !query.eq(this.query) || update.transactions.length) this.render()
  }

  destroy() {
    panels.delete(this.view)
  }

  focus() {
    this.searchInput.focus()
    this.searchInput.select()
  }

  showReplace(show: boolean) {
    this.replaceRow.hidden = !show
    this.replaceToggle.classList.toggle('on', show)
    if (show) this.replaceInput.focus()
  }

  private onKey(e: KeyboardEvent, inReplace: boolean) {
    const key = e.key
    if (key === 'Escape') {
      e.preventDefault()
      this.close()
    } else if (key === 'Enter' && inReplace && e.ctrlKey && e.altKey) {
      e.preventDefault()
      replaceAll(this.view)
    } else if (key === 'Enter' && inReplace) {
      e.preventDefault()
      replaceNext(this.view)
    } else if (key === 'Enter' || key === 'F3') {
      e.preventDefault()
      this.step(e.shiftKey ? -1 : 1)
    } else if (e.altKey && !e.ctrlKey && (e.code === 'KeyC' || e.code === 'KeyW' || e.code === 'KeyX')) {
      e.preventDefault()
      const key = e.code === 'KeyC' ? 'caseSensitive' : e.code === 'KeyW' ? 'wholeWord' : 'regexp'
      this.commit({ [key]: !this.query[key] }, true)
    }
  }

  private step(direction: 1 | -1) {
    if (direction > 0) findNext(this.view)
    else findPrevious(this.view)
  }

  private close() {
    closeSearchPanel(this.view)
    this.view.focus()
  }

  /** Applies a change to the query; when typing, also selects the nearest match. */
  private commit(change: Partial<ConstructorParameters<typeof SearchQuery>[0]>, jump = false) {
    const q = this.query
    const next = new SearchQuery({
      search: q.search,
      caseSensitive: q.caseSensitive,
      wholeWord: q.wholeWord,
      regexp: q.regexp,
      replace: q.replace,
      ...change
    })
    const effects = setSearchQuery.of(next)
    const match = jump ? nearestMatch(this.view.state, next) : null
    this.view.dispatch(
      match
        ? { effects: [effects, EditorView.scrollIntoView(match.from, { y: 'center' })], selection: EditorSelection.range(match.from, match.to) }
        : { effects }
    )
  }

  private render() {
    const q = getSearchQuery(this.view.state)
    for (const key of ['caseSensitive', 'wholeWord', 'regexp'] as const) this.toggles[key].classList.toggle('on', q[key])
    const invalid = !!q.search && !q.valid
    this.searchInput.parentElement!.classList.toggle('invalid', invalid)
    if (!q.search) this.counter.textContent = ''
    else if (invalid) this.counter.textContent = 'Bad pattern'
    else {
      const { total, current } = countMatches(this.view.state, q)
      const totalText = total >= MAX_COUNT ? `${MAX_COUNT}+` : String(total)
      this.counter.textContent = total === 0 ? 'No results' : current ? `${current} of ${totalText}` : `${totalText} results`
    }
    this.counter.classList.toggle('none', !!q.search && !invalid && this.counter.textContent === 'No results')
  }
}

/** First match at or after the selection, wrapping to the top. */
function nearestMatch(state: EditorState, query: SearchQuery): { from: number; to: number } | null {
  if (!query.valid || !query.search) return null
  const after = query.getCursor(state, state.selection.main.from).next()
  if (!after.done) return after.value
  const first = query.getCursor(state).next()
  return first.done ? null : first.value
}

/** Opens the bar (or refocuses it), seeded from the selection; `replace` also shows the replace row. */
export function openFind(view: EditorView, replace: boolean): boolean {
  if (!searchPanelOpen(view.state)) openSearchPanel(view)
  const panel = panels.get(view)
  if (!panel) return false
  const { from, to } = view.state.selection.main
  const selected = view.state.sliceDoc(from, to)
  if (selected && !selected.includes('\n')) {
    const q = getSearchQuery(view.state)
    view.dispatch({
      effects: setSearchQuery.of(
        new SearchQuery({ search: selected, caseSensitive: q.caseSensitive, wholeWord: q.wholeWord, regexp: false, replace: q.replace })
      )
    })
  }
  panel.focus()
  if (replace) panel.showReplace(true)
  return true
}

export const findBar = search({ top: true, createPanel: (view) => new FindPanel(view) })
