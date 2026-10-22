import type { Extension } from '@codemirror/state'
import { LanguageDescription, StreamLanguage, type StreamParser } from '@codemirror/language'
import { languages as catalogue } from '@codemirror/language-data'
import { baseName, extension } from './paths'

/**
 * How the scope scanner finds blocks: braces with C-style quotes (`c`), braces
 * with JS-style quotes (`js`), indentation after a `:` line (`indent`, Python), or `none`.
 */
export type BraceFlavor = 'c' | 'js' | 'indent' | 'none'

export interface LanguageInfo {
  /** Display name for the status bar. */
  label: string
  /** LSP language id, also used to pick a server. */
  lspId: string
  /** Key into SERVERS in lsp/servers.ts, if this language has one. */
  server?: string
  braces: BraceFlavor
  /** Lane colour used for this file type's dot in the tree. */
  lane: number
  load: () => Promise<Extension>
}

const legacy = async (pick: () => Promise<Parameters<typeof StreamLanguage.define>[0]>) =>
  StreamLanguage.define(await pick())

/** C-family legacy modes, with names sorted into types, methods and members (see editor/richClike). */
const rich = async (pick: () => Promise<StreamParser<unknown>>) => {
  const [{ richClike }, base] = await Promise.all([import('../editor/richClike'), pick()])
  return StreamLanguage.define(richClike(base))
}

const LANGUAGES: Record<string, LanguageInfo> = {
  cs: {
    label: 'C#',
    lspId: 'csharp',
    server: 'csharp',
    braces: 'c',
    lane: 4,
    load: () => rich(async () => (await import('@codemirror/legacy-modes/mode/clike')).csharp as StreamParser<unknown>)
  },
  ts: {
    label: 'TypeScript',
    lspId: 'typescript',
    server: 'typescript',
    braces: 'js',
    lane: 1,
    load: async () => (await import('@codemirror/lang-javascript')).javascript({ typescript: true })
  },
  tsx: {
    label: 'TSX',
    lspId: 'typescriptreact',
    server: 'typescript',
    braces: 'js',
    lane: 1,
    load: async () => (await import('@codemirror/lang-javascript')).javascript({ typescript: true, jsx: true })
  },
  js: {
    label: 'JavaScript',
    lspId: 'javascript',
    server: 'typescript',
    braces: 'js',
    lane: 7,
    load: async () => (await import('@codemirror/lang-javascript')).javascript()
  },
  jsx: {
    label: 'JSX',
    lspId: 'javascriptreact',
    server: 'typescript',
    braces: 'js',
    lane: 7,
    load: async () => (await import('@codemirror/lang-javascript')).javascript({ jsx: true })
  },
  rs: {
    label: 'Rust',
    lspId: 'rust',
    server: 'rust',
    braces: 'c',
    lane: 10,
    load: async () => (await import('@codemirror/lang-rust')).rust()
  },
  py: {
    label: 'Python',
    lspId: 'python',
    server: 'python',
    braces: 'indent',
    lane: 7,
    load: async () => (await import('@codemirror/lang-python')).python()
  },
  java: {
    label: 'Java',
    lspId: 'java',
    braces: 'c',
    lane: 3,
    load: () => rich(async () => (await import('@codemirror/legacy-modes/mode/clike')).java as StreamParser<unknown>)
  },
  cpp: {
    label: 'C++',
    lspId: 'cpp',
    braces: 'c',
    lane: 0,
    load: () => rich(async () => (await import('@codemirror/legacy-modes/mode/clike')).cpp as StreamParser<unknown>)
  },
  shader: {
    label: 'Shader',
    lspId: 'hlsl',
    braces: 'c',
    lane: 6,
    load: () => rich(async () => (await import('@codemirror/legacy-modes/mode/clike')).shader as StreamParser<unknown>)
  },
  go: {
    label: 'Go',
    lspId: 'go',
    server: 'go',
    braces: 'c',
    lane: 6,
    load: () => rich(async () => (await import('@codemirror/legacy-modes/mode/go')).go as StreamParser<unknown>)
  },
  kt: {
    label: 'Kotlin',
    lspId: 'kotlin',
    braces: 'c',
    lane: 4,
    load: () => rich(async () => (await import('@codemirror/legacy-modes/mode/clike')).kotlin as StreamParser<unknown>)
  },
  swift: {
    label: 'Swift',
    lspId: 'swift',
    braces: 'c',
    lane: 10,
    load: () => rich(async () => (await import('@codemirror/legacy-modes/mode/swift')).swift as StreamParser<unknown>)
  },
  dart: {
    label: 'Dart',
    lspId: 'dart',
    braces: 'c',
    lane: 1,
    load: () => rich(async () => (await import('@codemirror/legacy-modes/mode/clike')).dart as StreamParser<unknown>)
  },
  scala: {
    label: 'Scala',
    lspId: 'scala',
    braces: 'c',
    lane: 5,
    load: () => rich(async () => (await import('@codemirror/legacy-modes/mode/clike')).scala as StreamParser<unknown>)
  },
  md: {
    label: 'Markdown',
    lspId: 'markdown',
    braces: 'none',
    lane: 11,
    load: async () => {
      const [{ markdown, markdownLanguage }, { languages }] = await Promise.all([
        import('@codemirror/lang-markdown'),
        import('@codemirror/language-data')
      ])
      return markdown({ base: markdownLanguage, codeLanguages: languages })
    }
  },
  json: {
    label: 'JSON',
    lspId: 'json',
    braces: 'js',
    lane: 7,
    load: async () => (await import('@codemirror/lang-json')).json()
  },
  css: {
    label: 'CSS',
    lspId: 'css',
    braces: 'js',
    lane: 5,
    load: async () => (await import('@codemirror/lang-css')).css()
  },
  html: {
    label: 'HTML',
    lspId: 'html',
    braces: 'none',
    lane: 10,
    load: async () => (await import('@codemirror/lang-html')).html()
  },
  xml: {
    label: 'XML',
    lspId: 'xml',
    braces: 'none',
    lane: 11,
    load: async () => (await import('@codemirror/lang-xml')).xml()
  },
  yaml: {
    label: 'YAML',
    lspId: 'yaml',
    braces: 'none',
    lane: 9,
    load: () => legacy(async () => (await import('@codemirror/legacy-modes/mode/yaml')).yaml)
  },
  toml: {
    label: 'TOML',
    lspId: 'toml',
    braces: 'none',
    lane: 9,
    load: () => legacy(async () => (await import('@codemirror/legacy-modes/mode/toml')).toml)
  },
  sh: {
    label: 'Shell',
    lspId: 'shellscript',
    braces: 'none',
    lane: 2,
    load: () => legacy(async () => (await import('@codemirror/legacy-modes/mode/shell')).shell)
  },
  ps1: {
    label: 'PowerShell',
    lspId: 'powershell',
    braces: 'js',
    lane: 1,
    load: () => legacy(async () => (await import('@codemirror/legacy-modes/mode/powershell')).powerShell)
  }
}

