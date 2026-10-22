import type { StreamParser, StringStream } from '@codemirror/language'

/**
 * The legacy C-family modes only tag keywords, strings, numbers and comments;
 * every other name comes back as a plain `variable`. This wraps such a mode and
 * sorts those names into types, methods, members, attributes and constants by
 * looking at the token before and the text after, the way an editor without a
 * compiler has to. A language server can refine this later with semantic tokens.
 */

interface RichState {
  inner: unknown
  /** Text of the previous non-space token. */
  prev: string
  /** Inside `[Attribute(...)]` at the start of a line, and how deep. */
  attrDepth: number
  /** Inside a `using X.Y;` / `namespace X.Y` / `package` / `import` path. */
  inPath: boolean
}

const PATH_STARTERS = new Set(['namespace', 'using', 'package', 'import'])

const CONTROL = new Set([
  'if', 'else', 'return', 'for', 'foreach', 'while', 'do', 'switch', 'case', 'default', 'break',
  'continue', 'goto', 'throw', 'try', 'catch', 'finally', 'yield', 'await', 'using', 'lock', 'new',
  'in', 'is', 'as', 'when', 'checked', 'unchecked', 'fixed'
])
const SELF = new Set(['this', 'base', 'super'])
const TYPE_DECLARERS = new Set(['class', 'struct', 'interface', 'enum', 'record', 'delegate'])
/** Tokens after which a capitalised name is a type: `new Foo`, `: Base`, `<T>`, `typeof(Foo)`. */
const TYPE_CONTEXT = new Set(['new', ':', 'is', 'as', '<', 'typeof', 'nameof', 'sizeof', 'default', 'where', 'extends', 'implements', 'throws'])

const CALL_AHEAD = /^\s*(?:<[^<>()]*(?:<[^<>()]*>[^<>()]*)*>)?\s*\(/
/** `Foo bar`, `Foo<T> bar`, `Foo[] bar`, `Foo? bar`: a type followed by a name. */
const DECLARATION_AHEAD = /^(?:\s*<[^<>;()]*(?:<[^<>;()]*>[^<>;()]*)*>)?(?:\s*\[\s*,*\s*\])*\??\s+@?[A-Za-z_]/
const GENERIC_ARG_AHEAD = /^\s*[,>]/

function classifyName(stream: StringStream, state: RichState, text: string, kind: string | null): string {
  if (state.attrDepth > 0) return 'meta'
  if (state.prev === '.') return stream.match(CALL_AHEAD, false) ? 'propertyName.function' : 'propertyName'
  if (stream.match(CALL_AHEAD, false)) return 'variableName.function'
  if (TYPE_DECLARERS.has(state.prev)) return 'typeName.definition'
  if (/^[A-Z][A-Z0-9_]+$/.test(text)) return 'variableName.constant'
  const capital = /^[A-Z]/.test(text)
  if (capital) {
    if (TYPE_CONTEXT.has(state.prev)) return 'typeName'
    if (stream.match(DECLARATION_AHEAD, false)) return 'typeName'
    if (stream.match(/^\s*\./, false)) return 'typeName'
    if (state.prev === ',' && stream.match(GENERIC_ARG_AHEAD, false)) return 'typeName'
    return 'propertyName'
  }
  return kind === 'def' ? 'variableName.definition' : 'variableName'
}

function trackAttribute(stream: StringStream, state: RichState, text: string) {
  if (text === '[' && (state.attrDepth > 0 || stream.string.slice(0, stream.start).trim() === '')) state.attrDepth++
  else if (text === ']' && state.attrDepth > 0) state.attrDepth--
}

/** What StreamLanguage does for modes without their own `copyState`: a shallow copy, arrays cloned. */
function defaultCopyState(state: unknown): unknown {
  if (typeof state !== 'object' || state === null) return state
  const copy: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(state)) copy[key] = Array.isArray(value) ? value.slice() : value
  return copy
}

export function richClike(base: StreamParser<unknown>): StreamParser<RichState> {
  const copyInner = base.copyState ? base.copyState.bind(base) : defaultCopyState
  return {
    name: base.name,
    startState: (indentUnit) => ({
      inner: base.startState ? base.startState(indentUnit) : {},
      prev: '',
      attrDepth: 0,
      inPath: false
    }),
    copyState: (s) => ({ inner: copyInner(s.inner), prev: s.prev, attrDepth: s.attrDepth, inPath: s.inPath }),
    blankLine: base.blankLine ? (s, indentUnit) => base.blankLine!(s.inner, indentUnit) : undefined,
    indent: base.indent ? (s, textAfter, cx) => base.indent!(s.inner, textAfter, cx) : undefined,
    languageData: base.languageData,
    tokenTable: base.tokenTable,
    token(stream, state) {
      // Attributes and using/namespace paths end with their line.
      if (stream.sol()) {
        state.attrDepth = 0
        state.inPath = false
      }
      const kind = base.token(stream, state.inner)
      const text = stream.current()
      if (!text.trim()) return kind
      let style = kind
      if (state.inPath && (kind === 'variable' || kind === 'def' || kind === 'type')) {
        style = 'namespace'
      } else if (kind === 'variable' || kind === 'def') {
        // `$"…"` and `@"…"`: the prefix belongs to the string.
        if ((text === '$' || text === '@') && stream.peek() === '"') style = 'string'
        else style = classifyName(stream, state, text, kind)
      } else if (kind === 'keyword') {
        if (SELF.has(text)) style = 'self'
        else if (CONTROL.has(text)) style = 'controlKeyword'
      } else if (kind === 'type' && /^[a-z]/.test(text)) {
        // Built-in types (`int`, `float`, `string`) read as keywords.
        style = 'keyword'
      } else if (kind === null) {
        trackAttribute(stream, state, text)
      }
      // `using (var x = …)` and `using var x` are statements, not namespace imports.
      if (kind === 'keyword' && PATH_STARTERS.has(text) && !stream.match(/^\s*(\(|var\b|static\b)/, false)) state.inPath = true
      else if (text === ';' || text === '{' || text === '=') state.inPath = false
      state.prev = text
      return style
    }
  }
}
