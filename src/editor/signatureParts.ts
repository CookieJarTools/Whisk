/**
 * Splits a language server's signature into parts that can be coloured and
 * read quickly: return type, owner, name, each parameter's type, name and
 * default. Pure functions, so they're tested without an editor.
 */

export interface ParamInfo {
  label: string | [number, number]
  documentation?: string | { kind: string; value: string }
}

export interface SignatureInfo {
  label: string
  documentation?: string | { kind: string; value: string }
  parameters?: ParamInfo[]
  activeParameter?: number
}

export type PartKind = 'keyword' | 'type' | 'owner' | 'name' | 'param' | 'default' | 'punct' | 'text'

export interface Part {
  text: string
  kind: PartKind
  /** Index of the parameter this part belongs to, if any. */
  param?: number
}

const MODIFIERS = new Set([
  'public', 'private', 'protected', 'internal', 'static', 'async', 'virtual', 'override', 'abstract', 'sealed',
  'extern', 'unsafe', 'new', 'readonly', 'const', 'final', 'export', 'function', 'def', 'fn', 'func', 'fun',
  'ref', 'out', 'in', 'params', 'this', 'mut', 'let', 'var'
])

/** Where each parameter sits in the label, as [from, to]. */
export function parameterRanges(sig: SignatureInfo): [number, number][] {
  const out: [number, number][] = []
  let searchFrom = Math.max(0, sig.label.indexOf('('))
  for (const p of sig.parameters ?? []) {
    if (Array.isArray(p.label)) {
      out.push(p.label)
      continue
    }
    const at = sig.label.indexOf(p.label, searchFrom)
    if (at < 0) continue
    out.push([at, at + p.label.length])
    searchFrom = at + p.label.length
  }
  return out
}

/** Words become `kind` (modifiers become keywords); spaces and symbols stay plain. */
function wordParts(text: string, kind: PartKind, param?: number): Part[] {
  const tokens = text.match(/[A-Za-z_$][\w$]*|\s+|[^\sA-Za-z_$]+/g) ?? []
  return tokens.map((t) => {
    if (!/^[A-Za-z_$]/.test(t)) return { text: t, kind: /^\s+$/.test(t) ? 'text' : 'punct', param }
    return { text: t, kind: MODIFIERS.has(t) ? 'keyword' : kind, param }
  })
}

/** `Vector3 b`, `b: Vector3`, `ref int x = 0`, `params int[] values` → coloured parts. */
export function paramParts(text: string, index: number): Part[] {
  const eq = topLevelIndex(text, '=')
  const main = eq >= 0 ? text.slice(0, eq) : text
  const fallback = eq >= 0 ? text.slice(eq) : ''
  const parts: Part[] = []
  const colon = topLevelIndex(main, ':')
  if (colon >= 0) {
    // Name first: TypeScript, Python, Rust, Kotlin, Swift.
    parts.push(...wordParts(main.slice(0, colon), 'param', index))
    parts.push({ text: ':', kind: 'punct', param: index })
    parts.push(...wordParts(main.slice(colon + 1), 'type', index))
  } else {
    // Type first: C#, Java, C, C++. The last word is the name.
    const trimmed = main.replace(/\s+$/, '')
    const nameMatch = /([A-Za-z_$][\w$]*)$/.exec(trimmed)
    const hasType = nameMatch && trimmed.slice(0, nameMatch.index).trim() !== ''
    if (nameMatch && hasType) {
      parts.push(...wordParts(trimmed.slice(0, nameMatch.index), 'type', index))
      parts.push({ text: nameMatch[1], kind: 'param', param: index })
      parts.push({ text: main.slice(trimmed.length), kind: 'text', param: index })
    } else {
      parts.push(...wordParts(main, 'param', index))
    }
  }
  if (fallback) parts.push({ text: fallback, kind: 'default', param: index })
  return parts.filter((p) => p.text)
}

/** Return type, owner and name before the bracket; the return type after it for `): number` styles. */
function headParts(text: string): Part[] {
  const trimmed = text.replace(/\s+$/, '')
  const name = /([A-Za-z_$][\w$]*)(\s*<[^<>]*>)?$/.exec(trimmed)
  if (!name) return [{ text, kind: 'text' }]
  const before = trimmed.slice(0, name.index)
  const owner = /([A-Za-z_$][\w$.]*\.)$/.exec(before)
  const lead = owner ? before.slice(0, owner.index) : before
  const parts: Part[] = wordParts(lead, 'type')
  if (owner) parts.push({ text: owner[1], kind: 'owner' })
  parts.push({ text: name[1], kind: 'name' })
  if (name[2]) parts.push({ text: name[2], kind: 'type' })
  return parts
}

