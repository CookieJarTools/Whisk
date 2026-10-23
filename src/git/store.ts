import { create } from 'zustand'
import { useStore } from '../store/store'
import { getView } from '../editor/views'
import { reloadFromDisk, onFileSaved } from '../editor/actions'
import { absolutePath, parseStatus, repoRelative, runGit, tryGit, type GitFile, type GitStatus } from './git'

/**
 * The project's git repository: its status, kept fresh as files save and
 * Whisk regains focus, and the operations the Commit panel and status bar use.
 */

interface GitState {
  /** Repository root on disk, or null when the project isn't in one. */
  repo: string | null
  status: GitStatus | null
  /** What's running ("Pushing…"), for the panel and status bar. */
  busy: string | null
  /** Bumped when HEAD moves, so editors reload what they compare against. */
  headVersion: number
}

export const useGit = create<GitState>(() => ({ repo: null, status: null, busy: null, headVersion: 0 }))

const toast = (message: string, kind?: 'info' | 'success' | 'error') => useStore.getState().toast(message, kind)

let refreshing: Promise<void> | null = null
let again = false

/** Re-reads `git status`. Calls while one is running collapse into one more run. */
export function refreshGit(): Promise<void> {
  if (refreshing) {
    again = true
    return refreshing
  }
  refreshing = (async () => {
    do {
      again = false
      const repo = useGit.getState().repo
      if (!repo) break
      const raw = await tryGit(repo, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all'])
      if (raw === null || useGit.getState().repo !== repo) break
      const status = parseStatus(raw)
      const prev = useGit.getState().status
      useGit.setState((s) => ({ status, headVersion: prev && prev.oid !== status.oid ? s.headVersion + 1 : s.headVersion }))
    } while (again)
  })().finally(() => {
    refreshing = null
  })
  return refreshing
}

/** Finds the repository the project lives in (if any) and reads its status. */
export async function openRepo(root: string | null) {
  useGit.setState({ repo: null, status: null, busy: null })
  if (!root) return
  const top = await tryGit(root, ['rev-parse', '--show-toplevel'])
  if (!top || useStore.getState().root !== root) return
  const repo = top.trim().split('/').join(root.includes('\\') ? '\\' : '/')
  useGit.setState((s) => ({ repo, headVersion: s.headVersion + 1 }))
  await refreshGit()
}

let installed = false

/** Keeps the status fresh: on save, when Whisk gets focus back, and when the folder changes. */
export function installGit() {
  if (installed) return
  installed = true
  onFileSaved(() => void refreshGit())
  window.addEventListener('focus', () => void refreshGit())
  let root = useStore.getState().root
  void openRepo(root)
  useStore.subscribe((s) => {
    if (s.root === root) return
    root = s.root
    void openRepo(root)
  })
}

/** The status of an open file, by its path on disk. */
export function fileStatus(path: string): GitFile | null {
  const { repo, status } = useGit.getState()
  if (!repo || !status) return null
  const rel = repoRelative(repo, path)
  return rel === null ? null : (status.files.find((f) => f.path === rel) ?? null)
}

/** A file's text in the last commit, or null when it's new (or outside the repository). */
export async function headText(path: string): Promise<string | null> {
  const repo = useGit.getState().repo
  const rel = repo ? repoRelative(repo, path) : null
  if (!repo || !rel) return null
  return tryGit(repo, ['show', `HEAD:${rel}`])
}

/** Runs an operation with a busy label, refreshing afterwards and reporting failures. */
async function operation<T>(label: string, run: (repo: string) => Promise<T>): Promise<T | null> {
  const repo = useGit.getState().repo
  if (!repo) return null
  useGit.setState({ busy: label })
  try {
    return await run(repo)
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), 'error')
    return null
  } finally {
    useGit.setState({ busy: null })
    await refreshGit()
  }
}

