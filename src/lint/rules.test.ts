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

describe('method size rules', () => {
  const params = (src: string, path?: string) =>
    runLint(input(src, path), defaultConfig()).filter((r) => r.ruleId === 'max-parameters').map((r) => r.message)

  it('counts parameters, keeping generics and defaults together', () => {
    expect(params('class A\n{\n\tvoid Ok(Dictionary<int, string> map, int b = 1)\n\t{\n\t\tx();\n\t}\n}\n')).toEqual([])
    expect(params('class A\n{\n\tvoid Big(int a, int b, int c, int d, int e, Dictionary<int, string> f)\n\t{\n\t\tx();\n\t}\n}\n')).toEqual([
      'Big takes 6 parameters (at most 5)'
    ])
  })

  it('reads parameter lists split over several lines', () => {
    const src = 'class A\n{\n\tpublic A(\n\t\tint a,\n\t\tint b,\n\t\tint c,\n\t\tint d,\n\t\tint e,\n\t\tint f)\n\t{\n\t\tx();\n\t}\n}\n'
    expect(params(src)).toEqual(['A takes 6 parameters (at most 5)'])
  })

  it("doesn't count self in Python or Rust", () => {
    const py = 'class A:\n    def go(self, a, b, c, d, e):\n        pass\n'
    const doc = Text.of(py.split('\n'))
    const blocks = scanBlocks(py, 'indent')
    const found = runLint({ doc, path: 'a.py', extension: 'py', scope: { blocks, symbols: findSymbols(doc, blocks) }, tabSize: 4 }, defaultConfig())
    expect(found.filter((r) => r.ruleId === 'max-parameters')).toEqual([])
    expect(params('impl A {\n    fn go(&mut self, a: u8, b: u8, c: u8, d: u8, e: u8) {\n        x();\n    }\n}\n', 'a.rs')).toEqual([])
  })

  it('scores complexity from branches, ignoring comments and strings', () => {
    const branches = Array.from({ length: 15 }, (_, i) => `\t\tif (a${i} && b) { x(); }`).join('\n')
    const src = `class A\n{\n\tvoid Busy()\n\t{\n${branches}\n\t\t// if if if while\n\t\tLog("for if while");\n\t}\n}\n`
    const found = runLint(input(src), defaultConfig()).filter((r) => r.ruleId === 'max-complexity')
    expect(found.map((r) => r.message)).toEqual(['Busy has a complexity of 31 (at most 15)'])
  })

  it('notes very long files', () => {
    expect(ids('x\n'.repeat(801))).toContain('max-file-length')
    expect(ids('x\n'.repeat(100))).not.toContain('max-file-length')
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
