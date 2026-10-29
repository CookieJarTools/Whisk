import { ipc } from '../lib/ipc'
import { baseName, joinPath } from '../lib/paths'
import { isWindows } from '../lib/platform'
import { runCommand } from '../lib/runCommand'
import { useSettings } from '../store/settings'
import type { RunConfig } from '../run/configs'
import { debuggerPort, editorInstance, PACKAGE_NAME } from '../unity/unity'

/**
 * Debug adapters: the per-language programs that do the actual debugging,
 * spoken to over the Debug Adapter Protocol. Built in: C# (netcoredbg),
 * Python (debugpy) and C, C++ and Rust (lldb-dap). Any other adapter that
 * speaks DAP over stdio can be added in Settings › Debuggers.
 */

export interface CustomDebugger {
  /** Used as the `debug.type` in run configurations. */
  id: string
  label: string
  command: string
  args: string[]
  /** File extensions it debugs with "Current file", e.g. `["lua"]`. */
  extensions: string[]
  /** The launch request as JSON, with ${file}, ${fileDirname} and ${workspaceFolder} filled in. */
  launch: string
}

export interface AdapterContext {
  root: string
  /** For build output, shown in the Debug console. */
  log(line: string): void
}

export interface AdapterDef {
  type: string
  label: string
  languages: string
  homepage: string
  /** The command line that installs it, for the one-click Install button. */
  install?: () => Promise<string>
  /** What has to be installed first, if anything. */
  prerequisite?: { program: string; label: string; url: string }
  /** How to start it; null when it isn't installed. */
  resolve(): Promise<{ command: string; args: string[] } | null>
  /** Builds what's needed and returns the DAP `launch` arguments. */
  prepare(config: RunConfig, ctx: AdapterContext): Promise<Record<string, unknown>>
  /** Attaches to something already running (Unity), so stopping detaches rather than ends it. */
  attach?: boolean
  /** Ships with Whisk, so there's nothing to install. */
  bundled?: boolean
}

