import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store/store'
import { absolutePath, runGit, type GitFile } from '../git/git'
import { commit, fetch, headText, openRepo, pull, push, refreshGit, rollback, useGit } from '../git/store'
import { getView } from '../editor/views'
import { ipc } from '../lib/ipc'
import { baseName } from '../lib/paths'
import { shortcutLabel } from '../keymap/keymap'
import { Icon } from './Icon'
import { fileIcon } from './Sidebar'

/**
 * Rider's Commit tool window: every changed file with a checkbox for whether
 * it goes in the next commit, a message box, and Commit / Commit and Push.
 * Click a file to see its changes side by side.
 */

const LETTER: Record<GitFile['status'], string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  untracked: 'U',
  conflict: '!'
}

/** Opens a changed file's diff against the last commit. */
export async function openChangeDiff(repo: string, file: GitFile) {
  const path = absolutePath(repo, file.path)
  const left = file.status === 'untracked' || file.status === 'added' ? '' : ((await headText(file.from ? absolutePath(repo, file.from) : path)) ?? '')
  const view = getView(path)
  const right = file.status === 'deleted' ? '' : (view?.state.doc.toString() ?? (await ipc.readText(path).catch(() => '')))
  useStore.getState().openDiff(`git:${path}`, `${baseName(path)} (changes)`, {
    leftTitle: `${file.from ?? file.path} · last commit`,
    left,
    rightTitle: `${file.path} · your copy`,
    right,
    path
  })
}

function FileRow({ repo, file, checked, onCheck }: { repo: string; file: GitFile; checked: boolean; onCheck: (on: boolean) => void }) {
  const path = absolutePath(repo, file.path)
  const { icon, colour } = fileIcon(path)
  const dir = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : ''

  const menu = (e: React.MouseEvent) => {
    e.preventDefault()
    useStore.getState().openMenu(e.clientX, e.clientY, [
      { label: 'Show diff', onSelect: () => void openChangeDiff(repo, file) },
      ...(file.status !== 'deleted' ? [{ label: 'Open file', onSelect: () => void useStore.getState().openFile(path) }] : []),
      { type: 'divider' as const },
      {
        label: file.status === 'untracked' || file.status === 'added' ? 'Delete this new file…' : 'Roll back…',
        onSelect: () => {
          if (window.confirm(`Throw away all changes to ${file.path}? This can't be undone.`)) void rollback([file])
        }
      }
    ])
  }

  return (
    <div
      className={`change-row git-${file.status}`}
      title={file.from ? `${file.from} → ${file.path}` : file.path}
      onClick={() => void openChangeDiff(repo, file)}
      onDoubleClick={() => file.status !== 'deleted' && void useStore.getState().openFile(path)}
      onContextMenu={menu}
    >
      <input type="checkbox" checked={checked} onClick={(e) => e.stopPropagation()} onChange={(e) => onCheck(e.target.checked)} />
      <Icon name={icon} size={14} style={{ color: colour }} className="tree-icon" />
      <span className="change-name">{baseName(file.path)}</span>
      {dir && <span className="change-dir">{dir}</span>}
      <span className="change-letter">{LETTER[file.status]}</span>
    </div>
  )
}

