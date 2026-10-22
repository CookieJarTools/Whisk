import { Text } from '@codemirror/state'
import type { ContextItem, SymbolInfo } from './api'
import { scanBlocks, findSymbols, type CodeSymbol } from '../editor/scopes'
import { getView } from '../editor/views'
import { fenceFor } from '../editor/symbolInfo'
import { ipc } from '../lib/ipc'
import { languageFor, SOURCE_EXTENSIONS } from '../lib/languages'
import { relativePath, samePath } from '../lib/paths'
import { useStore } from '../store/store'

/** Types that are never worth looking up in the project. */
const SKIP_TYPES = new Set([
  'String', 'Int32', 'Int64', 'Boolean', 'Object', 'Task', 'List', 'Dictionary', 'HashSet', 'IEnumerable',
  'IEnumerator', 'Action', 'Func', 'Math', 'Mathf', 'Debug', 'Console', 'Exception', 'Array', 'Promise',
  'Map', 'Set', 'Error', 'JSON', 'Date', 'Number', 'Record', 'Partial', 'Vec', 'Option', 'Result', 'Some',
  'None', 'Ok', 'Err', 'Self', 'TODO', 'NOTE'
])
const MAX_TYPES = 8
/** Types longer than this are summarised as an outline instead of included whole. */
const FULL_TEXT_LINES = 60
const MAX_OUTLINE_LINES = 80

interface ParsedFile {
  doc: Text
  symbols: CodeSymbol[]
}

async function parseFile(path: string): Promise<ParsedFile> {
  const view = getView(path)
  const doc = view ? view.state.doc : Text.of((await ipc.readText(path)).split(/\r?\n/))
  const blocks = scanBlocks(doc.toString(), languageFor(path).braces)
  return { doc, symbols: findSymbols(doc, blocks) }
}

const isType = (s: CodeSymbol) => ['class', 'struct', 'interface', 'enum', 'record'].includes(s.kind)

/**
 * A type with its fields and member signatures but none of the bodies, e.g.
 *   class Player : MonoBehaviour
 *       [SerializeField] float speed;
 *       void Move(Vector3 dir) { … }
 */
export function outline(doc: Text, type: CodeSymbol, symbols: CodeSymbol[]): string {
  const children = symbols.filter((s) => s.parent === type)
  const childHeaders = new Map(children.map((c) => [c.headerLine, c]))
  const nested = symbols.filter((s) => s.block.from > type.block.from && s.block.to < type.block.to)
  const insideChild = (line: number) => nested.some((s) => line >= s.block.openLine && line <= s.block.closeLine)
  // Indentation blocks (Python) open on a colon and have no closing line.
  const indented = doc.sliceString(type.block.from, type.block.from + 1) === ':'
  const out: string[] = indented ? [doc.line(type.headerLine).text] : [type.header, '{']
  const lastLine = indented ? type.block.closeLine : type.block.closeLine - 1
  for (let n = type.block.openLine + 1; n <= lastLine && out.length < MAX_OUTLINE_LINES; n++) {
    const text = doc.line(n).text
    const trimmed = text.trim()
    const child = childHeaders.get(n)
    if (child) out.push(indented ? text.replace(/\s*$/, ' …') : text.replace(/\s*\{.*$/, '') + ' { … }')
    else if (!insideChild(n) && trimmed && trimmed !== '{' && trimmed !== '}') out.push(text)
  }
  if (!indented) out.push('}')
  return out.join('\n')
}

/** Capitalised identifiers in code, ignoring comments and string literals. */
function referencedTypeNames(text: string): string[] {
  const code = text
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
  const names = new Set<string>()
  for (const m of code.matchAll(/\b[A-Z][A-Za-z0-9_]*\b/g)) {
    if (!SKIP_TYPES.has(m[0]) && m[0].length > 1) names.add(m[0])
  }
  return [...names]
}

async function containingTypeOutline(symbol: SymbolInfo): Promise<ContextItem | null> {
  if (symbol.containers.length === 0) return null
  const parsed = await parseFile(symbol.path)
  const self = parsed.symbols.find((s) => s.name === symbol.name && parsed.doc.lineAt(s.from).number === symbol.startLine)
  let type = self?.parent ?? null
  while (type && !isType(type)) type = type.parent
  if (!type) return null
  return {
    title: `Members of ${type.name}`,
    source: `${symbol.relativePath}:${type.headerLine}`,
    fence: symbol.fence,
    text: outline(parsed.doc, type, parsed.symbols)
  }
}

async function typeDefinition(name: string, path: string, line: number): Promise<ContextItem | null> {
  const parsed = await parseFile(path)
  const type = parsed.symbols.find((s) => s.name === name && s.headerLine <= line && line <= s.block.openLine + 1)
  if (!type) return null
  const length = type.block.closeLine - type.headerLine
  const text = length <= FULL_TEXT_LINES ? parsed.doc.sliceString(type.from, type.to) : outline(parsed.doc, type, parsed.symbols)
  return {
    title: `${type.kind} ${name}${length > FULL_TEXT_LINES ? ' (outline)' : ''}`,
    source: `${relativePath(useStore.getState().root, path)}:${type.headerLine}`,
    fence: fenceFor(path),
    text
  }
}

export async function gatherContext(symbol: SymbolInfo): Promise<ContextItem[]> {
  const root = useStore.getState().root
  const items: ContextItem[] = []
  const container = await containingTypeOutline(symbol)
  if (container) items.push(container)
  if (!root) return items

  const skip = new Set([symbol.name, ...symbol.containers])
  const names = referencedTypeNames(symbol.text).filter((n) => !skip.has(n)).slice(0, 40)
  if (names.length === 0) return items
  const found = await ipc.findTypeDefinitions(root, names, SOURCE_EXTENSIONS)

  const firstByName = new Map<string, (typeof found)[number]>()
  for (const loc of found) {
    const prev = firstByName.get(loc.name)
    const sameDir = (p: string) => samePath(p.replace(/[\\/][^\\/]*$/, ''), symbol.path.replace(/[\\/][^\\/]*$/, ''))
    if (!prev || (sameDir(loc.path) && !sameDir(prev.path))) firstByName.set(loc.name, loc)
  }
  const picks = [...firstByName.values()].slice(0, MAX_TYPES)
  const defs = await Promise.all(picks.map((loc) => typeDefinition(loc.name, loc.path, loc.line).catch(() => null)))
  for (const def of defs) if (def) items.push(def)
  return items
}
