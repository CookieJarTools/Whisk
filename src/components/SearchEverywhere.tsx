import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useStore, type SearchMode } from '../store/store'
import { ipc, type IndexedSymbol, type SearchMatch } from '../lib/ipc'
import { baseName, relativePath } from '../lib/paths'
import { fuzzyMatch } from '../lib/fuzzy'
import { getView } from '../editor/views'
import { scopeField, type SymbolKind } from '../editor/scopes'
import { getRecentFiles, jumpTo } from '../editor/navigation'
import { allActions, shortcutLabel } from '../keymap/keymap'
import { fileIcon, isHiddenFile } from './Sidebar'
import { Icon } from './Icon'
import { TextPreview } from './TextPreview'

/**
 * Rider's Search Everywhere (double Shift): tabs for All, Types, Files, Symbols,
 * Actions and Text, in one window. File structure, Go to line and Recent files
 * reuse the same window without tabs.
 */

const TABS: { mode: SearchMode; label: string }[] = [
  { mode: 'all', label: 'All' },
  { mode: 'types', label: 'Types' },
  { mode: 'files', label: 'Files' },
  { mode: 'symbols', label: 'Symbols' },
  { mode: 'actions', label: 'Actions' },
  { mode: 'text', label: 'Text' }
]
const TABBED = new Set(TABS.map((t) => t.mode))
const TITLES: Partial<Record<SearchMode, string>> = { structure: 'File structure', line: 'Go to line', recent: 'Recent files' }
const PLACEHOLDERS: Record<SearchMode, string> = {
  all: 'Search types, files, symbols and actions',
  types: 'Type name (CamelHumps work: VCh → VoxelChunk)',
  files: 'File name',
  symbols: 'Method, function or type name',
  actions: 'Action name',
  text: 'Text to find in the project',
  structure: 'Filter declarations in this file',
  line: 'Line number, or line:column',
  recent: 'Filter recent files'
}

const SECTION_LIMIT = 6
const LIST_LIMIT = 80
const TEXT_DEBOUNCE_MS = 220
const INDEX_MAX_AGE_MS = 30_000

interface Item {
  key: string
  icon: ReactNode
  label: string
  positions: number[]
  detail?: string
  hint?: string
  score: number
  run: () => void
  /** For text results: what the preview should show. */
  preview?: { path: string; line: number; col: number; length: number }
}

interface Section {
  title?: string
  items: Item[]
}

const KIND_BADGES: Record<string, { letter: string; lane: number }> = {
  class: { letter: 'C', lane: 6 },
  record: { letter: 'R', lane: 6 },
  struct: { letter: 'S', lane: 6 },
  interface: { letter: 'I', lane: 2 },
  trait: { letter: 'I', lane: 2 },
  protocol: { letter: 'I', lane: 2 },
  enum: { letter: 'E', lane: 3 },
  type: { letter: 'T', lane: 6 },
  object: { letter: 'O', lane: 6 },
  namespace: { letter: 'N', lane: 11 },
  method: { letter: 'M', lane: 1 },
  function: { letter: 'F', lane: 1 },
  def: { letter: 'F', lane: 1 },
  fn: { letter: 'F', lane: 1 },
  func: { letter: 'F', lane: 1 },
  fun: { letter: 'F', lane: 1 },
  property: { letter: 'P', lane: 4 }
}

function KindBadge({ kind }: { kind: string }) {
  const badge = KIND_BADGES[kind] ?? { letter: kind.charAt(0).toUpperCase(), lane: 11 }
  return (
    <span className="kind-badge" style={{ ['--lane' as string]: `var(--lane-${badge.lane})` }}>
      {badge.letter}
    </span>
  )
}

function FileBadge({ path }: { path: string }) {
  const { icon, colour } = fileIcon(path)
  return <Icon name={icon} size={14} style={{ color: colour }} />
}