const ALIASES: Record<string, string> = {
  mts: 'ts',
  cts: 'ts',
  mjs: 'js',
  cjs: 'js',
  h: 'cpp',
  hpp: 'cpp',
  c: 'cpp',
  cc: 'cpp',
  hlsl: 'shader',
  glsl: 'shader',
  cginc: 'shader',
  compute: 'shader',
  markdown: 'md',
  csproj: 'xml',
  props: 'xml',
  targets: 'xml',
  xaml: 'xml',
  uxml: 'xml',
  svg: 'xml',
  sln: 'xml',
  htm: 'html',
  uss: 'css',
  yml: 'yaml',
  asmdef: 'json',
  bash: 'sh',
  kts: 'kt',
  sc: 'scala',
  pyw: 'py',
  pyi: 'py'
}

const PLAIN: LanguageInfo = {
  label: 'Plain text',
  lspId: 'plaintext',
  braces: 'none',
  lane: 11,
  load: async () => []
}

/** Extensions of catalogue languages that use braces for blocks, so they still get scope rails. */
const BRACE_EXTENSIONS = new Set(['php', 'groovy', 'gradle', 'zig', 'v', 'd', 'proto', 'hx', 'nut', 'sol', 'm', 'mm', 'cu'])

const fromCatalogue = new Map<string, LanguageInfo>()

/**
 * Anything not in the table above falls back to CodeMirror's language catalogue
 * (100+ languages, each grammar loaded only when a file needs it).
 */
function catalogueLanguage(path: string): LanguageInfo {
  const ext = extension(path)
  const cached = fromCatalogue.get(ext)
  if (cached) return cached
  const desc = LanguageDescription.matchFilename(catalogue, baseName(path))
  const info: LanguageInfo = desc
    ? {
        label: desc.name,
        lspId: desc.name.toLowerCase(),
        braces: BRACE_EXTENSIONS.has(ext) ? 'c' : 'none',
        lane: 11,
        load: () => desc.load()
      }
    : PLAIN
  fromCatalogue.set(ext, info)
  return info
}

export function languageFor(path: string): LanguageInfo {
  const ext = extension(path)
  return LANGUAGES[ALIASES[ext] ?? ext] ?? catalogueLanguage(path)
}

export function isMarkdown(path: string): boolean {
  return languageFor(path).lspId === 'markdown'
}

/** Source extensions searched when looking up where a type is declared. */
export const SOURCE_EXTENSIONS = ['cs', 'ts', 'tsx', 'js', 'jsx', 'java', 'rs', 'cpp', 'h', 'hpp', 'py', 'go', 'kt', 'swift', 'dart', 'scala']
