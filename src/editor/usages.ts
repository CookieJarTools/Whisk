import type { EditorView } from '@codemirror/view'
import { LSPPlugin } from '@codemirror/lsp-client'
import { ipc } from '../lib/ipc'
import { SOURCE_EXTENSIONS } from '../lib/languages'
import { extension, normalizeUri, uriToPath } from '../lib/paths'
import { useStore } from '../store/store'
import { showUsagesPopup, type Usage } from '../components/UsagesPopup'
import { lensPath } from './codeLens'
import { jumpTo } from './navigation'
import { scopeField } from './scopes'
import { getView } from './views'

/**
 * Rider's "go to declaration or usages": on a usage, jump to where it's
 * declared; on the declaration itself, list where it's used. With a language
 * server this uses real definitions and references; without one, it falls back
 * to declarations found in the file or project and a whole-word text search.
 */

interface Position {
  line: number
  character: number
}
interface Range {
  start: Position
  end: Position
}
interface Location {
  uri: string
  range: Range
}
type DefinitionResult = Location | Location[] | { targetUri: string; targetRange: Range; targetSelectionRange?: Range }[] | null

const MAX_USAGES = 500

export function toLocations(result: DefinitionResult): Location[] {
  if (!result) return []
  const list = Array.isArray(result) ? result : [result]
  return list.map((r) => ('targetUri' in r ? { uri: r.targetUri, range: r.targetSelectionRange ?? r.targetRange } : r))
}

export function contains(range: Range, pos: Position): boolean {
  const afterStart = pos.line > range.start.line || (pos.line === range.start.line && pos.character >= range.start.character)
  const beforeEnd = pos.line < range.end.line || (pos.line === range.end.line && pos.character <= range.end.character)
  return afterStart && beforeEnd
}

/** The text of each 1-based line wanted, per file; open editors win over the disk. */
async function lineTexts(wanted: Map<string, Set<number>>): Promise<Map<string, Map<number, string>>> {
  const out = new Map<string, Map<number, string>>()
  await Promise.all(
    [...wanted].map(async ([path, lines]) => {
      const view = getView(path)
      const fileLines = view ? null : (await ipc.readText(path).catch(() => '')).split(/\r?\n/)
      const texts = new Map<number, string>()
      for (const n of lines) {
        if (view) texts.set(n, n <= view.state.doc.lines ? view.state.doc.line(n).text : '')
        else texts.set(n, fileLines![n - 1] ?? '')
      }
      out.set(path, texts)
    })
  )
  return out
}

/** Fills in each usage's line of code. */
async function withText(items: Usage[]): Promise<Usage[]> {
  const wanted = new Map<string, Set<number>>()
  for (const { path, line } of items) {
    if (!wanted.has(path)) wanted.set(path, new Set())
    wanted.get(path)!.add(line)
  }
  const texts = await lineTexts(wanted)
  return items.map((item) => ({ ...item, text: texts.get(item.path)?.get(item.line) ?? '' }))
}

function locationsToUsages(locations: Location[]): Promise<Usage[]> {
  return withText(
    locations.slice(0, MAX_USAGES).map((l) => ({
      path: uriToPath(l.uri),
      line: l.range.start.line + 1,
      col: l.range.start.character,
      len: l.range.end.line === l.range.start.line ? l.range.end.character - l.range.start.character : 0,
      text: ''
    }))
  )
}

function linesToUsages(hits: { path: string; line: number }[]): Promise<Usage[]> {
  return withText(hits.map((h) => ({ path: h.path, line: h.line, col: 0, len: 0, text: '' })))
}

function wordAtCursor(view: EditorView): { name: string; from: number } | null {
  const word = view.state.wordAt(view.state.selection.main.head)
  return word ? { name: view.state.sliceDoc(word.from, word.to), from: word.from } : null
}

function anchor(view: EditorView, pos: number) {
  const coords = view.coordsAtPos(pos)
  return coords ? { x: coords.left, y: coords.bottom + 4 } : { x: 200, y: 200 }
}

async function showOrJump(view: EditorView, title: string, items: Usage[], from: number, approximate: boolean) {
  if (items.length === 0) {
    useStore.getState().toast(`${title}: none found`)
    return
  }
  if (items.length === 1) {
    const only = items[0]
    await jumpTo(only.path, only.line, only.col, only.len)
    return
  }
  showUsagesPopup({ ...anchor(view, from), title, items, approximate, returnFocus: () => view.focus() })
}

