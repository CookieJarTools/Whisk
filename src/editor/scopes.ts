import { Facet, StateField, type Text } from '@codemirror/state'
import type { BraceFlavor } from '../lib/languages'

/** A `{ … }` block that spans more than one line. Positions are document offsets of the braces. */
export interface Block {
  from: number
  to: number
  depth: number
  openLine: number
  closeLine: number
}

export type SymbolKind =
  | 'namespace'
  | 'class'
  | 'struct'
  | 'interface'
  | 'enum'
  | 'record'
  | 'method'
  | 'function'
  | 'property'

export interface CodeSymbol {
  name: string
  kind: SymbolKind
  /** The declaration line, e.g. `public void Tick()`. */
  header: string
  headerLine: number
  /** Start of the symbol including attributes and doc comments above it. */
  from: number
  /** Just past the closing brace. */
  to: number
  block: Block
  parent: CodeSymbol | null
}

export interface ScopeInfo {
  blocks: Block[]
  symbols: CodeSymbol[]
}

const MAX_SCAN_CHARS = 2_000_000

export const braceFlavor = Facet.define<BraceFlavor, BraceFlavor>({
  combine: (values) => values[0] ?? 'none'
})

/** Blocks and the declarations they belong to, rescanned on every document change. */
export const scopeField = StateField.define<ScopeInfo>({
  create: (state) => analyse(state.doc, state.facet(braceFlavor)),
  update: (value, tr) => (tr.docChanged ? analyse(tr.state.doc, tr.state.facet(braceFlavor)) : value)
})

function analyse(doc: Text, flavor: BraceFlavor): ScopeInfo {
  if (flavor === 'none' || doc.length > MAX_SCAN_CHARS) return { blocks: [], symbols: [] }
  const blocks = scanBlocks(doc.toString(), flavor)
  return { blocks, symbols: findSymbols(doc, blocks) }
}

/**
 * Pairs up braces while skipping strings, chars and comments. Only blocks that
 * cover more than one line are kept, since single-line ones need no guide.
 */
export function scanBlocks(text: string, flavor: BraceFlavor): Block[] {
  if (flavor === 'none') return []
  if (flavor === 'indent') return scanIndentBlocks(text)
  const blocks: Block[] = []
  const stack: { pos: number; line: number }[] = []
  const n = text.length
  let line = 1
  let i = 0
  while (i < n) {
    const ch = text[i]
    if (ch === '\n') {
      line++
      i++
    } else if (ch === '/' && text[i + 1] === '/') {
      while (i < n && text[i] !== '\n') i++
    } else if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      const stop = end < 0 ? n : end + 2
      line += countLines(text, i, stop)
      i = stop
    } else if (ch === '"' || (ch === "'" && flavor === 'js') || (ch === '`' && flavor === 'js')) {
      const stop = skipString(text, i, flavor)
      line += countLines(text, i, stop)
      i = stop
    } else if (ch === "'") {
      i = skipCharLiteral(text, i)
    } else if (ch === '{') {
      stack.push({ pos: i, line })
      i++
    } else if (ch === '}') {
      const open = stack.pop()
      if (open && line > open.line) {
        blocks.push({ from: open.pos, to: i, depth: stack.length, openLine: open.line, closeLine: line })
      }
      i++
    } else {
      i++
    }
  }
  return blocks.sort((a, b) => a.from - b.from)
}

/**
 * Python-style blocks: a line ending in `:` opens a block that runs until the
 * next line indented no deeper than its header. `from` is the colon and `to`
 * the last character of the block's last non-blank line.
 */
