// Builds the Unity debug adapter (walcht/unity-dap, MIT) that Whisk ships with, from a
// pinned commit, into src-tauri/resources/unity-debugger. Skipped when that commit is
// already built. Needs git and the .NET SDK (the adapter targets .NET Framework 4.7.2,
// which every Windows 10 and 11 machine has).
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO = 'https://github.com/walcht/unity-dap.git'
const COMMIT = 'c0c632b'
const here = join(import.meta.dirname, '..')
const work = join(here, 'src-tauri', 'target', 'unity-dap')
const out = join(here, 'src-tauri', 'resources', 'unity-debugger')
const stamp = join(out, 'built-from.txt')

if (existsSync(stamp) && readFileSync(stamp, 'utf8').trim() === COMMIT) {
  console.log(`Unity debugger ${COMMIT} already built.`)
  process.exit(0)
}

const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: 'inherit' })

rmSync(work, { recursive: true, force: true })
run('git', ['clone', '--quiet', REPO, work])
run('git', ['checkout', '--quiet', COMMIT], work)
run('git', ['submodule', 'update', '--init', '--recursive', '--quiet'], work)

// Two of its dependencies only live on .NET's own package feed; add it for this build only.
writeFileSync(
  join(work, 'nuget.config'),
  `<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <packageSources>
    <add key="nuget.org" value="https://api.nuget.org/v3/index.json" />
    <add key="dotnet-tools" value="https://pkgs.dev.azure.com/dnceng/public/_packaging/dotnet-tools/nuget/v3/index.json" />
  </packageSources>
</configuration>
`
)
run('dotnet', ['build', '--configuration', 'Release', '-nologo', '-v', 'q', 'unity-debug-adapter/unity-debug-adapter.csproj'], work)

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
const built = join(work, 'bin', 'Release')
// Native libraries for other platforms and debug symbols aren't needed on Windows.
cpSync(built, out, {
  recursive: true,
  filter: (src) => !src.includes(`${join(built, 'runtimes')}`) && !/\.(pdb|xml)$/i.test(src)
})
cpSync(join(work, 'LICENSE'), join(out, 'LICENSE.txt'))
writeFileSync(stamp, COMMIT + '\n')
console.log(`Built the Unity debugger into ${out}`)
