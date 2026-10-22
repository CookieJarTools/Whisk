import { describe, expect, it } from 'vitest'
import { Text } from '@codemirror/state'
import { findSymbols, scanBlocks } from '../editor/scopes'
import { defaultConfig, runLint, type RuleInput } from './rules'
import { globToRegExp, matchesAny, mergeConfig } from './config'

function input(src: string, path = 'Assets/Player.cs'): RuleInput {
  const doc = Text.of(src.split('\n'))
  const blocks = scanBlocks(src, 'c')
  return { doc, path, extension: path.split('.').pop()!, scope: { blocks, symbols: findSymbols(doc, blocks) }, tabSize: 4 }
}

const ids = (src: string, config = defaultConfig(), path?: string) => runLint(input(src, path), config).map((r) => r.ruleId)

describe('built-in rules', () => {
  it('flags trailing whitespace with a fix, but not in Markdown', () => {
    const [r] = runLint(input('int a = 1;   \n'), defaultConfig())
    expect(r.ruleId).toBe('trailing-whitespace')
    expect(r.fix?.insert).toBe('')
    expect(ids('Hello  \nworld\n', defaultConfig(), 'README.md')).not.toContain('trailing-whitespace')
  })

  it('wants a final newline', () => {
    expect(ids('int a;')).toContain('final-newline')
    expect(ids('int a;\n')).not.toContain('final-newline')
  })

  it('allows two blank lines but not three', () => {
    expect(ids('a\n\n\nb\n')).not.toContain('consecutive-blank-lines')
    expect(ids('a\n\n\n\nb\n')).toContain('consecutive-blank-lines')
  })

  it('spots spaces in a tab-indented file, ignoring doc-comment alignment', () => {
    const src = 'class A\n{\n\tvoid B()\n\t{\n\t /** ok */\n    int c;\n\t}\n}\n'
    const found = runLint(input(src), defaultConfig()).filter((r) => r.ruleId === 'mixed-indentation')
    expect(found).toHaveLength(1)
    expect(found[0].message).toContain('uses tabs')
  })

  it('reports nesting deeper than the limit once, at the outermost offending block', () => {
    const src = `class A
{
\tvoid Deep()
\t{
\t\tif (a)
\t\t{
\t\t\tif (b)
\t\t\t{
\t\t\t\tif (c)
\t\t\t\t{
\t\t\t\t\tif (d)
\t\t\t\t\t{
\t\t\t\t\t\tif (e)
\t\t\t\t\t\t{
\t\t\t\t\t\t\tx();
\t\t\t\t\t\t}
\t\t\t\t\t}
\t\t\t\t}
\t\t\t}
\t\t}
\t}
}
`
    const found = runLint(input(src), defaultConfig()).filter((r) => r.ruleId === 'max-nesting')
    expect(found).toHaveLength(1)
    expect(found[0].message).toBe('Nested 5 levels deep in Deep (at most 4)')
  })

  it('catches empty catch blocks and except: pass', () => {
    expect(ids('try { a(); } catch (Exception) { }\n')).toContain('empty-catch')
    expect(ids('try:\n    a()\nexcept:\n    pass\n', defaultConfig(), 'a.py')).toContain('empty-catch')
    expect(ids('try { a(); } catch (Exception e) { Log(e); }\n')).not.toContain('empty-catch')
  })

  it('flags TODO notes in comments only', () => {
    const found = runLint(input('// TODO: tidy this\nvar todo = 1;\n'), defaultConfig()).filter((r) => r.ruleId === 'todo-comments')
    expect(found.map((f) => f.message)).toEqual(['TODO: tidy this'])
  })

  it('leaves debug output alone unless turned on', () => {
    expect(ids('Debug.Log("hi");\n')).not.toContain('debug-output')
    const on = mergeConfig(defaultConfig(), { rules: { 'debug-output': { severity: 'warning' } } })
    expect(ids('Debug.Log("hi");\n// Debug.Log("old");\n', on)).toEqual(['debug-output'])
  })
})

describe('configuration', () => {
  it('layers user and project settings over the defaults', () => {
    const user = mergeConfig(defaultConfig(), { rules: { 'max-line-length': { options: { max: 100 } } } })
    const project = mergeConfig(user, { rules: { 'max-line-length': { severity: 'error' } } })
    expect(project.rules['max-line-length']).toEqual({ severity: 'error', options: { max: 100 } })
    expect(ids('x'.repeat(120) + '\n', project)).toContain('max-line-length')
  })

  it('runs custom regex rules on matching files', () => {
    const config = mergeConfig(defaultConfig(), {
      custom: [{ id: 'no-find-object', pattern: 'FindObjectOfType', message: 'Avoid FindObjectOfType', severity: 'warning', files: '*.cs' }]
    })
    expect(ids('var a = FindObjectOfType<Player>();\n', config)).toContain('custom:no-find-object')
    expect(ids('FindObjectOfType\n', config, 'notes.ts')).not.toContain('custom:no-find-object')
  })

  it('skips ignored paths and turns off entirely', () => {
    expect(ids('a   \n', mergeConfig(defaultConfig(), { ignore: ['Assets/Plugins/**'] }), 'Assets/Plugins/Lib.cs')).toEqual([])
    expect(ids('a   \n', mergeConfig(defaultConfig(), { enabled: false }))).toEqual([])
  })

  it('matches globs the usual way', () => {
    expect(globToRegExp('**/*.min.js').test('web/lib/app.min.js')).toBe(true)
    expect(globToRegExp('Assets/*.cs').test('Assets/Sub/A.cs')).toBe(false)
    expect(matchesAny('Assets\\Plugins\\X.cs', ['Assets/Plugins/**'])).toBe(true)
    expect(matchesAny('src/A.cs', ['*.cs, *.ts'])).toBe(true)
  })
})
