import { DOUBLE_SHIFT, normalizeShortcut } from './keys'

export type PresetId = 'whisk' | 'rider' | 'vscode' | 'visualstudio'

export interface Preset {
  id: PresetId
  label: string
  description: string
  bindings: Record<string, string[]>
}

/**
 * Rider's defaults (its IntelliJ-style Windows keymap), which the Whisk preset
 * builds on. Search Everywhere is on double Shift in every preset.
 */
const RIDER: Record<string, string[]> = {
  'app.settings': ['Ctrl+Alt+S'],
  'app.actions': ['Ctrl+Shift+A'],
  'view.compact': ['Ctrl+Alt+C'],
  'view.explorer': ['Alt+1'],
  'view.titlebar': ['Ctrl+Alt+T'],
  'view.splitRight': [],
  'view.otherPane': [],
  'search.everywhere': [DOUBLE_SHIFT, 'Ctrl+T'],
  'search.text': ['Ctrl+Shift+F'],
  'search.find': ['Ctrl+F'],
  'search.replace': ['Ctrl+R'],
  'search.next': ['F3'],
  'search.previous': ['Shift+F3'],
  'nav.file': ['Ctrl+Shift+N'],
  'nav.type': ['Ctrl+N'],
  'nav.symbol': ['Ctrl+Alt+Shift+N'],
  'nav.structure': ['Ctrl+F12'],
  'nav.line': ['Ctrl+G'],
  'nav.recent': ['Ctrl+E'],
  'nav.back': ['Ctrl+Alt+Left', 'Ctrl+-'],
  'nav.forward': ['Ctrl+Alt+Right', 'Ctrl+Shift+-'],
  'nav.definition': ['F12', 'Ctrl+B'],
  'nav.usages': ['Shift+F12', 'Alt+F7'],
  'problems.next': ['F8'],
  'problems.previous': ['Shift+F8'],
  'problems.list': ['Alt+6'],
  'edit.save': ['Ctrl+S'],
  'edit.closeTab': ['Ctrl+F4'],
  'edit.rename': ['F2', 'Shift+F6'],
  'edit.suggest': ['Ctrl+Space'],
  'edit.paramInfo': ['Ctrl+P'],
  'edit.quickFix': ['Alt+Enter'],
  'edit.format': ['Ctrl+Alt+L'],
  'edit.comment': ['Ctrl+/'],
  'edit.duplicateLine': ['Ctrl+D'],
  'edit.deleteLine': ['Ctrl+Y'],
  'edit.moveLineUp': ['Ctrl+Shift+Up', 'Alt+Shift+Up'],
  'edit.moveLineDown': ['Ctrl+Shift+Down', 'Alt+Shift+Down'],
  'edit.selectNext': ['Alt+J'],
  // Rider has no default keys for font size.
  'editor.fontUp': [],
  'editor.fontDown': []
}

const SCOPE: Record<string, string[]> = {
  ...RIDER,
  // Zen browser's layout keys, and the familiar Ctrl+, / Ctrl+P / Ctrl+W.
  'app.settings': ['Ctrl+,'],
  'app.actions': ['Ctrl+Shift+A', 'Ctrl+Shift+P'],
  'view.explorer': ['Ctrl+Alt+S', 'Alt+1'],
  'nav.file': ['Ctrl+P', 'Ctrl+Shift+N'],
  'nav.back': ['Ctrl+Alt+Left', 'Alt+Left'],
  'nav.forward': ['Ctrl+Alt+Right', 'Alt+Right'],
  'edit.closeTab': ['Ctrl+W', 'Ctrl+F4'],
  'edit.paramInfo': ['Ctrl+Shift+Space'],
  'view.splitRight': ['Ctrl+\\'],
  'editor.fontUp': ['Ctrl+='],
  'editor.fontDown': ['Ctrl+Shift+-']
}

