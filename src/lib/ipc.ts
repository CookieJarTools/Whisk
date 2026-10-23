import { invoke } from '@tauri-apps/api/core'

export interface DirEntry {
  name: string
  path: string
  is_dir: boolean
}

export interface TypeLocation {
  name: string
  path: string
  line: number
}

export interface SearchOptions {
  root: string
  query: string
  caseSensitive: boolean
  wholeWord: boolean
  regex: boolean
  fileMask: string
  includeHidden: boolean
  maxResults: number
}

export interface SearchMatch {
  path: string
  /** 1-based. */
  line: number
  /** UTF-16 column of the match within the line. */
  col: number
  len: number
  text: string
}

export interface SearchResult {
  matches: SearchMatch[]
  filesWithMatches: number
  truncated: boolean
}

export interface IndexedSymbol {
  name: string
  kind: 'type' | 'function'
  detail: string
  path: string
  line: number
}

export interface Release {
  tag: string
  version: string
  name: string
  publishedAt: string
  prerelease: boolean
  notes: string
  url: string
  installable: boolean
}

export interface UpdateInfo {
  version: string
  currentVersion: string
  notes: string | null
  date: string | null
}

/** Typed wrappers over the Rust commands in src-tauri/src. */
export const ipc = {
  listDir: (path: string) => invoke<DirEntry[]>('list_dir', { path }),
  readText: (path: string) => invoke<string>('read_text', { path }),
  writeText: (path: string, content: string) => invoke<void>('write_text', { path, content }),
  createDir: (path: string) => invoke<void>('create_dir', { path }),
  pathState: (path: string) => invoke<'missing' | 'empty' | 'used'>('path_state', { path }),
  listFiles: (root: string) => invoke<string[]>('list_files', { root }),
  findTypeDefinitions: (root: string, names: string[], extensions: string[]) =>
    invoke<TypeLocation[]>('find_type_definitions', { root, names, extensions }),

  lspStart: (command: string, args: string[], root: string) => invoke<number>('lsp_start', { command, args, root }),
  lspSend: (id: number, message: string) => invoke<void>('lsp_send', { id, message }),
  lspStop: (id: number) => invoke<void>('lsp_stop', { id }),

  which: (program: string) => invoke<string | null>('which_program', { program }),
  openExternal: (url: string) => invoke<void>('open_external', { url }),
  openPath: (path: string) => invoke<void>('open_path', { path }),
  openInTerminal: (cwd: string, args: string[]) => invoke<void>('open_in_terminal', { cwd, args }),
  writeTemp: (name: string, content: string) => invoke<string>('write_temp', { name, content }),
  pluginsDir: () => invoke<string>('plugins_dir'),
  appendLog: (line: string) => invoke<void>('append_log', { line }),
  copyText: (text: string) => invoke<void>('copy_text', { text }),
  pasteText: () => invoke<string>('paste_text'),
  runCommand: (id: number, commandLine: string, cwd?: string) => invoke<void>('run_command', { id, commandLine, cwd: cwd ?? null }),
  refreshPath: () => invoke<void>('refresh_path'),
  searchProject: (options: SearchOptions) => invoke<SearchResult>('search_project', { options }),
  indexSymbols: (root: string) => invoke<IndexedSymbol[]>('index_symbols', { root }),
  listReleases: () => invoke<Release[]>('list_releases'),
  checkUpdate: (tag?: string) => invoke<UpdateInfo | null>('check_update', { tag: tag ?? null }),
  downloadUpdate: () => invoke<void>('download_update'),
  installUpdate: () => invoke<void>('install_update'),
  startupArgs: () => invoke<{ folder: string | null; files: string[] }>('startup_args')
}
