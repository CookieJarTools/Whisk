import { Compartment, EditorState, type Extension } from '@codemirror/state'
import {
  EditorView,
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection
} from '@codemirror/view'
import {
  copyLineDown,
  copyLineUp,
  defaultKeymap,
  deleteLine,
  history,
  historyKeymap,
  indentWithTab,
  moveLineDown,
  moveLineUp,
  toggleComment
} from '@codemirror/commands'
import { bracketMatching, foldGutter, foldKeymap, indentOnInput, indentUnit } from '@codemirror/language'
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, startCompletion } from '@codemirror/autocomplete'
import { highlightSelectionMatches } from '@codemirror/search'
import { closeReferencePanel } from '@codemirror/lsp-client'
import { findBar } from './findBar'
import { dominantLineEnding, lineEnding } from './lineEnding'
import { countProblems, diagnosticsChanged, lintExtension } from '../lint/extension'
import { parameterInfo } from './signatureHelp'
import { shortcutLabel } from '../keymap/keymap'
import { languageFor, isMarkdown, type BraceFlavor } from '../lib/languages'
import { useSettings, type Settings } from '../store/settings'
import { useStore } from '../store/store'
import { editorTheme } from './theme'
import { braceFlavor, scopeField, symbolsAt, symbolForActions } from './scopes'
import { scopeRails } from './scopeRails'
import { codeLens, lensPath } from './codeLens'
import { blockFolding } from './folding'
import { stickyHeader } from './stickyHeader'
import { allViews, isDirty } from './views'
import { hasLanguageServer, rename } from './actions'
import { goToDeclarationOrUsages, showUsagesOf } from './usages'
import { lspCompartment } from '../lsp/servers'
import { toSymbolInfo } from './symbolInfo'
import { getSymbolActions, ide } from '../plugins/host'
import type { MenuItem } from '../store/store'

const MARKDOWN_SYNC_MS = 120

/** CodeMirror commands that are keymap actions (see keymap/actions.ts), so their built-in keys are dropped. */
const MANAGED = new Set<unknown>([toggleComment, deleteLine, moveLineUp, moveLineDown, copyLineDown, copyLineUp, startCompletion])
const EDITING_KEYMAP = defaultKeymap.filter((b) => !MANAGED.has(b.run))
const COMPLETION_KEYMAP = completionKeymap.filter((b) => !MANAGED.has(b.run))

/** Parts of each editor that follow user settings, swapped live when settings change. */
const prefsCompartment = new Compartment()
const viewPrefs = new WeakMap<EditorView, { braces: BraceFlavor; markdown: boolean }>()

function prefExtensions(settings: Settings, braces: BraceFlavor, markdown: boolean): Extension[] {
  return [
    settings.wordWrap || markdown ? EditorView.lineWrapping : [],
    settings.scopeRails && braces !== 'none' ? scopeRails : [],
    settings.codeLens ? codeLens : [],
    settings.stickyHeader && braces !== 'none' ? stickyHeader : []
  ]
}

function applyFontSize(size: number) {
  document.documentElement.style.setProperty('--editor-font-size', `${size}px`)
}

applyFontSize(useSettings.getState().editorFontSize)
useSettings.subscribe((settings, prev) => {
  if (settings.editorFontSize !== prev.editorFontSize) {
    applyFontSize(settings.editorFontSize)
    allViews().forEach((v) => v.requestMeasure())
  }
  if (settings.wordWrap === prev.wordWrap && settings.scopeRails === prev.scopeRails && settings.codeLens === prev.codeLens && settings.stickyHeader === prev.stickyHeader) return
  for (const view of allViews()) {
    const prefs = viewPrefs.get(view)
    if (prefs) view.dispatch({ effects: prefsCompartment.reconfigure(prefExtensions(settings, prefs.braces, prefs.markdown)) })
  }
})

function detectIndent(text: string): string {
  let tabs = 0
  let spaces = 0
  for (const line of text.split('\n', 2000)) {
    if (line.startsWith('\t')) tabs++
    else if (line.startsWith('  ')) spaces++
  }
  return tabs >= spaces && tabs > 0 ? '\t' : '    '
}