export function scanIndentBlocks(text: string): Block[] {
  const lines = text.split('\n')
  const starts: number[] = []
  let offset = 0
  for (const line of lines) {
    starts.push(offset)
    offset += line.length + 1
  }
  const blocks: Block[] = []
  const open: Block[] = []
  let bracketDepth = 0
  let headerStart = 0
  for (let i = 0; i < lines.length; i++) {
    const body = codeOf(lines[i])
    if (bracketDepth === 0) headerStart = i
    bracketDepth = Math.max(0, bracketDepth + bracketBalance(body))
    if (bracketDepth > 0 || !body.endsWith(':')) continue
    const indent = indentWidth(lines[headerStart])
    let last = i
    for (let j = i + 1; j < lines.length; j++) {
      if (!lines[j].trim()) continue
      if (indentWidth(lines[j]) <= indent) break
      last = j
    }
    if (last === i) continue
    while (open.length && open[open.length - 1].closeLine <= headerStart) open.pop()
    const block: Block = {
      from: starts[i] + body.length - 1,
      to: starts[last] + Math.max(0, lines[last].trimEnd().length - 1),
      depth: open.length,
      openLine: headerStart + 1,
      closeLine: last + 1
    }
    blocks.push(block)
    open.push(block)
  }
  return blocks
}

