import { describe, expect, it } from 'vitest'
import { currentFileConfig, detectConfigs, isRunnableCsproj, parseProjectConfigs, serializeProjectConfigs } from './configs'
import { detectTestTargets } from '../tests/runner'

const APP = '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType></PropertyGroup></Project>'
const LIB = '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net10.0</TargetFramework></PropertyGroup></Project>'
const TESTS = '<Project Sdk="Microsoft.NET.Sdk"><ItemGroup><PackageReference Include="Microsoft.NET.Test.Sdk" /></ItemGroup></Project>'
const WEB = '<Project Sdk="Microsoft.NET.Sdk.Web"></Project>'
const UNITY = '<Project><Reference Include="UnityEngine"><HintPath>x</HintPath></Reference><OutputType>Exe</OutputType></Project>'

const reader = (files: Record<string, string>) => async (rel: string) => files[rel] ?? null

describe('detectConfigs', () => {
  it('offers .NET apps but not libraries, tests or Unity projects', async () => {
    const files = { 'src/App/App.csproj': APP, 'src/Core/Core.csproj': LIB, 'tests/T/T.csproj': TESTS, 'Web/Web.csproj': WEB, 'Assembly-CSharp.csproj': UNITY }
    const configs = await detectConfigs(Object.keys(files), reader(files))
    expect(configs.map((c) => c.name)).toEqual(['App', 'Web'])
    expect(configs[0]).toMatchObject({ command: 'dotnet run --project src/App/App.csproj', debug: { type: 'coreclr', project: 'src/App/App.csproj' } })
  })

  it('lists package scripts with the right runner, dev and start first', async () => {
    const files = { 'package.json': JSON.stringify({ scripts: { lint: 'eslint .', build: 'vite build', dev: 'vite' } }), 'pnpm-lock.yaml': '' }
    const configs = await detectConfigs(Object.keys(files), reader(files))
    expect(configs.map((c) => c.command)).toEqual(['pnpm run dev', 'pnpm run build', 'pnpm run lint'])
  })

  it('knows Cargo, Go and Python entry points', async () => {
    const files = { 'Cargo.toml': '', 'go.mod': '', 'main.py': '' }
    const names = (await detectConfigs(Object.keys(files), reader(files))).map((c) => c.command)
    expect(names).toEqual(['cargo run', 'go run .', 'python main.py'])
  })
})

describe('project run.json', () => {
  it('round-trips, skipping bad entries', () => {
    const text = JSON.stringify({ configurations: [{ name: 'Server', command: 'npm start', env: { PORT: '3000' } }, { name: 'broken' }] })
    const configs = parseProjectConfigs(text)
    expect(configs).toHaveLength(1)
    expect(configs[0]).toMatchObject({ name: 'Server', command: 'npm start', env: { PORT: '3000' }, source: 'project' })
    expect(parseProjectConfigs(serializeProjectConfigs(configs))[0]).toMatchObject({ name: 'Server', env: { PORT: '3000' } })
    expect(parseProjectConfigs('not json')).toEqual([])
  })
})

describe('currentFileConfig', () => {
  it('picks the runner by extension and quotes paths with spaces', () => {
    expect(currentFileConfig('scripts/build.py')?.command).toBe('python scripts/build.py')
    expect(currentFileConfig('my tools/run.js')?.command).toBe('node "my tools/run.js"')
    expect(currentFileConfig('Program.cs')?.command).toBe('dotnet run Program.cs')
    expect(currentFileConfig('README.md')).toBeNull()
  })

  it('treats Unity project files as not runnable', () => {
    expect(isRunnableCsproj(UNITY)).toBe(false)
  })
})

describe('detectTestTargets', () => {
  it('finds .NET tests through the solution, and JS and Python test tools', async () => {
    const files = { 'Game.sln': '', 'tests/T/T.csproj': TESTS, 'package.json': JSON.stringify({ devDependencies: { vitest: '^3' } }), 'tests/test_math.py': '' }
    const targets = await detectTestTargets(Object.keys(files), reader(files))
    expect(targets.map((t) => [t.framework, t.project])).toEqual([
      ['dotnet', 'Game.sln'],
      ['vitest', undefined],
      ['pytest', undefined]
    ])
  })
})