/** Open, unchanged editors pick up what's now on disk (after a pull, checkout or rollback). */
async function reloadOpenFiles(only?: string[]) {
  const dirty = useStore.getState().dirty
  const wanted = only?.map((p) => p.toLowerCase())
  for (const tab of useStore.getState().tabs) {
    if (tab.diff || (wanted && !wanted.includes(tab.path.toLowerCase()))) continue
    if (dirty[tab.path] && !wanted) continue
    if (getView(tab.path)) await reloadFromDisk(tab.path)
  }
}

/** Every path a commit of these files touches (a rename's old path too). */
function pathsOf(files: GitFile[]): string[] {
  return files.flatMap((f) => (f.from ? [f.path, f.from] : [f.path]))
}

export interface CommitOptions {
  amend?: boolean
  push?: boolean
}

/** Commits exactly these files, as Rider's commit checkboxes do, leaving anything else staged alone. */
export function commit(files: GitFile[], message: string, options: CommitOptions = {}) {
  return operation(options.push ? 'Committing and pushing…' : 'Committing…', async (repo) => {
    const paths = pathsOf(files)
    if (paths.length) await runGit(repo, ['add', '-A', '--', ...paths])
    const args = ['commit', '-m', message]
    if (options.amend) args.push('--amend')
    if (paths.length) args.push('--', ...paths)
    await runGit(repo, args)
    if (options.push) await pushCurrent(repo)
    toast(options.push ? 'Committed and pushed.' : `Committed ${files.length} file${files.length === 1 ? '' : 's'}.`, 'success')
    return true
  })
}

async function pushCurrent(repo: string) {
  const status = useGit.getState().status
  // A new branch has no upstream yet: publish it to origin.
  if (status?.branch && !status.upstream) await runGit(repo, ['push', '-u', 'origin', status.branch])
  else await runGit(repo, ['push'])
}

export const push = () => operation('Pushing…', async (repo) => {
  await pushCurrent(repo)
  toast('Pushed.', 'success')
})

export const fetch = () => operation('Fetching…', (repo) => runGit(repo, ['fetch', '--prune']))

export const pull = () =>
  operation('Pulling…', async (repo) => {
    const out = await runGit(repo, ['pull', '--ff-only'])
    await reloadOpenFiles()
    toast(/Already up to date/i.test(out) ? 'Already up to date.' : 'Pulled.', 'success')
  })

/** Throws away changes to these files, back to the last commit. New files are deleted. */
export function rollback(files: GitFile[]) {
  return operation('Rolling back…', async (repo) => {
    // A rename rolls back as: restore the old path, delete the new one.
    const tracked = files.flatMap((f) => (f.status === 'renamed' ? [f.from!] : f.status === 'untracked' || f.status === 'added' ? [] : [f.path]))
    const fresh = files.flatMap((f) => (f.status === 'untracked' || f.status === 'added' || f.status === 'renamed' ? [f.path] : []))
    if (tracked.length) await runGit(repo, ['restore', '--staged', '--worktree', '--source=HEAD', '--', ...tracked])
    if (fresh.length) {
      await tryGit(repo, ['rm', '--cached', '--quiet', '--', ...fresh])
      await runGit(repo, ['clean', '-f', '--', ...fresh])
      for (const rel of fresh) {
        const path = absolutePath(repo, rel).toLowerCase()
        const tab = useStore.getState().tabs.find((t) => t.path.toLowerCase() === path)
        if (tab) useStore.getState().closeTab(tab.path)
      }
    }
    await reloadOpenFiles(tracked.map((p) => absolutePath(repo, p)))
    useStore.getState().refreshTree()
  })
}

export async function listBranches(): Promise<{ name: string; current: boolean }[]> {
  const repo = useGit.getState().repo
  if (!repo) return []
  const out = await tryGit(repo, ['branch', '--format=%(HEAD)%(refname:short)'])
  return (out ?? '')
    .split('\n')
    .filter(Boolean)
    .map((l) => ({ name: l.slice(1), current: l[0] === '*' }))
}

export const checkout = (branch: string, create = false) =>
  operation(`Switching to ${branch}…`, async (repo) => {
    await runGit(repo, create ? ['switch', '-c', branch] : ['switch', branch])
    await reloadOpenFiles()
    useStore.getState().refreshTree()
    toast(`On ${branch}.`, 'success')
  })