/** A line with its `#` comment and trailing space removed (strings are left alone). */
function codeOf(line: string): string {
  return line.replace(/#[^'"]*$/, '').trimEnd()
}

function indentWidth(line: string): number {
  let col = 0
  for (const ch of line) {
    if (ch === ' ') col++
    else if (ch === '\t') col += 4
    else break
  }
  return col
}

function bracketBalance(text: string): number {
  let depth = 0
  for (const ch of text.replace(/"[^"]*"|'[^']*'/g, '')) {
    if (ch === '(' || ch === '[' || ch === '{') depth++
    else if (ch === ')' || ch === ']' || ch === '}') depth--
  }
  return depth
}

function countLines(text: string, from: number, to: number): number {
  let lines = 0
  for (let i = from; i < to; i++) if (text[i] === '\n') lines++
  return lines
}

/** Returns the offset just past the string starting at `start`. */
function skipString(text: string, start: number, flavor: BraceFlavor): number {
  const quote = text[start]
  const n = text.length
  if (quote === '"' && text.startsWith('"""', start)) {
    const end = text.indexOf('"""', start + 3)
    return end < 0 ? n : end + 3
  }
  const prefix = text.slice(Math.max(0, start - 2), start)
  const verbatim = flavor === 'c' && quote === '"' && prefix.includes('@')
  const multiline = verbatim || quote === '`'
  let i = start + 1
  while (i < n) {
    const ch = text[i]
    if (verbatim) {
      if (ch === '"' && text[i + 1] === '"') {
        i += 2
        continue
      }
    } else if (ch === '\\') {
      i += 2
      continue
    }
    if (ch === quote) return i + 1
    if (ch === '\n' && !multiline) return i
    i++
  }
  return n
}

/** C#/Rust char literals. A lone `'` (a Rust lifetime) is stepped over. */
function skipCharLiteral(text: string, start: number): number {
  if (text[start + 1] === '\\') {
    const end = text.indexOf("'", start + 2)
    return end > 0 && end - start < 12 ? end + 1 : start + 1
  }
  return text[start + 2] === "'" ? start + 3 : start + 1
}

const TYPE_RE = /\b(namespace|class|struct|interface|enum|record|trait|impl|module)\s+([A-Za-z_][\w.]*)/
const FUNC_KEYWORD_RE = /\b(?:function|fn|def|func)\s+([A-Za-z_$][\w$]*)/
const ARROW_RE = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]+)?=>/
const METHOD_RE = /^(?:[\w<>[\],.?*&]+\s+)*([A-Za-z_$][\w$]*)\s*(?:<[^()]*>)?\s*\(/
const PROPERTY_RE = /^(?:[\w<>[\],.?]+\s+)+([A-Za-z_]\w*)$/

const TYPE_KINDS: Record<string, SymbolKind> = {
  namespace: 'namespace',
  module: 'namespace',
  class: 'class',
  impl: 'class',
  struct: 'struct',
  interface: 'interface',
  trait: 'interface',
  enum: 'enum',
  record: 'record'
}

const NOT_A_NAME = new Set([
  'if', 'for', 'foreach', 'while', 'switch', 'catch', 'using', 'lock', 'fixed', 'return', 'else',
  'do', 'try', 'finally', 'new', 'base', 'this', 'checked', 'unchecked', 'unsafe', 'get', 'set',
  'init', 'add', 'remove', 'when', 'match', 'loop', 'await', 'yield', 'typeof', 'sizeof', 'nameof',
  'default', 'case', 'throw', 'in', 'of', 'super', 'function', 'async', 'static', 'constructor',
  'elif', 'except', 'with', 'lambda', 'print', 'assert', 'not', 'and', 'or'
])

function classify(header: string, parent: CodeSymbol | null): { name: string; kind: SymbolKind } | null {
  const type = TYPE_RE.exec(header)
  if (type) return { name: type[2], kind: TYPE_KINDS[type[1]] }
  const fn = FUNC_KEYWORD_RE.exec(header) ?? ARROW_RE.exec(header)
  if (fn) return { name: fn[1], kind: 'function' }
  const method = METHOD_RE.exec(header)
  if (method && !NOT_A_NAME.has(method[1])) return { name: method[1], kind: parent ? 'method' : 'function' }
  const isInType = parent && parent.kind !== 'namespace' && parent.kind !== 'method' && parent.kind !== 'function'
  const prop = isInType ? PROPERTY_RE.exec(header) : null
  if (prop && !NOT_A_NAME.has(prop[1])) return { name: prop[1], kind: 'property' }
  return null
}

/**
 * Finds the declaration that owns a block: the text before `{` on its line, or
 * for brace-on-own-line style the line(s) above it, joined until the brackets balance.
 */
function headerFor(doc: Text, block: Block): { text: string; line: number } | null {
  const open = doc.line(block.openLine)
  // A multi-line Python header (`def f(\n a,\n b):`) has its colon past the first line.
  const before = open.text.slice(0, Math.max(0, block.from - open.from)).trim()
  if (before) return { text: before, line: block.openLine }
  let lineNo = block.openLine - 1
  while (lineNo >= 1 && !doc.line(lineNo).text.trim()) lineNo--
  if (lineNo < 1) return null
  let text = doc.line(lineNo).text.trim()
  let start = lineNo
  for (let up = 0; up < 6 && balance(text) < 0 && start > 1; up++) {
    start--
    text = doc.line(start).text.trim() + ' ' + text
  }
  return { text, line: start }
}

function balance(text: string): number {
  let depth = 0
  for (const ch of text) {
    if (ch === '(') depth++
    else if (ch === ')') depth--
  }
  return depth
}

/** Walks up over attributes, decorators and doc comments that belong to a declaration. */
function leadingStart(doc: Text, headerLine: number): number {
  let lineNo = headerLine
  while (lineNo > 1) {
    const prev = doc.line(lineNo - 1).text.trim()
    if (!/^(\[|#\[|@|\/\/\/|\/\*\*|\*)/.test(prev)) break
    lineNo--
  }
  return doc.line(lineNo).from
}

export function findSymbols(doc: Text, blocks: Block[]): CodeSymbol[] {
  const symbols: CodeSymbol[] = []
  const stack: { block: Block; symbol: CodeSymbol | null }[] = []
  for (const block of blocks) {
    while (stack.length && stack[stack.length - 1].block.to < block.from) stack.pop()
    const parent = [...stack].reverse().find((s) => s.symbol)?.symbol ?? null
    const header = headerFor(doc, block)
    const found = header ? classify(header.text, parent) : null
    let symbol: CodeSymbol | null = null
    if (header && found) {
      symbol = {
        ...found,
        header: header.text,
        headerLine: header.line,
        from: leadingStart(doc, header.line),
        to: block.to + 1,
        block,
        parent
      }
      symbols.push(symbol)
    }
    stack.push({ block, symbol })
  }
  return symbols
}

/** Symbols containing `pos`, outermost first. */
export function symbolsAt(symbols: CodeSymbol[], pos: number): CodeSymbol[] {
  return symbols.filter((s) => s.from <= pos && pos <= s.to)
}

/** The innermost method/function containing `pos`, or failing that the innermost type. */
export function symbolForActions(symbols: CodeSymbol[], pos: number): CodeSymbol | null {
  const chain = symbolsAt(symbols, pos).filter((s) => s.kind !== 'namespace' && s.kind !== 'property')
  return chain[chain.length - 1] ?? null
}