const VSCODE: Record<string, string[]> = {
  'app.settings': ['Ctrl+,'],
  'app.actions': ['Ctrl+Shift+P', 'F1'],
  'view.compact': ['Ctrl+Alt+C'],
  'view.explorer': ['Ctrl+B'],
  'view.titlebar': ['Ctrl+Alt+T'],
  'view.splitRight': ['Ctrl+\\'],
  'search.everywhere': [DOUBLE_SHIFT, 'Ctrl+T'],
  'search.text': ['Ctrl+Shift+F'],
  'search.find': ['Ctrl+F'],
  'search.replace': ['Ctrl+H'],
  'search.next': ['F3'],
  'search.previous': ['Shift+F3'],
  'nav.file': ['Ctrl+P'],
  'nav.type': [],
  'nav.symbol': [],
  'nav.structure': ['Ctrl+Shift+O'],
  'nav.line': ['Ctrl+G'],
  'nav.recent': ['Ctrl+E'],
  'nav.back': ['Alt+Left'],
  'nav.forward': ['Alt+Right'],
  'nav.definition': ['F12'],
  'nav.usages': ['Shift+F12'],
  'problems.next': ['F8'],
  'problems.previous': ['Shift+F8'],
  'problems.list': ['Ctrl+Shift+M'],
  'edit.save': ['Ctrl+S'],
  'edit.closeTab': ['Ctrl+W'],
  'edit.rename': ['F2'],
  'edit.suggest': ['Ctrl+Space'],
  'edit.paramInfo': ['Ctrl+Shift+Space'],
  'edit.quickFix': ['Ctrl+.'],
  'edit.format': ['Shift+Alt+F'],
  'edit.comment': ['Ctrl+/'],
  'edit.duplicateLine': ['Shift+Alt+Down'],
  'edit.deleteLine': ['Ctrl+Shift+K'],
  'edit.moveLineUp': ['Alt+Up'],
  'edit.moveLineDown': ['Alt+Down'],
  'edit.selectNext': ['Ctrl+D'],
  'editor.fontUp': ['Ctrl+='],
  'editor.fontDown': ['Ctrl+-']
}

const VISUAL_STUDIO: Record<string, string[]> = {
  'app.settings': ['Ctrl+,'],
  'app.actions': ['Ctrl+Q'],
  'view.compact': ['Ctrl+Alt+C'],
  'view.explorer': ['Ctrl+Alt+L'],
  'view.titlebar': ['Ctrl+Alt+T'],
  'search.everywhere': [DOUBLE_SHIFT, 'Ctrl+T'],
  'search.text': ['Ctrl+Shift+F'],
  'search.find': ['Ctrl+F'],
  'search.replace': ['Ctrl+H'],
  'search.next': ['F3'],
  'search.previous': ['Shift+F3'],
  'nav.file': ['Ctrl+Shift+T'],
  'nav.type': ['Ctrl+1'],
  'nav.symbol': ['Ctrl+Shift+Alt+T'],
  'nav.structure': ['Alt+\\'],
  'nav.line': ['Ctrl+G'],
  'nav.recent': ['Ctrl+Tab'],
  'nav.back': ['Ctrl+-'],
  'nav.forward': ['Ctrl+Shift+-'],
  'nav.definition': ['F12'],
  'nav.usages': ['Shift+F12'],
  'problems.next': ['F8'],
  'problems.previous': ['Shift+F8'],
  'edit.save': ['Ctrl+S'],
  'edit.closeTab': ['Ctrl+F4'],
  'edit.rename': ['F2'],
  'edit.suggest': ['Ctrl+Space', 'Ctrl+J'],
  'edit.paramInfo': ['Ctrl+Shift+Space'],
  'edit.quickFix': ['Ctrl+.', 'Alt+Enter'],
  'edit.format': ['Ctrl+Alt+F'],
  'edit.comment': ['Ctrl+/'],
  'edit.duplicateLine': ['Ctrl+D'],
  'edit.deleteLine': ['Ctrl+Shift+L'],
  'edit.moveLineUp': ['Alt+Up'],
  'edit.moveLineDown': ['Alt+Down'],
  'edit.selectNext': ['Shift+Alt+.'],
  'editor.fontUp': ['Ctrl+Shift+.'],
  'editor.fontDown': ['Ctrl+Shift+,']
}

/** Bindings above are written as people say them; store them in canonical form so they match key presses. */
function canonical(bindings: Record<string, string[]>): Record<string, string[]> {
  return Object.fromEntries(Object.entries(bindings).map(([id, keys]) => [id, keys.map(normalizeShortcut)]))
}

export const PRESETS: Record<PresetId, Preset> = {
  whisk: {
    id: 'whisk',
    label: 'Whisk',
    description: 'Rider keys with Zen-style layout toggles, plus Ctrl+P and Ctrl+,',
    bindings: canonical(SCOPE)
  },
  rider: { id: 'rider', label: 'Rider', description: 'JetBrains Rider defaults', bindings: canonical(RIDER) },
  vscode: { id: 'vscode', label: 'VS Code', description: 'Visual Studio Code defaults', bindings: canonical(VSCODE) },
  visualstudio: { id: 'visualstudio', label: 'Visual Studio', description: 'Visual Studio defaults', bindings: canonical(VISUAL_STUDIO) }
}

export const PRESET_ORDER: PresetId[] = ['whisk', 'rider', 'vscode', 'visualstudio']