const isAbsolute = (p: string) => /^([A-Za-z]:[\\/]|\/)/.test(p)
const abs = (root: string, p: string) => (isAbsolute(p) ? p : joinPath(root, p.replace(/\//g, root.includes('\\') ? '\\' : '/')))

async function run(command: string, ctx: AdapterContext, failure: string): Promise<string[]> {
  const lines: string[] = []
  ctx.log(`> ${command}`)
  const code = await runCommand(command, (line) => {
    lines.push(line)
    ctx.log(line)
  }, ctx.root)
  if (code !== 0) throw new Error(failure)
  return lines
}

function cwdFor(config: RunConfig, root: string) {
  return config.cwd ? abs(root, config.cwd) : root
}

const coreclr: AdapterDef = {
  type: 'coreclr',
  label: 'netcoredbg',
  languages: 'C# and other .NET languages',
  homepage: 'https://github.com/Samsung/netcoredbg',
  prerequisite: { program: 'dotnet', label: '.NET SDK', url: 'https://dotnet.microsoft.com/download' },
  async install() {
    const dir = await ipc.debuggersDir()
    if (!isWindows) return `curl -fsSL https://github.com/Samsung/netcoredbg/releases/latest/download/netcoredbg-linux-amd64.tar.gz | tar -xz -C '${dir}'`
    const zip = 'https://github.com/Samsung/netcoredbg/releases/latest/download/netcoredbg-win64.zip'
    return `powershell -NoProfile -ExecutionPolicy Bypass -Command "$z = Join-Path $env:TEMP 'netcoredbg.zip'; Invoke-WebRequest -UseBasicParsing '${zip}' -OutFile $z; Expand-Archive -Force $z '${dir}'; Remove-Item $z"`
  },
  async resolve() {
    const path = await ipc.which('netcoredbg')
    return path ? { command: path, args: ['--interpreter=vscode'] } : null
  },
  async prepare(config, ctx) {
    const project = config.debug?.project
    let program = config.debug?.program ? abs(ctx.root, config.debug.program) : ''
    if (project) {
      await run(`dotnet build "${project}" -c Debug -nologo -v q`, ctx, 'The build failed, so there’s nothing to debug. The errors are above.')
      // Ask MSBuild where the build put the program, rather than guessing the folder.
      const out = await run(`dotnet msbuild "${project}" -getProperty:TargetPath -p:Configuration=Debug -nologo`, ctx, 'Couldn’t find the built program.')
      program = out.map((l) => l.trim()).filter(Boolean).pop() ?? ''
    }
    if (!program) throw new Error('This configuration doesn’t say which project or program to debug.')
    return {
      type: 'coreclr',
      request: 'launch',
      program,
      args: config.debug?.args ?? [],
      cwd: cwdFor(config, ctx.root),
      env: config.env ?? {},
      stopAtEntry: false,
      justMyCode: true
    }
  }
}

const python: AdapterDef = {
  type: 'python',
  label: 'debugpy',
  languages: 'Python',
  homepage: 'https://github.com/microsoft/debugpy',
  prerequisite: { program: 'python', label: 'Python', url: 'https://www.python.org/downloads/' },
  async install() {
    const pip = 'python -m pip install --user --upgrade debugpy'
    if (isWindows) return pip
    // Most Linux distributions mark their Python as managed by the package manager.
    return `${pip} || ${pip} --break-system-packages || (echo "pip couldn't install debugpy. Install it with your package manager instead: python-debugpy on Arch, python3-debugpy on Debian and Ubuntu." && exit 1)`
  },
  async resolve() {
    const exe = await ipc.which('python')
    if (!exe) return null
    const code = await runCommand('python -c "import debugpy"', () => {})
    return code === 0 ? { command: exe, args: ['-m', 'debugpy.adapter'] } : null
  },
  async prepare(config, ctx) {
    const program = config.debug?.program
    if (!program) throw new Error('This configuration doesn’t say which script to debug.')
    return {
      type: 'python',
      request: 'launch',
      program: abs(ctx.root, program),
      args: config.debug?.args ?? [],
      cwd: cwdFor(config, ctx.root),
      env: config.env ?? {},
      console: 'internalConsole',
      justMyCode: true
    }
  }
}

const lldb: AdapterDef = {
  type: 'lldb',
  label: 'lldb-dap',
  languages: 'C, C++ and Rust',
  homepage: 'https://lldb.llvm.org/resources/lldbdap.html',
  // On Linux it comes with the distribution's lldb package.
  install: isWindows ? async () => 'winget install -e --id LLVM.LLVM --accept-package-agreements --accept-source-agreements' : undefined,
  async resolve() {
    for (const name of ['lldb-dap', 'lldb-vscode']) {
      const path = await ipc.which(name)
      if (path) return { command: path, args: [] }
    }
    return null
  },
  async prepare(config, ctx) {
    let program = config.debug?.program ? abs(ctx.root, config.debug.program) : ''
    if (!program && config.id === 'cargo:run') {
      await run('cargo build', ctx, 'The build failed, so there’s nothing to debug. The errors are above.')
      const manifest = await ipc.readText(joinPath(ctx.root, 'Cargo.toml')).catch(() => '')
      const name = /\[package\][^[]*?\bname\s*=\s*"([^"]+)"/.exec(manifest)?.[1] ?? baseName(ctx.root)
      program = joinPath(ctx.root, `target${ctx.root.includes('\\') ? '\\' : '/'}debug${ctx.root.includes('\\') ? '\\' : '/'}${name}${isWindows ? '.exe' : ''}`)
    }
    if (!program) throw new Error('This configuration doesn’t say which program to debug.')
    return { type: 'lldb', request: 'launch', program, args: config.debug?.args ?? [], cwd: cwdFor(config, ctx.root), env: Object.entries(config.env ?? {}).map(([k, v]) => `${k}=${v}`), stopOnEntry: false }
  }
}

const READY_TIMEOUT_MS = 120_000

/** Waits for the Whisk package in Unity to finish switching to Debug mode (a script recompile). */
async function waitForDebugMode(root: string, ctx: AdapterContext) {
  const folder = joinPath(joinPath(root, 'Library'), 'Whisk')
  const ready = joinPath(folder, 'debug-ready')
  await ipc.removeFile(ready)
  await ipc.writeText(joinPath(folder, 'debug-request'), new Date().toISOString())
  ctx.log('Asking Unity to get ready for the debugger (it may recompile scripts once)…')
  const started = Date.now()
  while (Date.now() - started < READY_TIMEOUT_MS) {
    if ((await ipc.pathState(ready)) !== 'missing') {
      await ipc.removeFile(ready)
      return
    }
    await new Promise((r) => setTimeout(r, 400))
  }
  // Unity may be busy or unfocused; attach anyway and let Unity ask about Debug mode itself.
  ctx.log('Unity didn’t answer, so attaching anyway. If Unity asks, choose to enable debugging.')
}

const unity: AdapterDef = {
  type: 'unity',
  label: 'Unity debugger',
  languages: 'C# in the Unity editor',
  homepage: 'https://github.com/walcht/unity-dap',
  attach: true,
  bundled: true,
  // A .NET Framework program, which Linux runs with Mono.
  prerequisite: isWindows ? undefined : { program: 'mono', label: 'Mono', url: 'https://www.mono-project.com/download/stable/' },
  async resolve() {
    const exe = await ipc.bundledPath('debuggers/unity/unity-debug-adapter.exe')
    if ((await ipc.pathState(exe)) === 'missing') return null
    if (isWindows) return { command: exe, args: [] }
    const mono = await ipc.which('mono')
    return mono ? { command: mono, args: [exe] } : null
  },
  async prepare(_config, ctx) {
    const instance = await editorInstance(ctx.root)
    if (!instance) throw new Error('Open this project in Unity first, then press Debug again.')
    if ((await ipc.pathState(joinPath(joinPath(ctx.root, 'Packages'), PACKAGE_NAME))) !== 'missing') await waitForDebugMode(ctx.root, ctx)
    const port = debuggerPort(instance.processId)
    ctx.log(`Attaching to Unity ${instance.version} (process ${instance.processId}, port ${port})`)
    return { request: 'attach', address: '127.0.0.1', port }
  }
}

export const BUILT_IN_ADAPTERS: AdapterDef[] = [coreclr, unity, python, lldb]

/** Fills ${file}, ${fileDirname} and ${workspaceFolder} in a custom debugger's launch JSON. */
export function fillLaunch(template: string, vars: { file: string; root: string }): Record<string, unknown> {
  const dir = vars.file.replace(/[\\/][^\\/]*$/, '')
  const json = (s: string) => JSON.stringify(s).slice(1, -1)
  const text = template
    .replace(/\$\{file\}/g, json(vars.file))
    .replace(/\$\{fileDirname\}/g, json(dir))
    .replace(/\$\{workspaceFolder\}/g, json(vars.root))
  return JSON.parse(text)
}

function customAdapter(c: CustomDebugger): AdapterDef {
  return {
    type: c.id,
    label: c.label,
    languages: c.extensions.map((e) => `.${e}`).join(', ') || 'Your own',
    homepage: '',
    async resolve() {
      const path = await ipc.which(c.command)
      return path ? { command: path, args: c.args } : null
    },
    async prepare(config, ctx) {
      const file = config.debug?.program ? abs(ctx.root, config.debug.program) : ''
      const launch = fillLaunch(c.launch || '{}', { file, root: ctx.root })
      return { request: 'launch', ...launch, ...(config.debug?.args ? { args: config.debug.args } : {}) }
    }
  }
}

export function allAdapters(): AdapterDef[] {
  return [...BUILT_IN_ADAPTERS, ...useSettings.getState().customDebuggers.map(customAdapter)]
}

export function adapterFor(type: string): AdapterDef | undefined {
  return allAdapters().find((a) => a.type === type)
}

/** A custom debugger that handles files with this extension, for "Current file". */
export function customDebuggerFor(path: string): CustomDebugger | undefined {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  return useSettings.getState().customDebuggers.find((d) => d.extensions.includes(ext))
}
