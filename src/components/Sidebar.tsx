import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { ipc, type DirEntry } from '../lib/ipc'
import { joinPath, relativePath, samePath } from '../lib/paths'
import { languageFor } from '../lib/languages'
import { useStore } from '../store/store'
import { Icon, type IconName } from './Icon'
import { CommitPanel } from './CommitPanel'
import { useGit } from '../git/store'
import { repoRelative } from '../git/git'
import { shortcutLabel } from '../keymap/keymap'

const INDENT = 14
const BASE_PAD = 10
const MIN_WIDTH = 180
const MAX_WIDTH = 520

/** Project noise hidden unless "Show hidden files" is on: Unity meta files, generated solution files, logs. */
const HIDDEN = [/\.meta$/i, /\.(csproj|sln)$/i, /\.DotSettings(\.user)?$/i, /^replay_pid.*\.log$/i, /^\.DS_Store$/]

export function isHiddenFile(name: string): boolean {
  return HIDDEN.some((re) => re.test(name))
}

const CODE_LANES = new Set(['csharp', 'typescript', 'typescriptreact', 'javascript', 'javascriptreact', 'rust', 'python', 'java', 'cpp', 'hlsl'])

interface Row {
  entry: DirEntry
  depth: number
  /** Folders above this row, outermost first. */
  ancestors: string[]
}

export function fileIcon(path: string): { icon: IconName; colour: string } {
  const lang = languageFor(path)
  if (CODE_LANES.has(lang.lspId)) return { icon: 'fileCode', colour: `var(--lane-${lang.lane})` }
  if (lang.lspId === 'markdown' || lang.lspId === 'plaintext') return { icon: 'fileText', colour: 'var(--text-faint)' }
  return { icon: 'file', colour: `var(--lane-${lang.lane})` }
}

function flatten(root: string, listings: Record<string, DirEntry[]>, expanded: Record<string, boolean>, showHidden: boolean): Row[] {
  const rows: Row[] = []
  const walk = (dir: string, depth: number, ancestors: string[]) => {
    for (const entry of listings[dir] ?? []) {
      if (!showHidden && !entry.is_dir && HIDDEN.some((re) => re.test(entry.name))) continue
      rows.push({ entry, depth, ancestors })
      if (entry.is_dir && expanded[entry.path]) walk(entry.path, depth + 1, [...ancestors, entry.path])
    }
  }
  walk(root, 0, [])
  return rows
}

/** Paths of every folder between the root and `file`, so the tree can open down to it. */
function foldersTo(root: string, file: string): string[] {
  const parts = relativePath(root, file).split(/[\\/]/).slice(0, -1)
  const out: string[] = []
  let dir = root
  for (const part of parts) {
    dir = joinPath(dir, part)
    out.push(dir)
  }
  return out
}

function Section({
  title,
  count,
  open,
  onToggle,
  children
}: {
  title: string
  count?: number
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div className={`side-section${open ? ' open' : ''}`}>
      <button className="side-section-head" onClick={onToggle}>
        <span className="side-section-chev">
          <Icon name="chevronDown" size={11} strokeWidth={2.2} />
        </span>
        <span>{title}</span>
        {count !== undefined && <span className="side-count">{count}</span>}
      </button>
      {open && children}
    </div>
  )
}

