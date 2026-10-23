import type { EditorView } from '@codemirror/view'
import { copyLineDown, deleteLine, moveLineDown, moveLineUp, toggleComment } from '@codemirror/commands'
import { findNext, findPrevious, selectNextOccurrence } from '@codemirror/search'
import { startCompletion } from '@codemirror/autocomplete'
import { nextDiagnostic, openLintPanel, previousDiagnostic } from '@codemirror/lint'
import { formatDocument } from '@codemirror/lsp-client'
import { useStore } from '../store/store'
import { useSettings, FONT_SIZES } from '../store/settings'
import { getView } from '../editor/views'
import { hasLanguageServer, rename, saveFile } from '../editor/actions'
import { goToDeclarationOrUsages, showUsagesOf } from '../editor/usages'
import { goBack, goForward } from '../editor/navigation'
import { openFind } from '../editor/findBar'
import { showParameterInfo } from '../editor/signatureHelp'
import { showQuickFixes } from '../lsp/codeActions'
import { pickFolder } from '../components/Welcome'
import { compareWithClipboard, compareWithFile } from '../editor/compare'
import { gotoChange, showFileDiff } from '../git/gutter'
import { toggleBlame } from '../git/blame'
import { pull, push, useGit } from '../git/store'

/** Something a shortcut can trigger. Plugin commands become actions too (see keymap.ts). */
export interface Action {
  id: string
  title: string
  category: string
  /** Only runs (and only claims its keys) when an editor is focused-or-active. */
  editor?: boolean
  run(): void
}

const activeView = (): EditorView | null => getView(useStore.getState().active)

/** Runs a CodeMirror command on the active editor. */
const onEditor = (command: (view: EditorView) => boolean) => () => {
  const view = activeView()
  if (view) command(view)
}

const settings = () => useSettings.getState()
const store = () => useStore.getState()

