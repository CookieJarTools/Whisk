import { baseName } from '../lib/paths'

/**
 * Run configurations: what ▶ runs. Whisk finds the usual ones in a project
 * (.NET apps, npm scripts, Cargo, Go, Python), and any in `.whisk/run.json`
 * are added, so a team can share them.
 */

export type DebugType = 'coreclr' | 'python' | 'node' | 'lldb' | 'go'

export interface RunConfig {
  id: string
  name: string
  /** The command line, run through the shell in `cwd`. Empty for debug-only ones (attaching to Unity). */
  command: string
  /** Folder to run in, relative to the project (the project itself when unset). */
  cwd?: string
  env?: Record<string, string>
  /** How the debugger starts it, when it can: a built-in type or a custom debugger's id (see src/debug). */
  debug?: { type: DebugType | (string & {}); project?: string; program?: string; args?: string[] }
  source: 'detected' | 'project'
}

export const PROJECT_RUN_FILE = '.whisk/run.json'

type Read = (relativePath: string) => Promise<string | null>

const quote = (s: string) => (/\s/.test(s) ? `"${s}"` : s)

/** Folder part of a relative path, or undefined for the project root. */
function dirOf(rel: string): string | undefined {
  const i = rel.lastIndexOf('/')
  return i > 0 ? rel.slice(0, i) : undefined
}

/** True for a .csproj that builds something you can run (not a library, test or Unity project). */
export function isRunnableCsproj(xml: string): boolean {
  if (/Microsoft\.NET\.Test\.Sdk|<IsTestProject>\s*true/i.test(xml)) return false
  if (/UnityEngine|UnityEditor/.test(xml)) return false
  return /<OutputType>\s*(Win)?Exe\s*<\/OutputType>/i.test(xml) || /Sdk="Microsoft\.NET\.Sdk\.(Web|Worker|BlazorWebAssembly)"/i.test(xml)
}

export function isTestCsproj(xml: string): boolean {
  return /Microsoft\.NET\.Test\.Sdk|<IsTestProject>\s*true/i.test(xml)
}

function packageRunner(files: Set<string>, dir?: string): string {
  const at = (name: string) => (dir ? `${dir}/${name}` : name)
  if (files.has(at('pnpm-lock.yaml'))) return 'pnpm'
  if (files.has(at('yarn.lock'))) return 'yarn'
  if (files.has(at('bun.lockb')) || files.has(at('bun.lock'))) return 'bun'
  return 'npm'
}

/** Scripts worth offering first; the rest follow in file order. */
const FIRST_SCRIPTS = ['dev', 'start', 'serve', 'build', 'test']

/**
 * Finds run configurations from the project's files. `files` are paths relative
 * to the project with forward slashes; `read` returns a file's text.
 */
export async function detectConfigs(files: string[], read: Read): Promise<RunConfig[]> {
  const set = new Set(files)
  const configs: RunConfig[] = []
  // A Unity project is debugged by attaching to the editor that has it open; there's nothing to run.
  if (set.has('ProjectSettings/ProjectVersion.txt')) {
    configs.push({ id: 'unity:editor', name: 'Unity Editor', command: '', debug: { type: 'unity' }, source: 'detected' })
  }
  const shallow = (rel: string, depth: number) => rel.split('/').length <= depth + 1 && !rel.includes('node_modules/')

  for (const rel of files.filter((f) => f.endsWith('.csproj') && shallow(f, 4))) {
    const xml = await read(rel)
    if (!xml || !isRunnableCsproj(xml)) continue
    const name = baseName(rel).replace(/\.csproj$/, '')
    configs.push({
      id: `dotnet:${rel}`,
      name,
      command: `dotnet run --project ${quote(rel)}`,
      debug: { type: 'coreclr', project: rel },
      source: 'detected'
    })
  }

  for (const rel of files.filter((f) => baseName(f) === 'package.json' && shallow(f, 2))) {
    const text = await read(rel)
    if (!text) continue
    let scripts: Record<string, string> = {}
    try {
      scripts = JSON.parse(text).scripts ?? {}
    } catch {
      continue
    }
    const dir = dirOf(rel)
    const runner = packageRunner(set, dir)
    const names = Object.keys(scripts).sort((a, b) => {
      const ia = FIRST_SCRIPTS.indexOf(a)
      const ib = FIRST_SCRIPTS.indexOf(b)
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
    })
    for (const script of names) {
      configs.push({
        id: `npm:${rel}:${script}`,
        name: dir ? `${runner}: ${script} (${dir})` : `${runner}: ${script}`,
        command: `${runner} run ${script}`,
        cwd: dir,
        source: 'detected'
      })
    }
  }

  if (set.has('Cargo.toml')) {
    configs.push({ id: 'cargo:run', name: 'cargo run', command: 'cargo run', debug: { type: 'lldb' }, source: 'detected' })
  }
  if (set.has('go.mod')) {
    configs.push({ id: 'go:run', name: 'go run .', command: 'go run .', debug: { type: 'go', program: '.' }, source: 'detected' })
  }
  if (set.has('manage.py')) {
    configs.push({ id: 'python:django', name: 'Django server', command: 'python manage.py runserver', debug: { type: 'python', program: 'manage.py', args: ['runserver', '--noreload'] }, source: 'detected' })
  }
  for (const entry of ['main.py', 'app.py']) {
    if (set.has(entry)) configs.push({ id: `python:${entry}`, name: `python ${entry}`, command: `python ${entry}`, debug: { type: 'python', program: entry }, source: 'detected' })
  }
  return configs
}

/** Reads `.whisk/run.json`. Bad entries are skipped rather than failing the lot. */
export function parseProjectConfigs(text: string): RunConfig[] {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return []
  }
  const list = (data as { configurations?: unknown[] })?.configurations
  if (!Array.isArray(list)) return []
  return list.flatMap((c: any, i) =>
    c && typeof c.name === 'string' && typeof c.command === 'string'
      ? [{ id: `project:${i}:${c.name}`, name: c.name, command: c.command, cwd: c.cwd, env: c.env, debug: c.debug, source: 'project' as const }]
      : []
  )
}

export function serializeProjectConfigs(configs: RunConfig[]): string {
  const configurations = configs.map(({ name, command, cwd, env, debug }) => ({ name, command, ...(cwd ? { cwd } : {}), ...(env && Object.keys(env).length ? { env } : {}), ...(debug ? { debug } : {}) }))
  return JSON.stringify({ configurations }, null, 2) + '\n'
}

/** How to run a single file, by its extension; null when Whisk doesn't know. */
export function currentFileConfig(relPath: string): RunConfig | null {
  const ext = relPath.slice(relPath.lastIndexOf('.') + 1).toLowerCase()
  const file = quote(relPath)
  const by: Record<string, Pick<RunConfig, 'command' | 'debug'>> = {
    py: { command: `python ${file}`, debug: { type: 'python', program: relPath } },
    js: { command: `node ${file}`, debug: { type: 'node', program: relPath } },
    mjs: { command: `node ${file}`, debug: { type: 'node', program: relPath } },
    cjs: { command: `node ${file}`, debug: { type: 'node', program: relPath } },
    ts: { command: `npx tsx ${file}` },
    go: { command: `go run ${file}` },
    cs: { command: `dotnet run ${file}` },
    ps1: { command: `& ./${file}` },
    sh: { command: `bash ${file}` },
    rb: { command: `ruby ${file}` },
    php: { command: `php ${file}` },
    lua: { command: `lua ${file}` }
  }
  const found = by[ext]
  return found ? { id: 'current-file', name: `Current file (${baseName(relPath)})`, ...found, source: 'detected' } : null
}