function OpenEditors() {
  const tabs = useStore((s) => s.tabs)
  const active = useStore((s) => s.active)
  const dirty = useStore((s) => s.dirty)
  const setActive = useStore((s) => s.setActive)
  const closeTab = useStore((s) => s.closeTab)
  if (tabs.length === 0) return <div className="side-empty">No files open</div>
  return (
    <div className="side-list">
      {tabs.map((t) => {
        const { icon, colour } = fileIcon(t.path)
        return (
          <div
            key={t.path}
            className={`tree-row${t.path === active ? ' active' : ''}`}
            style={{ paddingLeft: BASE_PAD }}
            onClick={() => setActive(t.path)}
            title={t.path}
          >
            <Icon name={icon} size={14} style={{ color: colour }} className="tree-icon" />
            <span className="tree-name">{t.name}</span>
            {dirty[t.path] ? (
              <span className="tree-dirty" />
            ) : (
              <button
                className="tree-close"
                title="Close"
                onClick={(e) => {
                  e.stopPropagation()
                  closeTab(t.path)
                }}
              >
                <Icon name="close" size={11} />
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

function FileTree({ root }: { root: string }) {
  const expanded = useStore((s) => s.expanded)
  const toggleDir = useStore((s) => s.toggleDir)
  const expandTo = useStore((s) => s.expandTo)
  const openFile = useStore((s) => s.openFile)
  const active = useStore((s) => s.active)
  const showHidden = useStore((s) => s.showHidden)
  const treeVersion = useStore((s) => s.treeVersion)
  const [listings, setListings] = useState<Record<string, DirEntry[]>>({})
  const [focus, setFocus] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Drop cached listings when the folder changes or the user refreshes.
  useEffect(() => setListings({}), [root, treeVersion])

  // Load any open folder that hasn't been listed yet.
  useEffect(() => {
    const wanted = [root, ...Object.keys(expanded).filter((p) => expanded[p])].filter((p) => !listings[p])
    for (const dir of wanted) {
      ipc
        .listDir(dir)
        .then((entries) => setListings((l) => ({ ...l, [dir]: entries })))
        .catch(() => setListings((l) => ({ ...l, [dir]: [] })))
    }
  }, [root, expanded, listings])

  // Follow the active editor: open the folders down to it and scroll it into view.
  useEffect(() => {
    if (!active || relativePath(root, active) === active) return
    expandTo(foldersTo(root, active))
    setFocus(active)
  }, [active, root, expandTo])

  const rows = useMemo(() => flatten(root, listings, expanded, showHidden), [root, listings, expanded, showHidden])

  // Changed files take their git colour, and folders holding changes a softer one, as in Rider.
  const repo = useGit((s) => s.repo)
  const gitFiles = useGit((s) => s.status?.files)
  const gitMarks = useMemo(() => {
    const files = new Map<string, string>()
    const dirs = new Set<string>()
    for (const f of gitFiles ?? []) {
      const rel = f.path.toLowerCase()
      files.set(rel, f.status)
      for (let i = rel.lastIndexOf('/'); i > 0; i = rel.lastIndexOf('/', i - 1)) dirs.add(rel.slice(0, i))
    }
    return { files, dirs }
  }, [gitFiles])
  const gitClass = (path: string, isDir: boolean) => {
    const rel = repo ? repoRelative(repo, path)?.toLowerCase() : null
    if (!rel) return ''
    if (isDir) return gitMarks.dirs.has(rel) ? ' git-dir' : ''
    const status = gitMarks.files.get(rel)
    return status ? ` git-${status}` : ''
  }
  const activeParent = active ? active.replace(/[\\/][^\\/]*$/, '') : null

  useEffect(() => {
    if (!focus) return
    const el = listRef.current?.querySelector<HTMLElement>(`[data-path="${CSS.escape(focus)}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [focus, rows])

  const activate = useCallback(
    (row: Row) => {
      setFocus(row.entry.path)
      if (row.entry.is_dir) toggleDir(row.entry.path)
      else openFile(row.entry.path)
    },
    [toggleDir, openFile]
  )

  const onKeyDown = (e: KeyboardEvent) => {
    const index = rows.findIndex((r) => r.entry.path === focus)
    const row = rows[index]
    const move = (i: number) => {
      const next = rows[Math.max(0, Math.min(rows.length - 1, i))]
      if (next) setFocus(next.entry.path)
    }
    if (e.key === 'ArrowDown') move(index + 1)
    else if (e.key === 'ArrowUp') move(index < 0 ? 0 : index - 1)
    else if (e.key === 'Home') move(0)
    else if (e.key === 'End') move(rows.length - 1)
    else if (e.key === 'ArrowRight' && row?.entry.is_dir) {
      if (!expanded[row.entry.path]) toggleDir(row.entry.path)
      else move(index + 1)
    } else if (e.key === 'ArrowLeft' && row) {
      if (row.entry.is_dir && expanded[row.entry.path]) toggleDir(row.entry.path)
      else if (row.ancestors.length) setFocus(row.ancestors[row.ancestors.length - 1])
    } else if ((e.key === 'Enter' || e.key === ' ') && row) activate(row)
    else return
    e.preventDefault()
  }

  return (
    <div className="tree" ref={listRef} tabIndex={0} onKeyDown={onKeyDown}>
      {rows.map((row) => {
        const { entry, depth, ancestors } = row
        const open = entry.is_dir && !!expanded[entry.path]
        const isActive = !!active && samePath(active, entry.path)
        const { icon, colour } = entry.is_dir
          ? { icon: (open ? 'folderOpen' : 'folder') as IconName, colour: 'var(--text-faint)' }
          : fileIcon(entry.path)
        return (
          <div
            key={entry.path}
            data-path={entry.path}
            className={`tree-row${entry.is_dir ? ' dir' : ''}${isActive ? ' active' : ''}${focus === entry.path ? ' focused' : ''}${gitClass(entry.path, entry.is_dir)}`}
            style={{ paddingLeft: BASE_PAD + depth * INDENT }}
            onClick={() => activate(row)}
            title={entry.path}
          >
            {ancestors.map((dir, level) => (
              <span
                key={dir}
                className={`tree-guide${activeParent && samePath(dir, activeParent) ? ' lit' : ''}`}
                style={{ left: BASE_PAD + level * INDENT + 6 }}
              />
            ))}
            <span className={`tree-chev${open ? ' open' : ''}`}>
              {entry.is_dir && <Icon name="chevron" size={10} strokeWidth={2.4} />}
            </span>
            <Icon name={icon} size={14} style={{ color: colour }} className="tree-icon" />
            <span className="tree-name">{entry.name}</span>
          </div>
        )
      })}
    </div>
  )
}

function Resizer() {
  const setWidth = useStore((s) => s.setSidebarWidth)
  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    const move = (ev: MouseEvent) => setWidth(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, ev.clientX)))
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      document.body.classList.remove('resizing')
    }
    document.body.classList.add('resizing')
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  return <div className="sidebar-resizer" onMouseDown={onMouseDown} />
}

export function Sidebar({
  floating = false,
  peek = false,
  onMouseEnter,
  onMouseLeave
}: {
  /** Hidden off the left edge, sliding in over the editor when `peek` is set (Zen-style). */
  floating?: boolean
  peek?: boolean
  onMouseEnter?: () => void
  onMouseLeave?: () => void
}) {
  const root = useStore((s) => s.root)!
  const width = useStore((s) => s.sidebarWidth)
  const tabCount = useStore((s) => s.tabs.length)
  const openPalette = useStore((s) => s.openPalette)
  const [openEditors, setOpenEditors] = useState(true)
  const [files, setFiles] = useState(true)
  const sideView = useStore((s) => s.sideView)
  const setSideView = useStore((s) => s.setSideView)
  const changeCount = useGit((s) => s.status?.files.length ?? 0)
  const hasRepo = useGit((s) => !!s.repo)

  return (
    <aside
      className={`sidebar${floating ? ' floating' : ''}${floating && peek ? ' peek' : ''}`}
      style={{ width }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <button className="side-search" onClick={() => openPalette('files')}>
        <Icon name="search" size={13} />
        <span>Go to file…</span>
        <span className="kbd">Ctrl P</span>
      </button>
      <div className="side-views">
        <button className={sideView === 'files' ? 'on' : ''} onClick={() => setSideView('files')}>
          Files
        </button>
        <button className={sideView === 'commit' ? 'on' : ''} onClick={() => setSideView('commit')} title={shortcutLabel('git.commit')}>
          Commit
          {hasRepo && changeCount > 0 && <span className="side-count">{changeCount}</span>}
        </button>
      </div>
      {sideView === 'commit' ? (
        <CommitPanel />
      ) : (
      <div className="side-scroll">
        <Section title="Open editors" count={tabCount} open={openEditors} onToggle={() => setOpenEditors((o) => !o)}>
          <OpenEditors />
        </Section>
        <Section title="Files" open={files} onToggle={() => setFiles((o) => !o)}>
          <FileTree root={root} />
        </Section>
      </div>
      )}
      <Resizer />
    </aside>
  )
}