export function signatureParts(sig: SignatureInfo): Part[] {
  const ranges = parameterRanges(sig)
  const open = sig.label.indexOf('(')
  if (open < 0) return [{ text: sig.label, kind: 'text' }]
  const parts: Part[] = [...headParts(sig.label.slice(0, open)), { text: '(', kind: 'punct' }]
  let at = open + 1
  ranges.forEach(([from, to], i) => {
    if (from > at) parts.push({ text: sig.label.slice(at, from), kind: 'punct' })
    parts.push(...paramParts(sig.label.slice(from, to), i))
    at = to
  })
  const rest = sig.label.slice(at)
  const close = rest.indexOf(')')
  if (close < 0) {
    parts.push({ text: rest, kind: 'punct' })
    return parts
  }
  parts.push({ text: rest.slice(0, close + 1), kind: 'punct' })
  const after = rest.slice(close + 1)
  const ret = /^(\s*(?::|->|=>)\s*)(.*)$/.exec(after)
  if (ret) {
    parts.push({ text: ret[1], kind: 'punct' })
    parts.push(...wordParts(ret[2], 'type'))
  } else if (after) {
    parts.push({ text: after, kind: 'text' })
  }
  return parts
}

function topLevelIndex(text: string, ch: string): number {
  let depth = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if ('(<[{'.includes(c)) depth++
    else if (')>]}'.includes(c)) depth--
    else if (c === ch && depth === 0) return i
  }
  return -1
}

export interface ParsedDocs {
  summary: string
  params: Record<string, string>
  returns: string
}

export function docText(doc: SignatureInfo['documentation']): string {
  if (!doc) return ''
  return typeof doc === 'string' ? doc : doc.value
}

function plain(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/(^|\s)[*_]([^*_]+)[*_]/g, '$1$2')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Splits doc text into a summary, per-parameter notes and the return value.
 * Understands the `Parameters:` / `Returns:` layout csharp-ls uses, and
 * `@param` / `@returns` tags from JSDoc-style servers.
 */
export function parseDocs(text: string): ParsedDocs {
  const params: Record<string, string> = {}
  let returns = ''
  const summaryLines: string[] = []
  let section: 'summary' | 'params' | 'returns' | 'other' = 'summary'
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    const heading = /^(#+\s*)?\**\s*(parameters|params|arguments|returns?|exceptions?|remarks|example)\s*\**\s*:?\s*\**$/i.exec(line)
    if (heading) {
      const word = heading[2].toLowerCase()
      section = word.startsWith('param') || word === 'arguments' ? 'params' : word.startsWith('return') ? 'returns' : 'other'
      continue
    }
    const tag = /^@(param|arg)\s+(?:\{[^}]*\}\s*)?(\w+)\s*-?\s*(.*)$/.exec(line)
    if (tag) {
      params[tag[2]] = plain(tag[3])
      continue
    }
    const ret = /^@returns?\s+(?:\{[^}]*\}\s*)?(.*)$/.exec(line)
    if (ret) {
      returns = plain(ret[1])
      continue
    }
    if (section === 'params') {
      const m = /^[-*]?\s*`?([\w$]+)`?\s*(?::|—|–|-)\s*(.+)$/.exec(line)
      if (m) params[m[1]] = plain(m[2])
    } else if (section === 'returns') {
      if (line) returns = returns ? `${returns} ${plain(line)}` : plain(line)
    } else if (section === 'summary') {
      summaryLines.push(raw)
    }
  }
  return { summary: plain(summaryLines.join('\n')), params, returns }
}

/** The name a parameter is known by in docs: `b` from `Vector3 b` or `b: Vector3`. */
export function paramName(label: string): string {
  const main = label.split('=')[0]
  const colon = topLevelIndex(main, ':')
  if (colon >= 0) return main.slice(0, colon).replace(/[^\w$]/g, '')
  return /([A-Za-z_$][\w$]*)\s*$/.exec(main.trim())?.[1] ?? main.trim()
}

/**
 * Which argument the cursor is in, from the text between the call's `(` and
 * the cursor: top-level commas, skipping nested brackets and strings.
 * Returns -1 once the call's closing bracket has been passed.
 */
export function argumentIndex(text: string): number {
  let depth = 0
  let index = 0
  let quote = ''
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quote) {
      if (ch === '\\') i++
      else if (ch === quote) quote = ''
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch
    else if (ch === '(' || ch === '[' || ch === '{') depth++
    else if (ch === ')' || ch === ']' || ch === '}') {
      if (depth === 0) return -1
      depth--
    } else if (ch === ',' && depth === 0) index++
  }
  return index
}

/**
 * The `(` of the call the cursor is inside, searching back from `pos` over
 * nested brackets, or -1. `text` is the document up to the cursor.
 */
export function openingBracket(text: string, limit = 2000): number {
  let depth = 0
  for (let i = text.length - 1; i >= Math.max(0, text.length - limit); i--) {
    const ch = text[i]
    if (ch === ')' || ch === ']' || ch === '}') depth++
    else if (ch === '(' || ch === '[' || ch === '{') {
      if (depth === 0) return ch === '(' ? i : -1
      depth--
    } else if (ch === ';' && depth === 0) {
      // The end of the previous statement: no call is open here.
      return -1
    }
  }
  return -1
}