// ---- With a language server ----

async function lspDefinitions(view: EditorView): Promise<{ locations: Location[]; onDeclaration: boolean } | null> {
  const plugin = LSPPlugin.get(view)
  if (!plugin) return null
  plugin.client.sync()
  const position = plugin.toPosition(view.state.selection.main.head)
  const result = await plugin.client.request<object, DefinitionResult>('textDocument/definition', {
    textDocument: { uri: plugin.uri },
    position
  })
  const locations = toLocations(result)
  const self = normalizeUri(plugin.uri)
  const onDeclaration = locations.some((l) => normalizeUri(l.uri) === self && contains(l.range, position))
  return { locations, onDeclaration }
}

async function lspUsages(view: EditorView): Promise<Usage[]> {
  const plugin = LSPPlugin.get(view)!
  plugin.client.sync()
  const result = await plugin.client.request<object, Location[] | null>('textDocument/references', {
    textDocument: { uri: plugin.uri },
    position: plugin.toPosition(view.state.selection.main.head),
    context: { includeDeclaration: false }
  })
  return locationsToUsages(result ?? [])
}

// ---- Without one ----

/** Is the cursor on the name in a declaration this file knows about? */
function onLocalDeclaration(view: EditorView, name: string): boolean {
  const line = view.state.doc.lineAt(view.state.selection.main.head).number
  return !!view.state.field(scopeField, false)?.symbols.some((s) => s.name === name && s.headerLine === line)
}

async function textUsages(view: EditorView, name: string): Promise<Usage[]> {
  const root = useStore.getState().root
  if (!root) return []
  const path = view.state.facet(lensPath)
  const ext = extension(path)
  const result = await ipc.searchProject({
    root,
    query: name,
    caseSensitive: true,
    wholeWord: true,
    regex: false,
    fileMask: ext ? `*.${ext}` : '',
    includeHidden: false,
    maxResults: MAX_USAGES
  })
  const here = view.state.doc.lineAt(view.state.selection.main.head).number
  return result.matches.filter((m) => !(m.path === path && m.line === here))
}

/** Ctrl+Click / F12: the declaration from a usage, or the usages from a declaration. */
export async function goToDeclarationOrUsages(view: EditorView): Promise<void> {
  const word = wordAtCursor(view)
  if (!word) return
  const lsp = await lspDefinitions(view).catch(() => null)
  if (lsp) {
    if (lsp.onDeclaration) return showUsagesOf(view)
    if (lsp.locations.length === 0) {
      useStore.getState().toast(`No declaration found for ${word.name}`)
      return
    }
    const items = await locationsToUsages(lsp.locations)
    return showOrJump(view, `Declarations of ${word.name}`, items, word.from, false)
  }

  if (onLocalDeclaration(view, word.name)) return showUsagesOf(view)
  const local = view.state.field(scopeField, false)?.symbols.find((s) => s.name === word.name)
  const path = view.state.facet(lensPath)
  if (local) return jumpTo(path, local.headerLine)
  const root = useStore.getState().root
  const hits = root ? await ipc.findTypeDefinitions(root, [word.name], SOURCE_EXTENSIONS) : []
  const here = view.state.doc.lineAt(view.state.selection.main.head).number
  if (hits.some((h) => h.path === path && h.line === here)) return showUsagesOf(view)
  if (hits.length === 0) {
    useStore.getState().toast(`No declaration found for ${word.name}`)
    return
  }
  return showOrJump(view, `Declarations of ${word.name}`, await linesToUsages(hits), word.from, true)
}

/** Shift+F12, or Ctrl+Click on a declaration: where the symbol under the cursor is used. */
export async function showUsagesOf(view: EditorView): Promise<void> {
  const word = wordAtCursor(view)
  if (!word) return
  const withServer = !!LSPPlugin.get(view)
  const items = withServer ? await lspUsages(view).catch(() => null) : null
  if (items) return showOrJump(view, `Usages of ${word.name}`, items, word.from, false)
  const found = await textUsages(view, word.name)
  return showOrJump(view, `Usages of ${word.name}`, found, word.from, true)
}