export const BUILT_IN_ACTIONS: Action[] = [
  // Layout
  { id: 'view.compact', title: 'Toggle compact mode', category: 'Layout', run: () => settings().toggleCompact() },
  { id: 'view.explorer', title: 'Show / hide explorer', category: 'Layout', run: () => settings().set({ hideExplorer: !settings().hideExplorer }) },
  { id: 'view.titlebar', title: 'Show / hide title bar', category: 'Layout', run: () => settings().set({ hideTitleBar: !settings().hideTitleBar }) },
  {
    id: 'view.splitRight',
    title: 'Move tab to the other side (split)',
    category: 'Layout',
    run: () => {
      const { active, tabs, moveToPane } = store()
      const tab = tabs.find((t) => t.path === active)
      if (tab) moveToPane(tab.path, tab.pane === 1 ? 0 : 1)
    }
  },
  { id: 'view.otherPane', title: 'Switch to the other side', category: 'Layout', run: () => store().focusPane(store().focusedPane === 1 ? 0 : 1) },
  { id: 'diff.clipboard', title: 'Compare with clipboard', category: 'Editing', run: () => void compareWithClipboard() },
  { id: 'diff.file', title: 'Compare with file…', category: 'Editing', run: () => void compareWithFile() },
  { id: 'git.commit', title: 'Commit…', category: 'Git', run: () => store().setSideView(store().sideView === 'commit' ? 'files' : 'commit') },
  { id: 'git.push', title: 'Push', category: 'Git', run: () => void push() },
  { id: 'git.pull', title: 'Pull', category: 'Git', run: () => void pull() },
  { id: 'git.blame', title: 'Annotate with git blame', category: 'Git', editor: true, run: onEditor((v) => (void toggleBlame(v), true)) },
  { id: 'git.diff', title: 'Show changes in this file', category: 'Git', editor: true, run: onEditor((v) => (useGit.getState().repo ? (showFileDiff(v), true) : false)) },
  { id: 'git.nextChange', title: 'Next change', category: 'Git', editor: true, run: onEditor((v) => gotoChange(v, 1)) },
  { id: 'git.previousChange', title: 'Previous change', category: 'Git', editor: true, run: onEditor((v) => gotoChange(v, -1)) },
  { id: 'app.settings', title: 'Settings', category: 'General', run: () => store().setSettingsOpen(true) },
  { id: 'app.actions', title: 'Find action', category: 'General', run: () => store().openPalette('actions') },
  { id: 'app.openFolder', title: 'Open folder…', category: 'General', run: pickFolder },
  { id: 'app.newProject', title: 'New project…', category: 'General', run: () => store().setWizardOpen(true) },
  { id: 'explorer.hidden', title: 'Show / hide hidden files', category: 'Layout', run: () => store().setShowHidden(!store().showHidden) },
  { id: 'explorer.refresh', title: 'Refresh explorer', category: 'Layout', run: () => store().refreshTree() },

  // Search
  { id: 'search.everywhere', title: 'Search everywhere', category: 'Search', run: () => store().openPalette('all') },
  { id: 'search.text', title: 'Find in files', category: 'Search', run: () => store().openPalette('text', selectedWord()) },
  { id: 'search.find', title: 'Find in file', category: 'Search', editor: true, run: onEditor((v) => openFind(v, false)) },
  { id: 'search.replace', title: 'Replace in file', category: 'Search', editor: true, run: onEditor((v) => openFind(v, true)) },
  { id: 'search.next', title: 'Find next', category: 'Search', editor: true, run: onEditor(findNext) },
  { id: 'search.previous', title: 'Find previous', category: 'Search', editor: true, run: onEditor(findPrevious) },

  // Navigation
  { id: 'nav.file', title: 'Go to file', category: 'Navigation', run: () => store().openPalette('files') },
  { id: 'nav.type', title: 'Go to type', category: 'Navigation', run: () => store().openPalette('types') },
  { id: 'nav.symbol', title: 'Go to symbol', category: 'Navigation', run: () => store().openPalette('symbols') },
  { id: 'nav.structure', title: 'File structure', category: 'Navigation', editor: true, run: () => store().openPalette('structure') },
  { id: 'nav.line', title: 'Go to line', category: 'Navigation', editor: true, run: () => store().openPalette('line') },
  { id: 'nav.recent', title: 'Recent files', category: 'Navigation', run: () => store().openPalette('recent') },
  { id: 'nav.back', title: 'Back', category: 'Navigation', run: () => void goBack() },
  { id: 'nav.forward', title: 'Forward', category: 'Navigation', run: () => void goForward() },
  {
    id: 'nav.definition',
    title: 'Go to declaration or usages',
    category: 'Navigation',
    editor: true,
    run: onEditor((v) => (void goToDeclarationOrUsages(v), true))
  },
  { id: 'problems.next', title: 'Next problem', category: 'Navigation', editor: true, run: onEditor(nextDiagnostic) },
  { id: 'problems.previous', title: 'Previous problem', category: 'Navigation', editor: true, run: onEditor(previousDiagnostic) },
  { id: 'problems.list', title: 'List problems in this file', category: 'Navigation', editor: true, run: onEditor(openLintPanel) },
  { id: 'nav.usages', title: 'Find usages', category: 'Navigation', editor: true, run: onEditor((v) => (void showUsagesOf(v), true)) },

  // Editing
  { id: 'edit.save', title: 'Save', category: 'Editing', run: () => { const p = store().active; if (p) void saveFile(p, { format: true }) } },
  {
    id: 'edit.closeTab',
    title: 'Close tab',
    category: 'Editing',
    run: () => {
      const { active, dirty, closeTab } = store()
      if (active && (!dirty[active] || window.confirm(`${active} has unsaved changes. Close it anyway?`))) closeTab(active)
    }
  },
  { id: 'edit.rename', title: 'Rename symbol', category: 'Editing', editor: true, run: onEditor((v) => rename(v) || false) },
  { id: 'edit.suggest', title: 'Show suggestions', category: 'Editing', editor: true, run: onEditor(startCompletion) },
  { id: 'edit.quickFix', title: 'Quick fixes and refactorings', category: 'Editing', editor: true, run: onEditor(showQuickFixes) },
  { id: 'edit.paramInfo', title: 'Parameter info', category: 'Editing', editor: true, run: onEditor(showParameterInfo) },
  {
    id: 'edit.format',
    title: 'Reformat file',
    category: 'Editing',
    editor: true,
    run: onEditor((v) => (hasLanguageServer(v) ? formatDocument(v) : (store().toast('Reformatting needs a language server for this file.'), false)))
  },
  { id: 'edit.comment', title: 'Comment / uncomment line', category: 'Editing', editor: true, run: onEditor(toggleComment) },
  { id: 'edit.duplicateLine', title: 'Duplicate line', category: 'Editing', editor: true, run: onEditor(copyLineDown) },
  { id: 'edit.deleteLine', title: 'Delete line', category: 'Editing', editor: true, run: onEditor(deleteLine) },
  { id: 'edit.moveLineUp', title: 'Move line up', category: 'Editing', editor: true, run: onEditor(moveLineUp) },
  { id: 'edit.moveLineDown', title: 'Move line down', category: 'Editing', editor: true, run: onEditor(moveLineDown) },
  { id: 'edit.selectNext', title: 'Add next occurrence to selection', category: 'Editing', editor: true, run: onEditor(selectNextOccurrence) },
  {
    id: 'editor.fontUp',
    title: 'Bigger font',
    category: 'Editing',
    run: () => settings().set({ editorFontSize: Math.min(FONT_SIZES.max, settings().editorFontSize + FONT_SIZES.step) })
  },
  {
    id: 'editor.fontDown',
    title: 'Smaller font',
    category: 'Editing',
    run: () => settings().set({ editorFontSize: Math.max(FONT_SIZES.min, settings().editorFontSize - FONT_SIZES.step) })
  }
]

/** The word under the cursor or the selected text, to seed a search. */
function selectedWord(): string {
  const view = activeView()
  if (!view) return ''
  const { from, to, head } = view.state.selection.main
  if (from !== to) {
    const text = view.state.sliceDoc(from, to)
    return text.includes('\n') ? '' : text
  }
  const word = view.state.wordAt(head)
  return word ? view.state.sliceDoc(word.from, word.to) : ''
}
