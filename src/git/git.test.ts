import { describe, expect, it } from 'vitest'
import { absolutePath, age, parseBlame, parseLog, parseStatus, repoRelative } from './git'

const H = 'f7a5e68b1da339f36ec3ad2449aa288ca0336dd1'
const Z = '0'.repeat(40)

describe('parseStatus', () => {
  it('reads branch, modified, renamed, staged and untracked files', () => {
    const raw = [
      `# branch.oid ${H}`,
      '# branch.head main',
      '# branch.upstream origin/main',
      '# branch.ab +2 -1',
      `1 .M N... 100644 100644 100644 ${H} ${H} a.txt`,
      `2 R. N... 100644 100644 100644 ${H} ${H} R100 new.txt`,
      'old.txt',
      `1 M. N... 100644 100644 100644 ${H} ${H} with space.txt`,
      `u UU N... 100644 100644 100644 100644 ${H} ${H} ${H} clash.cs`,
      '? untracked.txt',
      ''
    ].join('\0')
    const status = parseStatus(raw)
    expect(status).toMatchObject({ branch: 'main', upstream: 'origin/main', ahead: 2, behind: 1 })
    expect(status.files).toEqual([
      { path: 'a.txt', status: 'modified', staged: false, unstaged: true },
      { path: 'new.txt', from: 'old.txt', status: 'renamed', staged: true, unstaged: false },
      { path: 'with space.txt', status: 'modified', staged: true, unstaged: false },
      { path: 'clash.cs', status: 'conflict', staged: false, unstaged: true },
      { path: 'untracked.txt', status: 'untracked', staged: false, unstaged: true }
    ])
  })

  it('treats a detached HEAD as no branch', () => {
    expect(parseStatus('# branch.head (detached)\0').branch).toBeNull()
  })
})

describe('parseBlame', () => {
  it('gives every line its commit, reusing details for repeated commits', () => {
    const raw = [
      `${H} 1 1 1`,
      'author Test Person',
      'author-time 1700000000',
      'summary First commit',
      'filename a.txt',
      '\tone',
      `${Z} 2 2 1`,
      'author Not Committed Yet',
      'author-time 1700000100',
      'summary Version of a.txt from a.txt',
      'filename a.txt',
      '\tTWO',
      `${H} 3 3 1`,
      '\tthree',
      ''
    ].join('\n')
    const lines = parseBlame(raw)
    expect(lines.map((l) => l.author)).toEqual(['Test Person', 'You', 'Test Person'])
    expect(lines[0]).toBe(lines[2])
    expect(lines[0]).toMatchObject({ time: 1700000000, summary: 'First commit' })
    expect(lines[1].summary).toBe('Not committed yet')
  })
})

describe('parseLog', () => {
  it('splits records and fields', () => {
    const raw = `${H}\x1fAda\x1f1700000000\x1fFix it\x1e\n${Z}\x1fBob\x1f1700000001\x1fAdd: a, b\x1e\n`
    expect(parseLog(raw)).toEqual([
      { hash: H, author: 'Ada', time: 1700000000, subject: 'Fix it' },
      { hash: Z, author: 'Bob', time: 1700000001, subject: 'Add: a, b' }
    ])
  })
})

describe('paths and ages', () => {
  it('maps between disk and repository paths', () => {
    expect(repoRelative('F:\\Dev\\Game', 'F:\\Dev\\Game\\Assets\\A.cs')).toBe('Assets/A.cs')
    expect(repoRelative('F:/Dev/Game', 'f:\\dev\\game\\x.cs')).toBe('x.cs')
    expect(repoRelative('F:\\Dev\\Game', 'F:\\Dev\\Other\\x.cs')).toBeNull()
    expect(absolutePath('F:\\Dev\\Game', 'Assets/A.cs')).toBe('F:\\Dev\\Game\\Assets\\A.cs')
  })

  it('describes ages in the largest whole unit', () => {
    const now = 1_000_000_000
    expect(age(now - 30, now)).toBe('just now')
    expect(age(now - 3 * 86400, now)).toBe('3 days ago')
    expect(age(now - 400 * 86400, now)).toBe('1 year ago')
  })
})
