import type { Variable } from './session'

/**
 * A value as an expandable tree, as Rider shows it when you hover something
 * while paused: the value itself, then its fields and properties, each of
 * which opens in turn. Plain DOM, because it lives inside an editor tooltip.
 * Children are fetched only when a row is opened.
 */

/** Rows shown before a "show more" link, so a huge array doesn't freeze the tooltip. */
const PAGE = 100

type Fetch = (ref: number) => Promise<Variable[]>

function row(v: Variable, depth: number, fetch: Fetch): HTMLElement {
  const wrap = document.createElement('div')
  const line = document.createElement('div')
  line.className = 'dbg-tree-row'
  line.style.paddingLeft = `${depth * 14 + 4}px`
  const expandable = v.variablesReference > 0

  const chev = document.createElement('span')
  chev.className = 'dbg-tree-chev'
  chev.textContent = expandable ? '▸' : ''
  const name = document.createElement('span')
  name.className = 'dbg-tree-name'
  name.textContent = v.name
  const eq = document.createElement('span')
  eq.className = 'dbg-tree-eq'
  eq.textContent = ' = '
  const value = document.createElement('span')
  value.className = `dbg-tree-value${/^".*"$/.test(v.value) ? ' string' : /^-?\d/.test(v.value) ? ' number' : /^(true|false|null)$/.test(v.value) ? ' keyword' : ''}`
  value.textContent = v.value
  value.title = v.value
  line.append(chev, name, eq, value)
  if (v.type) {
    const type = document.createElement('span')
    type.className = 'dbg-tree-type'
    type.textContent = v.type
    line.append(type)
  }
  wrap.append(line)
  if (!expandable) return wrap

  const kids = document.createElement('div')
  kids.hidden = true
  wrap.append(kids)
  let loaded = false
  const toggle = async () => {
    kids.hidden = !kids.hidden
    chev.textContent = kids.hidden ? '▸' : '▾'
    if (loaded || kids.hidden) return
    loaded = true
    kids.textContent = ''
    kids.append(note('Loading…', depth + 1))
    const children = await fetch(v.variablesReference)
    kids.textContent = ''
    appendRows(kids, children, depth + 1, fetch)
  }
  line.addEventListener('mousedown', (e) => {
    // Keep the editor from taking focus (which would close the tooltip).
    e.preventDefault()
    void toggle()
  })
  ;(wrap as HTMLElement & { open?: () => Promise<void> }).open = toggle
  return wrap
}

function note(text: string, depth: number): HTMLElement {
  const el = document.createElement('div')
  el.className = 'dbg-tree-note'
  el.style.paddingLeft = `${depth * 14 + 18}px`
  el.textContent = text
  return el
}

function appendRows(parent: HTMLElement, vars: Variable[], depth: number, fetch: Fetch, from = 0) {
  if (vars.length === 0 && from === 0) {
    parent.append(note('No members', depth))
    return
  }
  for (const v of vars.slice(from, from + PAGE)) parent.append(row(v, depth, fetch))
  const left = vars.length - from - PAGE
  if (left <= 0) return
  const more = note(`Show ${Math.min(left, PAGE)} more of ${left}…`, depth)
  more.classList.add('more')
  more.addEventListener('mousedown', (e) => {
    e.preventDefault()
    more.remove()
    appendRows(parent, vars, depth, fetch, from + PAGE)
  })
  parent.append(more)
}

/** The tree for one value, opened one level so its members show straight away. */
export function valueTree(root: Variable, fetch: Fetch): HTMLElement {
  const tree = document.createElement('div')
  tree.className = 'dbg-tree'
  const top = row(root, 0, fetch) as HTMLElement & { open?: () => Promise<void> }
  tree.append(top)
  void top.open?.()
  return tree
}
