import { invoke } from '@tauri-apps/api/core'

/**
 * Talking to git: one Rust command runs `git` and this module reads its
 * output. Paths git prints are relative to the repository, with forward slashes.
 */

export interface GitOutput {
  code: number
  stdout: string
  stderr: string
}

export class GitError extends Error {}

export async function runGit(cwd: string, args: string[], stdin?: string): Promise<string> {
  const out = await invoke<GitOutput>('git', { cwd, args, stdin: stdin ?? null })
  if (out.code !== 0) throw new GitError((out.stderr || out.stdout).trim() || `git ${args[0]} failed`)
  return out.stdout
}

/** Like runGit, but null instead of an error (for "is this even a repo?" questions). */
export async function tryGit(cwd: string, args: string[], stdin?: string): Promise<string | null> {
  try {
    return await runGit(cwd, args, stdin)
  } catch {
    return null
  }
}

export type FileStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflict'

export interface GitFile {
  /** Relative to the repository root, forward slashes. */
  path: string
  /** For renames: where it came from. */
  from?: string
  status: FileStatus
  /** Has changes in the index (will be committed). */
  staged: boolean
  /** Has changes in the working tree not yet staged. */
  unstaged: boolean
}

export interface GitStatus {
  /** The commit HEAD points at; null in a repository with no commits yet. */
  oid: string | null
  branch: string | null
  upstream: string | null
  ahead: number
  behind: number
  files: GitFile[]
}

function statusFrom(xy: string): FileStatus {
  if (xy.includes('A')) return 'added'
  if (xy.includes('D')) return 'deleted'
  if (xy.includes('R') || xy.includes('C')) return 'renamed'
  return 'modified'
}

/** Reads `git status --porcelain=v2 --branch -z`. */
export function parseStatus(raw: string): GitStatus {
  const status: GitStatus = { oid: null, branch: null, upstream: null, ahead: 0, behind: 0, files: [] }
  const fields = raw.split('\0')
  for (let i = 0; i < fields.length; i++) {
    const entry = fields[i]
    if (!entry) continue
    if (entry.startsWith('# branch.oid ')) {
      const oid = entry.slice(13)
      status.oid = oid === '(initial)' ? null : oid
    } else if (entry.startsWith('# branch.head ')) {
      const head = entry.slice(14)
      status.branch = head === '(detached)' ? null : head
    } else if (entry.startsWith('# branch.upstream ')) {
      status.upstream = entry.slice(18)
    } else if (entry.startsWith('# branch.ab ')) {
      const [ahead, behind] = entry.slice(12).split(' ')
      status.ahead = Math.abs(Number(ahead))
      status.behind = Math.abs(Number(behind))
    } else if (entry.startsWith('1 ') || entry.startsWith('2 ')) {
      const parts = entry.split(' ')
      const xy = parts[1]
      const renamed = entry[0] === '2'
      // Type 1 has 8 fields before the path, type 2 one more (the rename score).
      const path = parts.slice(renamed ? 9 : 8).join(' ')
      const file: GitFile = { path, status: statusFrom(xy), staged: xy[0] !== '.', unstaged: xy[1] !== '.' }
      if (renamed) file.from = fields[++i]
      status.files.push(file)
    } else if (entry.startsWith('u ')) {
      const path = entry.split(' ').slice(10).join(' ')
      status.files.push({ path, status: 'conflict', staged: false, unstaged: true })
    } else if (entry.startsWith('? ')) {
      status.files.push({ path: entry.slice(2), status: 'untracked', staged: false, unstaged: true })
    }
  }
  return status
}

export interface BlameLine {
  hash: string
  author: string
  /** Seconds since 1970. */
  time: number
  summary: string
}

const UNCOMMITTED = /^0{40}$/

/** Reads `git blame --porcelain`: one entry per line of the file. */
export function parseBlame(raw: string): BlameLine[] {
  const commits = new Map<string, BlameLine>()
  const lines: BlameLine[] = []
  let current: BlameLine | null = null
  for (const line of raw.split('\n')) {
    const header = /^([0-9a-f]{40}) \d+ (\d+)/.exec(line)
    if (header) {
      const hash = header[1]
      current = commits.get(hash) ?? { hash, author: '', time: 0, summary: '' }
      commits.set(hash, current)
      if (UNCOMMITTED.test(hash)) {
        current.author = 'You'
        current.summary = 'Not committed yet'
      }
    } else if (current && line.startsWith('\t')) {
      lines.push(current)
    } else if (current && !UNCOMMITTED.test(current.hash)) {
      if (line.startsWith('author ')) current.author = line.slice(7)
      else if (line.startsWith('author-time ')) current.time = Number(line.slice(12))
      else if (line.startsWith('summary ')) current.summary = line.slice(8)
    }
  }
  return lines
}

export function isUncommitted(line: BlameLine): boolean {
  return UNCOMMITTED.test(line.hash)
}

/** "3 days ago", "2 years ago": the short age Rider shows beside blame. */
export function age(seconds: number, now = Date.now() / 1000): string {
  const units: [number, string][] = [
    [365 * 86400, 'year'],
    [30 * 86400, 'month'],
    [7 * 86400, 'week'],
    [86400, 'day'],
    [3600, 'hour'],
    [60, 'minute']
  ]
  const diff = Math.max(0, now - seconds)
  for (const [size, name] of units) {
    const n = Math.floor(diff / size)
    if (n >= 1) return `${n} ${name}${n === 1 ? '' : 's'} ago`
  }
  return 'just now'
}

export interface Commit {
  hash: string
  author: string
  time: number
  subject: string
}

/** Reads `git log --format=%H%x1f%an%x1f%at%x1f%s%x1e`. */
export function parseLog(raw: string): Commit[] {
  return raw
    .split('\x1e')
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => {
      const [hash, author, time, subject] = r.split('\x1f')
      return { hash, author, time: Number(time), subject }
    })
}

/** Where a repository-relative path lives on disk. */
export function absolutePath(repo: string, rel: string): string {
  const sep = repo.includes('\\') ? '\\' : '/'
  return repo.replace(/[\\/]+$/, '') + sep + rel.split('/').join(sep)
}

/** A file's path relative to the repository, as git wants it, or null when outside it. */
export function repoRelative(repo: string, path: string): string | null {
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')
  const r = norm(repo)
  const p = norm(path)
  if (p.toLowerCase() === r.toLowerCase()) return ''
  return p.toLowerCase().startsWith(r.toLowerCase() + '/') ? p.slice(r.length + 1) : null
}