export function CommitPanel() {
  const repo = useGit((s) => s.repo)
  const status = useGit((s) => s.status)
  const busy = useGit((s) => s.busy)
  const [message, setMessage] = useState('')
  const [amend, setAmend] = useState(false)
  // Paths left out of the commit; new (untracked) files start left out, as in Rider.
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const [seen, setSeen] = useState<Set<string>>(new Set())

  const files = useMemo(() => status?.files ?? [], [status])

  useEffect(() => {
    void refreshGit()
  }, [])

  useEffect(() => {
    const fresh = files.filter((f) => !seen.has(f.path))
    if (fresh.length === 0) return
    setSeen((s) => new Set([...s, ...fresh.map((f) => f.path)]))
    const untracked = fresh.filter((f) => f.status === 'untracked').map((f) => f.path)
    if (untracked.length) setExcluded((s) => new Set([...s, ...untracked]))
  }, [files, seen])

  if (!repo) {
    return (
      <div className="side-empty commit-empty">
        This folder isn't in a git repository.
        <button className="btn" onClick={() => void initRepo()}>
          Create repository
        </button>
      </div>
    )
  }

  const tracked = files.filter((f) => f.status !== 'untracked')
  const untracked = files.filter((f) => f.status === 'untracked')
  const chosen = files.filter((f) => !excluded.has(f.path))
  const toggle = (path: string, on: boolean) =>
    setExcluded((s) => {
      const next = new Set(s)
      if (on) next.delete(path)
      else next.add(path)
      return next
    })
  const setAll = (group: GitFile[], on: boolean) => group.forEach((f) => toggle(f.path, on))

  const canCommit = !busy && message.trim().length > 0 && (chosen.length > 0 || amend)
  const doCommit = async (andPush: boolean) => {
    if (!canCommit) return
    const ok = await commit(chosen, message.trim(), { amend, push: andPush })
    if (ok) {
      setMessage('')
      setAmend(false)
    }
  }

  const group = (title: string, list: GitFile[]) =>
    list.length > 0 && (
      <div className="change-group">
        <label className="change-group-head">
          <input
            type="checkbox"
            checked={list.every((f) => !excluded.has(f.path))}
            onChange={(e) => setAll(list, e.target.checked)}
          />
          <span>{title}</span>
          <span className="side-count">{list.length}</span>
        </label>
        {list.map((f) => (
          <FileRow key={f.path} repo={repo} file={f} checked={!excluded.has(f.path)} onCheck={(on) => toggle(f.path, on)} />
        ))}
      </div>
    )

  return (
    <div className="commit-panel">
      <div className="commit-toolbar">
        <span className="commit-branch" title={status?.upstream ? `Tracking ${status.upstream}` : 'Not published yet'}>
          <Icon name="branch" size={13} />
          {status?.branch ?? 'detached HEAD'}
          {!!status?.ahead && <span className="commit-ab">↑{status.ahead}</span>}
          {!!status?.behind && <span className="commit-ab">↓{status.behind}</span>}
        </span>
        <button className="icon-btn" title="Fetch" disabled={!!busy} onClick={() => void fetch()}>
          <Icon name="refresh" size={13} />
        </button>
        <button className="icon-btn" title="Pull" disabled={!!busy} onClick={() => void pull()}>
          <Icon name="download" size={13} />
        </button>
        <button className="icon-btn" title={`Push ${shortcutLabel('git.push')}`} disabled={!!busy} onClick={() => void push()}>
          <Icon name="download" size={13} style={{ transform: 'rotate(180deg)' }} />
        </button>
      </div>
      <div className="commit-files">
        {files.length === 0 && <div className="side-empty">No changes. Everything is committed.</div>}
        {group('Changes', tracked)}
        {group('New files', untracked)}
      </div>
      <div className="commit-box">
        <textarea
          className="commit-message"
          placeholder="Commit message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.ctrlKey) {
              e.preventDefault()
              void doCommit(e.altKey)
            }
          }}
          rows={4}
        />
        <label className="commit-amend">
          <input type="checkbox" checked={amend} onChange={(e) => setAmend(e.target.checked)} />
          Amend the last commit
        </label>
        <div className="commit-buttons">
          <button className="btn btn-primary" disabled={!canCommit} onClick={() => void doCommit(false)} title="Ctrl+Enter">
            {busy ?? `Commit${chosen.length ? ` ${chosen.length}` : ''}`}
          </button>
          <button className="btn" disabled={!canCommit} onClick={() => void doCommit(true)} title="Ctrl+Alt+Enter">
            Commit and push
          </button>
        </div>
      </div>
    </div>
  )
}

async function initRepo() {
  const root = useStore.getState().root
  if (!root) return
  try {
    await runGit(root, ['init'])
    await openRepo(root)
    useStore.getState().toast('Created a git repository here.', 'success')
  } catch (e) {
    useStore.getState().toast(String(e), 'error')
  }
}
