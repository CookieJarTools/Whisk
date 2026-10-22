/**
 * The plugin API. A plugin is a module whose default export is an `IdePlugin`.
 * Built-in plugins live in src/plugins; user plugins are loaded from
 * `~/.whisk/plugins/<name>/plugin.js` at startup.
 */

import type { SymbolKind } from '../editor/scopes'

export type { SymbolKind }

export interface SymbolInfo {
  name: string
  kind: SymbolKind
  /** Absolute path of the file it's in. */
  path: string
  /** Path relative to the open folder. */
  relativePath: string
  /** Display name of the language, e.g. `C#`. */
  language: string
  /** Fence tag for Markdown code blocks, e.g. `csharp`. */
  fence: string
  /** 1-based, inclusive. */
  startLine: number
  endLine: number
  /** Full source of the declaration, attributes and doc comments included. */
  text: string
  header: string
  /** Chain of enclosing declarations, outermost first, e.g. `['Game', 'Player']`. */
  containers: string[]
}

export interface ContextItem {
  title: string
  /** Where it came from, e.g. `Scripts/Player.cs:12`. */
  source: string
  fence: string
  text: string
}

export interface SymbolAction {
  id: string
  /** Short label shown in the lens row above declarations. */
  label: string
  /** Longer label for menus; defaults to `label`. */
  title?: string
  /** Which kinds of declaration get this action. Defaults to methods, functions and types. */
  kinds?: SymbolKind[]
  run(symbol: SymbolInfo, ide: IdeApi): void | Promise<void>
}

export interface CommandDef {
  id: string
  title: string
  /** Default shortcuts, e.g. ['Ctrl+Alt+A']. Users can rebind them in Settings › Keymap. */
  keys?: string[]
  run(ide: IdeApi): void | Promise<void>
}

export interface IdeApi {
  workspace: {
    root(): string | null
    readFile(path: string): Promise<string>
    /** Where the named types are declared (uses a text search over source files). */
    findTypes(names: string[]): Promise<{ name: string; path: string; line: number }[]>
  }
  editor: {
    activePath(): string | null
    selectedText(): string
    /** The declaration around the cursor in the active editor. */
    symbolAtCursor(): SymbolInfo | null
  }
  context: {
    /** Related code for a declaration: members of its containing type and the types it uses. */
    forSymbol(symbol: SymbolInfo): Promise<ContextItem[]>
  }
  ui: {
    toast(message: string, kind?: 'info' | 'success' | 'error'): void
    copy(text: string): Promise<void>
  }
  shell: {
    openUrl(url: string): Promise<void>
    which(program: string): Promise<string | null>
    /** Opens a terminal window in `cwd` running `args`. */
    runInTerminal(cwd: string, args: string[]): Promise<void>
    /** Writes a scratch file to the temp folder and returns its path. */
    writeTemp(name: string, content: string): Promise<string>
  }
  settings: {
    get<T>(key: string, fallback: T): T
    set<T>(key: string, value: T): void
  }
}

export interface PluginContext extends IdeApi {
  registerSymbolAction(action: SymbolAction): void
  registerCommand(command: CommandDef): void
}

export interface IdePlugin {
  id: string
  name: string
  activate(ctx: PluginContext): void | Promise<void>
}