function contextMenu(view: EditorView, path: string, event: MouseEvent) {
  const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
  if (pos !== null && !view.state.selection.ranges.some((r) => r.from <= pos && pos <= r.to)) {
    view.dispatch({ selection: { anchor: pos } })
  }
  const lsp = hasLanguageServer(view)
  const items: MenuItem[] = [
    { label: 'Go to declaration or usages', hint: shortcutLabel('nav.definition'), onSelect: () => goToDeclarationOrUsages(view) },
    { label: 'Find usages', hint: shortcutLabel('nav.usages'), onSelect: () => showUsagesOf(view) },
    ...(lsp
      ? [
          { label: 'Rename symbol', hint: shortcutLabel('edit.rename'), onSelect: () => rename(view) }
        ]
      : [])
  ]
  const scope = view.state.field(scopeField, false)
  const symbol = scope && symbolForActions(scope.symbols, view.state.selection.main.head)
  if (symbol) {
    const actions = getSymbolActions().filter(
      (a) => !a.kinds || a.kinds.includes(symbol.kind)
    )
    if (actions.length) {
      items.push({ type: 'divider' }, { type: 'header', label: symbol.name })
      for (const action of actions) {
        items.push({
          label: action.title ?? action.label,
          onSelect: () => action.run(toSymbolInfo(view.state, path, symbol), ide)
        })
      }
    }
  }
  useStore.getState().openMenu(event.clientX, event.clientY, items)
}

export function createEditor(path: string, text: string, parent: HTMLElement): EditorView {
  const lang = languageFor(path)
  const languageCompartment = new Compartment()
  const markdown = isMarkdown(path)
  let mdTimer: number | undefined

  const extensions: Extension[] = [
    lineNumbers(),
    highlightActiveLineGutter(),
    foldGutter({ openText: '▾', closedText: '▸' }),
    blockFolding,
    highlightSpecialChars(),
    history(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    // Lines split on any ending, so every part of Whisk counts lines alike even
    // in files that mix them; the file's main ending is written back on save.
    lineEnding.of(dominantLineEnding(text)),
    EditorState.tabSize.of(4),
    indentUnit.of(detectIndent(text)),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    autocompletion({ activateOnTypingDelay: 80 }),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    // Shortcuts for actions (save, find, go to definition…) come from the keymap;
    // these are only the plain editing keys it doesn't manage.
    keymap.of([
      ...closeBracketsKeymap,
      ...EDITING_KEYMAP,
      ...historyKeymap,
      ...foldKeymap,
      ...COMPLETION_KEYMAP,
      { key: 'Escape', run: closeReferencePanel },
      indentWithTab
    ]),
    findBar,
    languageCompartment.of([]),
    lspCompartment.of([]),
    braceFlavor.of(lang.braces),
    scopeField,
    lensPath.of(path),
    lintExtension,
    parameterInfo,
    prefsCompartment.of(prefExtensions(useSettings.getState(), lang.braces, markdown)),
    editorTheme,
    EditorView.domEventHandlers({
      mousedown(event, view) {
        if (!(event.ctrlKey || event.metaKey) || event.button !== 0) return false
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
        if (pos === null) return false
        view.dispatch({ selection: { anchor: pos } })
        goToDeclarationOrUsages(view)
        event.preventDefault()
        return true
      },
      contextmenu(event, view) {
        event.preventDefault()
        contextMenu(view, path, event)
        return true
      },
      keydown(event, view) {
        view.dom.classList.toggle('cm-goto-hover', event.ctrlKey)
        return false
      },
      keyup(_event, view) {
        view.dom.classList.remove('cm-goto-hover')
        return false
      }
    }),
    EditorView.updateListener.of((update) => {
      const store = useStore.getState()
      if (diagnosticsChanged(update)) store.setProblems(path, countProblems(update.view))
      if (update.docChanged) {
        store.setDirty(path, isDirty(path, update.state.doc))
        if (markdown) {
          clearTimeout(mdTimer)
          mdTimer = window.setTimeout(
            () => useStore.getState().setMarkdownText(path, update.state.doc.toString()),
            MARKDOWN_SYNC_MS
          )
        }
      }
      if (update.docChanged || update.selectionSet || update.focusChanged) {
        const head = update.state.selection.main.head
        const line = update.state.doc.lineAt(head)
        const scope = update.state.field(scopeField, false)
        store.setCursor({
          line: line.number,
          col: head - line.from + 1,
          crumbs: scope ? symbolsAt(scope.symbols, head).map((s) => ({ name: s.name, depth: s.block.depth })) : []
        })
      }
    })
  ]

  const view = new EditorView({ state: EditorState.create({ doc: text, extensions }), parent })
  viewPrefs.set(view, { braces: lang.braces, markdown })
  lang.load().then((support) => view.dispatch({ effects: languageCompartment.reconfigure(support) }))
  return view
}
