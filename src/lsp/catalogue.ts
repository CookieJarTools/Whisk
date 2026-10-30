import { isWindows } from '../lib/platform'

/**
 * Language servers Whisk knows about. Each says which files it serves, how to
 * install it with a one-line command, and what that command needs first (npm,
 * dotnet, go…). Servers without a reliable one-liner link to their install page.
 * Users can add their own in Settings › Language servers (`CustomServer`).
 */

export interface Prerequisite {
  /** Program that must be on PATH to run the install command. */
  program: string
  label: string
  url: string
}

export interface ServerDef {
  key: string
  label: string
  /** What it's for, shown in Settings. */
  languages: string
  command: string
  args: string[]
  /** File extensions it serves, without the dot. */
  extensions: string[]
  /** Exact file names it serves, e.g. `Dockerfile`. */
  fileNames?: string[]
  /** LSP language id to send, when it differs from the editor's. */
  languageId?: string
  install?: string
  needs?: Prerequisite
  homepage: string
  custom?: boolean
}

export interface CustomServer {
  key: string
  label: string
  command: string
  args: string[]
  extensions: string[]
  install?: string
}

const NODE: Prerequisite = { program: 'npm', label: 'Node.js', url: 'https://nodejs.org/en/download' }
const DOTNET: Prerequisite = { program: 'dotnet', label: '.NET SDK', url: 'https://dotnet.microsoft.com/download' }
const GO: Prerequisite = { program: 'go', label: 'Go', url: 'https://go.dev/dl/' }
const RUSTUP: Prerequisite = { program: 'rustup', label: 'Rust (rustup)', url: 'https://rustup.rs' }
const WINGET: Prerequisite = { program: 'winget', label: 'winget (App Installer)', url: 'https://aka.ms/getwinget' }
const RUBY: Prerequisite = { program: 'gem', label: 'Ruby', url: isWindows ? 'https://rubyinstaller.org' : 'https://www.ruby-lang.org/en/documentation/installation/' }
const DART: Prerequisite = { program: 'dart', label: 'Dart SDK', url: 'https://dart.dev/get-dart' }

/**
 * A global npm install. On Linux the global folder usually belongs to root, so it
 * goes in ~/.local instead, which Whisk searches for tools.
 */
const npmGlobal = (packages: string) => (isWindows ? `npm install --global ${packages}` : `npm install --global --prefix "$HOME/.local" ${packages}`)

/** A winget install. Only Windows has winget; elsewhere the server's homepage says how to get it. */
const winget = (id: string): Pick<ServerDef, 'install' | 'needs'> =>
  isWindows ? { install: `winget install --exact --id ${id} --accept-source-agreements --accept-package-agreements`, needs: WINGET } : {}

