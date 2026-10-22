import type { Text } from '@codemirror/state'
import type { ScopeInfo } from '../editor/scopes'
import { DEFAULT_IGNORE, matchesAny, type LintConfig, type OptionValue, type Severity } from './config'

/**
 * Whisk's built-in lint rules. Each works on plain text plus the block and
 * symbol info the editor already has, so they run on any language without a
 * language server. Defaults aim to catch real mess without nagging.
 */

export interface RuleInput {
  doc: Text
  /** Project-relative path, used for ignores and file masks. */
  path: string
  /** Lowercase file extension, without the dot. */
  extension: string
  scope: ScopeInfo | null
  tabSize: number
}

export interface Finding {
  from: number
  to: number
  message: string
  /** Replace `from..to` with `insert` to fix it. */
  fix?: { label: string; insert: string }
}

export interface OptionDef {
  key: string
  label: string
  type: 'number' | 'text'
  default: OptionValue
}

export interface RuleDef {
  id: string
  title: string
  description: string
  severity: Severity
  options?: OptionDef[]
  check(input: RuleInput, options: Record<string, OptionValue>): Finding[]
}

export interface LintResult extends Finding {
  severity: Exclude<Severity, 'off'>
  ruleId: string
  ruleTitle: string
}

const PROSE = new Set(['md', 'markdown', 'txt'])
const COMMENT_START = /^\s*(\/\/|#|\/\*|\*|--|<!--|;)/

function* lines(doc: Text) {
  for (let n = 1; n <= doc.lines; n++) yield doc.line(n)
}

function visualLength(text: string, tabSize: number): number {
  let col = 0
  for (const ch of text) col += ch === '\t' ? tabSize - (col % tabSize) : 1
  return col
}

/** Each of these adds a way through a method. */
const BRANCH_RE = /\b(if|for|foreach|while|case|catch|elif|except)\b|&&|\|\||\band\b|\bor\b/g

/** Code with comments and string contents blanked out, so words inside them don't count. */
function codeOnly(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*$/gm, ' ')
    .replace(/(^|\s)#(?!\[).*$/gm, ' ')
    .replace(/"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`/g, '""')
}

/** Receivers that aren't real arguments: Python's self/cls, Rust's self in its forms. */
const RECEIVER_RE = /^(self|cls|&\s*(mut\s+)?self|mut\s+self|\*|\/)$/

/**
 * A declaration's parameters: the text between the brackets after its name,
 * split on top-level commas. `from`/`to` cover the brackets, for underlining.
 */
export function parameterList(doc: Text, headerLine: number, blockFrom: number, name: string): { params: string[]; from: number; to: number } | null {
  const start = doc.line(headerLine).from
  const text = doc.sliceString(start, blockFrom)
  const named = new RegExp(`\\b${name.replace(/[$]/g, '\\$')}\\s*(<[^()]*>)?\\s*\\(`).exec(text)
  const open = named ? named.index + named[0].length - 1 : text.indexOf('(', Math.max(0, text.indexOf(name)))
  if (open < 0) return null
  const params: string[] = []
  let depth = 0
  let current = ''
  let quote = ''
  for (let i = open; i < text.length; i++) {
    const ch = text[i]
    if (quote) {
      current += ch
      if (ch === quote && text[i - 1] !== '\\') quote = ''
      continue
    }
    if (ch === '"' || ch === "'") quote = ch
    if ('([{<'.includes(ch)) depth++
    if (')]}>'.includes(ch) && !(ch === '>' && text[i - 1] === '=')) depth--
    if (depth === 0) {
      params.push(current.slice(1))
      const cleaned = params.map((p) => p.trim()).filter((p) => p && !RECEIVER_RE.test(p))
      return { params: cleaned, from: start + open, to: start + i + 1 }
    }
    if (ch === ',' && depth === 1) {
      params.push(current.slice(1))
      current = '('
      continue
    }
    current += ch
  }
  return null
}

export const RULES: RuleDef[] = [
  {
    id: 'trailing-whitespace',
    title: 'Trailing whitespace',
    description: 'Spaces or tabs at the end of a line.',
    severity: 'info',
    check({ doc, extension }) {
      // Two trailing spaces mean a line break in Markdown.
      if (PROSE.has(extension)) return []
      const out: Finding[] = []
      for (const line of lines(doc)) {
        const m = /[ \t]+$/.exec(line.text)
        if (m && m.index < line.text.length && line.text.trim()) {
          out.push({ from: line.from + m.index, to: line.to, message: 'Trailing whitespace', fix: { label: 'Remove', insert: '' } })
        }
      }
      return out
    }
  },
  {
    id: 'final-newline',
    title: 'Newline at end of file',
    description: 'The file should end with a line break.',
    severity: 'info',
    check({ doc }) {
      if (doc.length === 0) return []
      const last = doc.line(doc.lines)
      if (last.text === '') return []
      const from = doc.length - 1
      return [{ from, to: doc.length, message: 'No newline at end of file', fix: { label: 'Add newline', insert: doc.sliceString(from) + '\n' } }]
    }
  },
  {
    id: 'consecutive-blank-lines',
    title: 'Too many blank lines',
    description: 'More blank lines in a row than allowed.',
    severity: 'info',
    options: [{ key: 'max', label: 'Most blank lines in a row', type: 'number', default: 2 }],
    check({ doc }, { max }) {
      const limit = Number(max)
      const out: Finding[] = []
      let runStart = 0
      for (let n = 1; n <= doc.lines + 1; n++) {
        const blank = n <= doc.lines && doc.line(n).text.trim() === ''
        if (blank && !runStart) runStart = n
        if (!blank && runStart) {
          const count = n - runStart
          if (count > limit && n <= doc.lines) {
            const from = doc.line(runStart + limit).from
            const to = doc.line(n).from
            out.push({ from, to, message: `${count} blank lines in a row (at most ${limit})`, fix: { label: 'Remove extra lines', insert: '' } })
          }
          runStart = 0
        }
      }
      return out
    }
  },
  {
    id: 'max-line-length',
    title: 'Line too long',
    description: 'Lines longer than the limit are hard to read side by side.',
    severity: 'info',
    options: [{ key: 'max', label: 'Longest line, in characters', type: 'number', default: 150 }],
    check({ doc, tabSize, extension }, { max }) {
      if (PROSE.has(extension)) return []
      const limit = Number(max)
      const out: Finding[] = []
      for (const line of lines(doc)) {
        if (line.length <= limit || visualLength(line.text, tabSize) <= limit) continue
        out.push({ from: line.from + Math.min(limit, line.length), to: line.to, message: `Line is ${visualLength(line.text, tabSize)} characters (at most ${limit})` })
      }
      return out
    }
  },
  {
    id: 'mixed-indentation',
    title: 'Mixed indentation',
    description: 'Lines indented with spaces in a file that uses tabs, or the other way round.',
    severity: 'warning',
    check({ doc, extension }) {
      if (PROSE.has(extension)) return []
      let tabs = 0
      let spaces = 0
      for (const line of lines(doc)) {
        if (line.text.startsWith('\t')) tabs++
        else if (line.text.startsWith('  ')) spaces++
      }
      if (tabs === 0 || spaces === 0) return []
      const usesTabs = tabs >= spaces
      const out: Finding[] = []
      for (const line of lines(doc)) {
        const indent = /^[ \t]*/.exec(line.text)![0]
        if (!indent || !line.text.trim()) continue
        // A space after tabs to line up a block comment's `*` is normal.
        if (usesTabs && /^\t* \*/.test(line.text)) continue
        const wrong = usesTabs ? indent.startsWith('  ') : indent.includes('\t')
        if (wrong) out.push({ from: line.from, to: line.from + indent.length, message: usesTabs ? 'Indented with spaces; this file uses tabs' : 'Indented with tabs; this file uses spaces' })
      }
      return out
    }
  },
  {
    id: 'todo-comments',
    title: 'TODO comments',
    description: 'Notes left in comments, so they don’t get forgotten.',
    severity: 'info',
    options: [{ key: 'words', label: 'Words to flag', type: 'text', default: 'TODO, FIXME, HACK' }],
    check({ doc }, { words }) {
      const list = String(words)
        .split(',')
        .map((w) => w.trim())
        .filter(Boolean)
        .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      if (!list.length) return []
      const re = new RegExp(`(\\/\\/|#|\\/\\*|\\*|--|<!--)\\s*(${list.join('|')})\\b`)
      const out: Finding[] = []
      for (const line of lines(doc)) {
        const m = re.exec(line.text)
        if (!m) continue
        const start = m.index + m[0].length - m[2].length
        out.push({ from: line.from + start, to: line.to, message: line.text.slice(start).trim() })
      }
      return out
    }
  },
  {
    id: 'max-nesting',
    title: 'Nesting too deep',
    description: 'Blocks nested too deeply inside a method. Pulling the inner part out into its own method usually reads better.',
    severity: 'warning',
    options: [{ key: 'max', label: 'Deepest nesting inside a method', type: 'number', default: 4 }],
    check({ doc, scope }, { max }) {
      if (!scope) return []
      const limit = Number(max)
      const out: Finding[] = []
      for (const fn of scope.symbols.filter((s) => s.kind === 'method' || s.kind === 'function')) {
        let reportedUntil = -1
        for (const block of scope.blocks) {
          if (block.from <= fn.block.from || block.to >= fn.block.to || block.from < reportedUntil) continue
          const depth = block.depth - fn.block.depth
          if (depth <= limit) continue
          const line = doc.lineAt(block.from)
          const textStart = line.from + (line.text.length - line.text.trimStart().length)
          out.push({ from: textStart, to: line.to, message: `Nested ${depth} levels deep in ${fn.name} (at most ${limit})` })
          reportedUntil = block.to
        }
      }
      return out
    }
  },
  {
    id: 'max-function-length',
    title: 'Method too long',
    description: 'Methods and functions longer than the limit.',
    severity: 'warning',
    options: [{ key: 'max', label: 'Longest method, in lines', type: 'number', default: 80 }],
    check({ doc, scope }, { max }) {
      if (!scope) return []
      const limit = Number(max)
      const out: Finding[] = []
      for (const fn of scope.symbols) {
        if (fn.kind !== 'method' && fn.kind !== 'function') continue
        const length = fn.block.closeLine - fn.block.openLine - 1
        if (length <= limit) continue
        const header = doc.line(fn.headerLine)
        const at = header.text.indexOf(fn.name)
        const from = header.from + Math.max(0, at)
        out.push({ from, to: at >= 0 ? from + fn.name.length : header.to, message: `${fn.name} is ${length} lines long (at most ${limit})` })
      }
      return out
    }
  },
  {
    id: 'max-parameters',
    title: 'Too many parameters',
    description: 'Methods that take a lot of parameters are hard to call correctly. Grouping them into a type usually helps.',
    severity: 'warning',
    options: [{ key: 'max', label: 'Most parameters', type: 'number', default: 5 }],
    check({ doc, scope }, { max }) {
      if (!scope) return []
      const limit = Number(max)
      const out: Finding[] = []
      for (const fn of scope.symbols) {
        if (fn.kind !== 'method' && fn.kind !== 'function') continue
        const list = parameterList(doc, fn.headerLine, fn.block.from, fn.name)
        if (!list || list.params.length <= limit) continue
        out.push({ from: list.from, to: list.to, message: `${fn.name} takes ${list.params.length} parameters (at most ${limit})` })
      }
      return out
    }
  },
  {
    id: 'max-complexity',
    title: 'Method too complex',
    description: 'Counts the ways through a method: each if, loop, case, catch, && and || adds one. High counts are hard to follow and to test.',
    severity: 'warning',
    options: [{ key: 'max', label: 'Highest complexity', type: 'number', default: 15 }],
    check({ doc, scope }, { max }) {
      if (!scope) return []
      const limit = Number(max)
      const out: Finding[] = []
      for (const fn of scope.symbols) {
        if (fn.kind !== 'method' && fn.kind !== 'function') continue
        const body = codeOnly(doc.sliceString(fn.block.from, fn.block.to + 1))
        const branches = (body.match(BRANCH_RE) ?? []).length
        const complexity = 1 + branches
        if (complexity <= limit) continue
        const header = doc.line(fn.headerLine)
        const at = header.text.indexOf(fn.name)
        const from = header.from + Math.max(0, at)
        out.push({ from, to: at >= 0 ? from + fn.name.length : header.to, message: `${fn.name} has a complexity of ${complexity} (at most ${limit})` })
      }
      return out
    }
  },
  {
    id: 'max-file-length',
    title: 'File too long',
    description: 'Very long files usually hold more than one idea and are easier to work with split up.',
    severity: 'info',
    options: [{ key: 'max', label: 'Longest file, in lines', type: 'number', default: 800 }],
    check({ doc, extension }, { max }) {
      const limit = Number(max)
      if (PROSE.has(extension) || doc.lines <= limit) return []
      const first = doc.line(1)
      return [{ from: first.from, to: first.to, message: `File is ${doc.lines} lines long (at most ${limit})` }]
    }
  },
  {
    id: 'empty-catch',
    title: 'Empty catch block',
    description: 'A catch that does nothing hides errors. Handle it, log it, or say why it’s safe to ignore.',
    severity: 'warning',
    check({ doc }) {
      const text = doc.toString()
      const out: Finding[] = []
      for (const m of text.matchAll(/\bcatch\b[^{;]*\{\s*\}/g)) {
        out.push({ from: m.index!, to: m.index! + m[0].length, message: 'Empty catch block swallows errors' })
      }
      // `except: pass` in Python.
      for (const m of text.matchAll(/\bexcept\b[^:\n]*:\s*\n?\s*pass\b/g)) {
        out.push({ from: m.index!, to: m.index! + m[0].length, message: 'Empty except block swallows errors' })
      }
      return out
    }
  },
  {
    id: 'debug-output',
    title: 'Leftover debug output',
    description: 'Debug.Log, console.log, print and friends left in the code.',
    severity: 'off',
    check({ doc }) {
      const re = /\b(Debug\.Log\w*|console\.(log|debug|trace)|System\.out\.print\w*|println!|fmt\.Print\w*|print)\s*\(/
      const out: Finding[] = []
      for (const line of lines(doc)) {
        if (COMMENT_START.test(line.text)) continue
        const m = re.exec(line.text)
        if (m) out.push({ from: line.from + m.index, to: line.from + m.index + m[1].length, message: `Debug output: ${m[1]}` })
      }
      return out
    }
  }
]

/** Defaults for every rule, as a config with nothing overridden. */
export function defaultConfig(): LintConfig {
  const rules: LintConfig['rules'] = {}
  for (const rule of RULES) {
    rules[rule.id] = {
      severity: rule.severity,
      options: Object.fromEntries((rule.options ?? []).map((o) => [o.key, o.default]))
    }
  }
  return { enabled: true, rules, custom: [], ignore: DEFAULT_IGNORE }
}

const MAX_LINT_CHARS = 500_000

export function runLint(input: RuleInput, config: LintConfig): LintResult[] {
  if (!config.enabled || input.doc.length > MAX_LINT_CHARS || matchesAny(input.path, config.ignore)) return []
  const results: LintResult[] = []
  for (const rule of RULES) {
    const setting = config.rules[rule.id]
    if (!setting || setting.severity === 'off') continue
    for (const f of rule.check(input, setting.options)) {
      results.push({ ...f, severity: setting.severity, ruleId: rule.id, ruleTitle: rule.title })
    }
  }
  for (const custom of config.custom) {
    if (custom.severity === 'off' || (custom.files && !matchesAny(input.path, [custom.files]))) continue
    let re: RegExp
    try {
      re = new RegExp(custom.pattern, 'g' + (custom.flags ?? '').replace(/g/g, ''))
    } catch {
      continue
    }
    const text = input.doc.toString()
    for (const m of text.matchAll(re)) {
      if (!m[0]) continue
      results.push({
        from: m.index!,
        to: m.index! + m[0].length,
        message: custom.message,
        severity: custom.severity,
        ruleId: `custom:${custom.id}`,
        ruleTitle: custom.id
      })
    }
  }
  return results
}
