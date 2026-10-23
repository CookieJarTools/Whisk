import { describe, expect, it } from 'vitest'
import { orderActions } from './codeActions'

describe('orderActions', () => {
  it('puts fixes first, preferred on top, and drops disabled ones', () => {
    const ordered = orderActions([
      { title: 'Extract method', kind: 'refactor.extract' },
      { title: 'Add using', kind: 'quickfix' },
      { title: 'Organize usings', kind: 'source.organizeImports' },
      { title: 'Generate constructor', kind: 'quickfix', isPreferred: true },
      { title: 'Inline', kind: 'refactor.inline', disabled: { reason: 'nope' } },
      { title: 'Bare command', command: 'do.it' },
      { title: 'Extract local function' }
    ])
    expect(ordered.map((o) => o.action.title)).toEqual(['Generate constructor', 'Add using', 'Bare command', 'Extract method', 'Extract local function', 'Organize usings'])
    expect(ordered[2].action.command).toEqual({ title: 'Bare command', command: 'do.it' })
  })
})