export const BUILT_IN_SERVERS: ServerDef[] = [
  {
    key: 'csharp',
    label: 'csharp-ls',
    languages: 'C#',
    command: 'csharp-ls',
    args: [],
    extensions: ['cs'],
    install: 'dotnet tool install --global csharp-ls',
    needs: DOTNET,
    homepage: 'https://github.com/razzmatazz/csharp-language-server'
  },
  {
    key: 'typescript',
    label: 'TypeScript',
    languages: 'TypeScript, JavaScript, TSX, JSX',
    command: 'typescript-language-server',
    args: ['--stdio'],
    extensions: ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts'],
    install: npmGlobal('typescript-language-server typescript'),
    needs: NODE,
    homepage: 'https://github.com/typescript-language-server/typescript-language-server'
  },
  {
    key: 'rust',
    label: 'rust-analyzer',
    languages: 'Rust',
    command: 'rust-analyzer',
    args: [],
    extensions: ['rs'],
    install: 'rustup component add rust-analyzer',
    needs: RUSTUP,
    homepage: 'https://rust-analyzer.github.io'
  },
  {
    key: 'python',
    label: 'Pyright',
    languages: 'Python',
    command: 'pyright-langserver',
    args: ['--stdio'],
    extensions: ['py', 'pyi', 'pyw'],
    install: npmGlobal('pyright'),
    needs: NODE,
    homepage: 'https://github.com/microsoft/pyright'
  },
  {
    key: 'go',
    label: 'gopls',
    languages: 'Go',
    command: 'gopls',
    args: [],
    extensions: ['go'],
    install: 'go install golang.org/x/tools/gopls@latest',
    needs: GO,
    homepage: 'https://pkg.go.dev/golang.org/x/tools/gopls'
  },
  {
    key: 'clangd',
    label: 'clangd',
    languages: 'C, C++',
    command: 'clangd',
    args: [],
    extensions: ['c', 'cc', 'cpp', 'cxx', 'h', 'hh', 'hpp'],
    ...winget('LLVM.LLVM'),
    homepage: 'https://clangd.llvm.org/installation'
  },
  {
    key: 'lua',
    label: 'LuaLS',
    languages: 'Lua',
    command: 'lua-language-server',
    args: [],
    extensions: ['lua'],
    ...winget('LuaLS.lua-language-server'),
    homepage: 'https://luals.github.io/#install'
  },
  {
    key: 'bash',
    label: 'Bash',
    languages: 'Shell scripts',
    command: 'bash-language-server',
    args: ['start'],
    extensions: ['sh', 'bash'],
    languageId: 'shellscript',
    install: npmGlobal('bash-language-server'),
    needs: NODE,
    homepage: 'https://github.com/bash-lsp/bash-language-server'
  },
  {
    key: 'yaml',
    label: 'YAML',
    languages: 'YAML',
    command: 'yaml-language-server',
    args: ['--stdio'],
    extensions: ['yaml', 'yml'],
    install: npmGlobal('yaml-language-server'),
    needs: NODE,
    homepage: 'https://github.com/redhat-developer/yaml-language-server'
  },
  {
    key: 'json',
    label: 'JSON',
    languages: 'JSON',
    command: 'vscode-json-language-server',
    args: ['--stdio'],
    extensions: ['json', 'jsonc', 'asmdef'],
    languageId: 'json',
    install: npmGlobal('vscode-langservers-extracted'),
    needs: NODE,
    homepage: 'https://github.com/hrsh7th/vscode-langservers-extracted'
  },
  {
    key: 'css',
    label: 'CSS',
    languages: 'CSS, SCSS, Less',
    command: 'vscode-css-language-server',
    args: ['--stdio'],
    extensions: ['css', 'scss', 'less'],
    install: npmGlobal('vscode-langservers-extracted'),
    needs: NODE,
    homepage: 'https://github.com/hrsh7th/vscode-langservers-extracted'
  },
  {
    key: 'html',
    label: 'HTML',
    languages: 'HTML',
    command: 'vscode-html-language-server',
    args: ['--stdio'],
    extensions: ['html', 'htm'],
    languageId: 'html',
    install: npmGlobal('vscode-langservers-extracted'),
    needs: NODE,
    homepage: 'https://github.com/hrsh7th/vscode-langservers-extracted'
  },
  {
    key: 'toml',
    label: 'Taplo',
    languages: 'TOML',
    command: 'taplo',
    args: ['lsp', 'stdio'],
    extensions: ['toml'],
    languageId: 'toml',
    install: npmGlobal('@taplo/cli'),
    needs: NODE,
    homepage: 'https://taplo.tamasfe.dev'
  },
  {
    key: 'php',
    label: 'Intelephense',
    languages: 'PHP',
    command: 'intelephense',
    args: ['--stdio'],
    extensions: ['php'],
    languageId: 'php',
    install: npmGlobal('intelephense'),
    needs: NODE,
    homepage: 'https://intelephense.com'
  },
  {
    key: 'ruby',
    label: 'Ruby LSP',
    languages: 'Ruby',
    command: 'ruby-lsp',
    args: [],
    extensions: ['rb'],
    languageId: 'ruby',
    // Linux's gem folder belongs to root; a user install goes in ~/.local/share/gem, which Whisk searches.
    install: isWindows ? 'gem install ruby-lsp' : 'gem install --user-install ruby-lsp',
    needs: RUBY,
    homepage: 'https://shopify.github.io/ruby-lsp/'
  },
  {
    key: 'svelte',
    label: 'Svelte',
    languages: 'Svelte',
    command: 'svelteserver',
    args: ['--stdio'],
    extensions: ['svelte'],
    languageId: 'svelte',
    install: npmGlobal('svelte-language-server'),
    needs: NODE,
    homepage: 'https://github.com/sveltejs/language-tools'
  },
  {
    key: 'docker',
    label: 'Dockerfile',
    languages: 'Dockerfiles',
    command: 'docker-langserver',
    args: ['--stdio'],
    extensions: ['dockerfile'],
    fileNames: ['Dockerfile', 'Containerfile'],
    languageId: 'dockerfile',
    install: npmGlobal('dockerfile-language-server-nodejs'),
    needs: NODE,
    homepage: 'https://github.com/rcjsuen/dockerfile-language-server'
  },
  {
    key: 'dart',
    label: 'Dart',
    languages: 'Dart, Flutter',
    command: 'dart',
    args: ['language-server', '--protocol=lsp'],
    extensions: ['dart'],
    languageId: 'dart',
    needs: DART,
    homepage: 'https://dart.dev/get-dart'
  },
  {
    key: 'java',
    label: 'Eclipse JDT LS',
    languages: 'Java',
    command: 'jdtls',
    args: [],
    extensions: ['java'],
    homepage: 'https://github.com/eclipse-jdtls/eclipse.jdt.ls#installation'
  },
  {
    key: 'kotlin',
    label: 'Kotlin LSP',
    languages: 'Kotlin',
    command: 'kotlin-language-server',
    args: [],
    extensions: ['kt', 'kts'],
    languageId: 'kotlin',
    homepage: 'https://github.com/fwcd/kotlin-language-server'
  },
  {
    key: 'zig',
    label: 'ZLS',
    languages: 'Zig',
    command: 'zls',
    args: [],
    extensions: ['zig'],
    languageId: 'zig',
    homepage: 'https://zigtools.org/zls/install/'
  },
  {
    key: 'markdown',
    label: 'Marksman',
    languages: 'Markdown',
    command: 'marksman',
    args: ['server'],
    extensions: ['md', 'markdown'],
    languageId: 'markdown',
    homepage: 'https://github.com/artempyanykh/marksman#how-to-install'
  }
]

/** Where to look for servers that aren't listed. */
export const SERVER_DIRECTORIES = [
  { label: 'Official LSP server list', url: 'https://microsoft.github.io/language-server-protocol/implementors/servers/' },
  { label: 'langserver.org', url: 'https://langserver.org' }
]