function Highlighted({ text, positions }: { text: string; positions: number[] }) {
  if (positions.length === 0) return <>{text}</>
  const set = new Set(positions)
  const parts: ReactNode[] = []
  let run = ''
  let runHit = false
  const flush = (i: number) => {
    if (run) parts.push(runHit ? <mark key={i}>{run}</mark> : <span key={i}>{run}</span>)
    run = ''
  }
  for (let i = 0; i < text.length; i++) {
    const hit = set.has(i)
    if (hit !== runHit) {
      flush(i)
      runHit = hit
    }
    run += text[i]
  }
  flush(text.length)
  return <>{parts}</>
}

// Caches shared across openings, refreshed in the background.
let fileCache: { root: string; files: string[] } | null = null
let indexCache: { root: string; at: number; symbols: IndexedSymbol[] } | null = null

function rank<T>(items: T[], query: string, text: (t: T) => string, limit: number) {
  const out: { item: T; score: number; positions: number[] }[] = []
  for (const item of items) {
    const m = fuzzyMatch(query, text(item))
    if (m) out.push({ item, score: m.score, positions: m.positions })
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit)
}

interface TextOptions {
  caseSensitive: boolean
  wholeWord: boolean
  regex: boolean
  fileMask: string
}

export function SearchEverywhere() {
  const { open, mode: initialMode, query: initialQuery } = useStore((s) => s.palette)
  const root = useStore((s) => s.root)
  const close = useStore((s) => s.closePalette)
  const openFile = useStore((s) => s.openFile)
  const [mode, setMode] = useState<SearchMode>(initialMode)
  const [query, setQuery] = useState(initialQuery)
  const [index, setIndex] = useState(0)
  const [files, setFiles] = useState<string[]>([])
  const [symbols, setSymbols] = useState<IndexedSymbol[]>([])
  const [indexing, setIndexing] = useState(false)
  const [text, setText] = useState<{ matches: SearchMatch[]; files: number; truncated: boolean; error?: string; busy: boolean }>({
    matches: [],
    files: 0,
    truncated: false,
    busy: false
  })
  const [textOptions, setTextOptions] = useState<TextOptions>({ caseSensitive: false, wholeWord: false, regex: false, fileMask: '' })
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const textRequest = useRef(0)

  // Reset each time the window opens, and refresh the file list and symbol index.
  useEffect(() => {
    if (!open) return
    setMode(initialMode)
    setQuery(initialQuery)
    setIndex(0)
    requestAnimationFrame(() => inputRef.current?.select())
    if (!root) return
    if (fileCache?.root === root) setFiles(fileCache.files)
    ipc.listFiles(root).then((list) => {
      fileCache = { root, files: list }
      setFiles(list)
    })
    if (indexCache?.root === root) setSymbols(indexCache.symbols)
    if (!indexCache || indexCache.root !== root || Date.now() - indexCache.at > INDEX_MAX_AGE_MS) {
      setIndexing(true)
      ipc
        .indexSymbols(root)
        .then((list) => {
          indexCache = { root, at: Date.now(), symbols: list }
          setSymbols(list)
        })
        .finally(() => setIndexing(false))
    }
  }, [open, initialMode, initialQuery, root])

  // Project text search, debounced; stale replies are dropped.
  useEffect(() => {
    if (!open || mode !== 'text' || !root) return
    const q = query
    if (!q.trim()) {
      setText({ matches: [], files: 0, truncated: false, busy: false })
      return
    }
    const id = ++textRequest.current
    setText((t) => ({ ...t, busy: true }))
    const timer = window.setTimeout(() => {
      ipc
        .searchProject({ root, query: q, ...textOptions, includeHidden: useStore.getState().showHidden, maxResults: 2000 })
        .then((r) => id === textRequest.current && setText({ matches: r.matches, files: r.filesWithMatches, truncated: r.truncated, busy: false }))
        .catch((e) => id === textRequest.current && setText({ matches: [], files: 0, truncated: false, busy: false, error: String(e) }))
    }, TEXT_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [open, mode, query, root, textOptions])

  const sections = useMemo<Section[]>(() => {
    const q = query.trim()
    const goFile = (path: string) => () => void openFile(path)
    const showHidden = useStore.getState().showHidden
    const fileItems = (limit: number, all = files, list = showHidden ? all : all.filter((f) => !isHiddenFile(baseName(f)))) =>
      (q ? rank(list, q, (f) => baseName(f), limit) : list.slice(0, limit).map((item) => ({ item, score: 0, positions: [] }))).map(
        ({ item, score, positions }): Item => ({
          key: 'f:' + item,
          icon: <FileBadge path={item} />,
          label: baseName(item),
          positions,
          detail: relativePath(root, item),
          score,
          run: goFile(item)
        })
      )
    const symbolItems = (kind: IndexedSymbol['kind'] | null, limit: number) => {
      const pool = kind ? symbols.filter((s) => s.kind === kind) : symbols
      if (!q) return []
      return rank(pool, q, (s) => s.name, limit).map(
        ({ item, score, positions }): Item => ({
          key: `s:${item.path}:${item.line}:${item.name}`,
          icon: <KindBadge kind={item.detail} />,
          label: item.name,
          positions,
          detail: `${relativePath(root, item.path)}:${item.line}`,
          score,
          run: () => void jumpTo(item.path, item.line)
        })
      )
    }
    const actionItems = (limit: number) => {
      const actions = allActions()
      const ranked = q ? rank(actions, q, (a) => a.title, limit) : actions.slice(0, limit).map((item) => ({ item, score: 0, positions: [] }))
      return ranked.map(
        ({ item, score, positions }): Item => ({
          key: 'a:' + item.id,
          icon: <span className="kind-badge action">›</span>,
          label: item.title,
          positions,
          detail: item.category,
          hint: shortcutLabel(item.id),
          score,
          run: item.run
        })
      )
    }

    switch (mode) {
      case 'files':
        return [{ items: fileItems(LIST_LIMIT) }]
      case 'types':
        return [{ items: symbolItems('type', LIST_LIMIT) }]
      case 'symbols':
        return [{ items: symbolItems(null, LIST_LIMIT) }]
      case 'actions':
        return [{ items: actionItems(LIST_LIMIT) }]
      case 'recent':
        return [{ items: fileItems(LIST_LIMIT, [...getRecentFiles()]) }]
      case 'text':
        return [
          {
            items: text.matches.slice(0, 500).map((m, i): Item => {
              const lead = m.text.length - m.text.trimStart().length
              const shown = m.text.trimStart()
              const start = m.col - lead
              return {
                key: `t:${i}:${m.path}:${m.line}:${m.col}`,
                icon: <FileBadge path={m.path} />,
                label: shown,
                positions: start >= 0 ? Array.from({ length: Math.min(m.len, shown.length - start) }, (_, k) => start + k) : [],
                detail: `${baseName(m.path)}:${m.line}`,
                score: 0,
                run: () => void jumpTo(m.path, m.line, m.col, m.len),
                preview: { path: m.path, line: m.line, col: m.col, length: m.len }
              }
            })
          }
        ]
      case 'structure': {
        const view = getView(useStore.getState().active)
        const syms = view?.state.field(scopeField, false)?.symbols ?? []
        const path = useStore.getState().active
        const depthOf = (s: (typeof syms)[number]) => {
          let d = 0
          for (let p = s.parent; p; p = p.parent) d++
          return d
        }
        const pool = q ? rank(syms, q, (s) => s.name, LIST_LIMIT) : syms.map((item) => ({ item, score: 0, positions: [] }))
        return [
          {
            items: pool.map(
              ({ item, score, positions }): Item => ({
                key: `st:${item.from}`,
                icon: (
                  <span style={{ paddingLeft: q ? 0 : depthOf(item) * 14, display: 'inline-flex' }}>
                    <KindBadge kind={item.kind as SymbolKind} />
                  </span>
                ),
                label: item.name,
                positions,
                detail: `:${item.headerLine}`,
                score,
                run: () => path && void jumpTo(path, item.headerLine)
              })
            )
          }
        ]
      }
      case 'line': {
        const m = /^(\d+)(?::(\d+))?$/.exec(q)
        const path = useStore.getState().active
        if (!m || !path) return [{ items: [] }]
        const line = Number(m[1])
        const col = m[2] ? Number(m[2]) - 1 : 0
        return [
          {
            items: [
              {
                key: 'line',
                icon: <span className="kind-badge action">↵</span>,
                label: `Go to line ${line}${m[2] ? `, column ${m[2]}` : ''}`,
                positions: [],
                score: 0,
                run: () => void jumpTo(path, line, Math.max(0, col))
              }
            ]
          }
        ]
      }
      case 'all': {
        if (!q) return [{ title: 'Recent files', items: fileItems(SECTION_LIMIT, [...getRecentFiles()]) }]
        const out: Section[] = [
          { title: 'Types', items: symbolItems('type', SECTION_LIMIT) },
          { title: 'Symbols', items: symbolItems('function', SECTION_LIMIT) },
          { title: 'Files', items: fileItems(SECTION_LIMIT) },
          { title: 'Actions', items: actionItems(4) }
        ].filter((s) => s.items.length)
        out.push({
          items: [
            {
              key: 'to-text',
              icon: <Icon name="search" size={13} />,
              label: `Find “${q}” in files`,
              positions: [],
              hint: 'Text tab',
              score: 0,
              run: () => useStore.getState().openPalette('text', q)
            }
          ]
        })
        return out
      }
    }
  }, [mode, query, files, symbols, text.matches, root, openFile])

  const flat = useMemo(() => sections.flatMap((s) => s.items), [sections])
  const selected = flat[Math.min(index, flat.length - 1)]

  useEffect(() => {
    listRef.current?.querySelector('.search-item.active')?.scrollIntoView({ block: 'nearest' })
  }, [index, flat])

  if (!open) return null

  const choose = (item: Item | undefined) => {
    if (!item) return
    // "Find in files" keeps the window open on the Text tab.
    if (item.key !== 'to-text') close()
    item.run()
  }
  const switchMode = (next: SearchMode) => {
    setMode(next)
    setIndex(0)
    inputRef.current?.focus()
  }
  const cycleTab = (dir: 1 | -1) => {
    if (!TABBED.has(mode)) return
    const i = TABS.findIndex((t) => t.mode === mode)
    switchMode(TABS[(i + dir + TABS.length) % TABS.length].mode)
  }
  const toggleOption = (key: 'caseSensitive' | 'wholeWord' | 'regex') => setTextOptions((o) => ({ ...o, [key]: !o[key] }))

  const status =
    mode === 'text'
      ? text.error
        ? text.error
        : text.busy
          ? 'Searching…'
          : query.trim()
            ? `${text.matches.length}${text.truncated ? '+' : ''} matches in ${text.files} files`
            : ''
      : (mode === 'types' || mode === 'symbols' || mode === 'all') && indexing
        ? 'Indexing project…'
        : ''

  return (
    <div className="palette-backdrop" onMouseDown={close}>
      <div className={`search-window${mode === 'text' ? ' with-preview' : ''}`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="search-head">
          {TABBED.has(mode) ? (
            <div className="search-tabs">
              {TABS.map((t) => (
                <button key={t.mode} className={`search-tab${t.mode === mode ? ' active' : ''}`} onClick={() => switchMode(t.mode)}>
                  {t.label}
                </button>
              ))}
            </div>
          ) : (
            <div className="search-title">{TITLES[mode]}</div>
          )}
          <span className="search-status">{status}</span>
        </div>
        <div className="search-input-row">
          <Icon name="search" size={14} className="search-input-icon" />
          <input
            ref={inputRef}
            className="search-input"
            placeholder={PLACEHOLDERS[mode]}
            value={query}
            spellCheck={false}
            onChange={(e) => {
              setQuery(e.target.value)
              setIndex(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') close()
              else if (e.key === 'Tab') {
                e.preventDefault()
                cycleTab(e.shiftKey ? -1 : 1)
              } else if (e.key === 'ArrowDown') {
                e.preventDefault()
                setIndex((i) => Math.min(i + 1, flat.length - 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setIndex((i) => Math.max(i - 1, 0))
              } else if (e.key === 'PageDown') {
                e.preventDefault()
                setIndex((i) => Math.min(i + 10, flat.length - 1))
              } else if (e.key === 'PageUp') {
                e.preventDefault()
                setIndex((i) => Math.max(i - 10, 0))
              } else if (e.key === 'Enter') choose(selected)
              else if (mode === 'text' && e.altKey && !e.ctrlKey && ['KeyC', 'KeyW', 'KeyX'].includes(e.code)) {
                e.preventDefault()
                toggleOption(e.code === 'KeyC' ? 'caseSensitive' : e.code === 'KeyW' ? 'wholeWord' : 'regex')
              }
            }}
          />
          {mode === 'text' && (
            <span className="find-toggles">
              <button className={`find-toggle${textOptions.caseSensitive ? ' on' : ''}`} title="Match case (Alt+C)" onClick={() => toggleOption('caseSensitive')}>
                Aa
              </button>
              <button className={`find-toggle${textOptions.wholeWord ? ' on' : ''}`} title="Whole words (Alt+W)" onClick={() => toggleOption('wholeWord')}>
                W
              </button>
              <button className={`find-toggle${textOptions.regex ? ' on' : ''}`} title="Regular expression (Alt+X)" onClick={() => toggleOption('regex')}>
                .*
              </button>
            </span>
          )}
        </div>
        {mode === 'text' && (
          <div className="search-mask-row">
            <span>File mask</span>
            <input
              className="search-mask"
              placeholder="e.g. *.cs, *.ts (empty = all files)"
              value={textOptions.fileMask}
              spellCheck={false}
              onChange={(e) => setTextOptions((o) => ({ ...o, fileMask: e.target.value }))}
              onKeyDown={(e) => e.key === 'Escape' && close()}
            />
          </div>
        )}
        <div className="search-list" ref={listRef}>
          {flat.length === 0 && (
            <div className="palette-empty">
              {mode === 'line' ? 'Type a line number.' : query.trim() || mode === 'files' ? 'Nothing found.' : 'Start typing to search.'}
            </div>
          )}
          {sections.map((section, si) => (
            <div key={si}>
              {section.title && section.items.length > 0 && <div className="search-section">{section.title}</div>}
              {section.items.map((item) => {
                const i = flat.indexOf(item)
                return (
                  <button
                    key={item.key}
                    className={`search-item${i === index ? ' active' : ''}${item.preview ? ' text-hit' : ''}`}
                    onMouseMove={() => i !== index && setIndex(i)}
                    onClick={() => choose(item)}
                  >
                    <span className="search-item-icon">{item.icon}</span>
                    <span className="search-item-label">
                      <Highlighted text={item.label} positions={item.positions} />
                    </span>
                    {item.detail && <span className="search-item-detail">{item.detail}</span>}
                    {item.hint && <span className="kbd">{item.hint}</span>}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
        {mode === 'text' && selected?.preview && <TextPreview {...selected.preview} />}
        <div className="search-foot">
          {TABBED.has(mode) && <span><span className="kbd">Tab</span> next tab</span>}
          <span><span className="kbd">↑↓</span> move</span>
          <span><span className="kbd">Enter</span> open</span>
          <span><span className="kbd">Esc</span> close</span>
        </div>
      </div>
    </div>
  )
}
