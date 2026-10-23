import { create } from 'zustand'
import { ipc } from '../lib/ipc'
import { baseName, joinPath, relativePath } from '../lib/paths'
import { runCommand } from '../lib/runCommand'
import { useStore } from '../store/store'
import { usePanel } from '../store/panel'
import { saveAllDirty } from '../editor/autoSave'
import { revealLine } from '../editor/views'
import { isTestCsproj } from '../run/configs'
import { parseCargoTest, parseGoTest, parseJestJson, parseJUnit, parseTrx, type TestCase } from './parsers'

/**
 * The test runner: finds how the project tests itself, runs that tool with
 * a machine-readable report, and shows the results as a tree in the panel.
 */

export type Framework = 'dotnet' | 'vitest' | 'jest' | 'pytest' | 'cargo' | 'go'

export interface TestTarget {
  framework: Framework
  label: string
  /** For dotnet: the .sln or test .csproj to run, relative to the project. */
  project?: string
}

/** Narrows a run: one test, or everything in a class or file. */
export interface TestFilter {
  /** Shown while running, e.g. "MathTests.AddsNumbers". */
  label: string
  /** Fully qualified name (dotnet), test name (others). */
  name: string
  /** The test's file, relative to the project (for tools that filter by file). */
  file?: string
  /** True when `name` is a class or suite rather than one test. */
  group?: boolean
}

interface TestsState {
  targets: TestTarget[]
  results: TestCase[]
  running: string | null
  /** Everything the tool printed in the last run. */
  log: string[]
  selected: string | null
  lastRun: { target: TestTarget; filter?: TestFilter } | null
  commandId: number | null
}

export const useTests = create<TestsState>(() => ({
  targets: [],
  results: [],
  running: null,
  log: [],
  selected: null,
  lastRun: null,
  commandId: null
}))

type Read = (rel: string) => Promise<string | null>

/** Works out which test tools the project uses, from its files. */
export async function detectTestTargets(files: string[], read: Read): Promise<TestTarget[]> {
  const set = new Set(files)
  const targets: TestTarget[] = []
  const csprojs = files.filter((f) => f.endsWith('.csproj') && !f.includes('node_modules/'))
  const testProjects: string[] = []
  for (const rel of csprojs) {
    const xml = await read(rel)
    if (xml && isTestCsproj(xml)) testProjects.push(rel)
  }
  if (testProjects.length) {
    const sln = files.find((f) => /\.slnx?$/.test(f) && !f.includes('/'))
    targets.push({ framework: 'dotnet', label: '.NET tests', project: sln ?? (testProjects.length === 1 ? testProjects[0] : undefined) })
  }
  const pkg = await read('package.json')
  if (pkg) {
    const deps = (() => {
      try {
        const json = JSON.parse(pkg)
        return { ...json.dependencies, ...json.devDependencies }
      } catch {
        return {}
      }
    })()
    if (deps.vitest) targets.push({ framework: 'vitest', label: 'Vitest' })
    else if (deps.jest) targets.push({ framework: 'jest', label: 'Jest' })
  }
  const pyproject = (await read('pyproject.toml')) ?? ''
  if (set.has('pytest.ini') || set.has('conftest.py') || /pytest/.test(pyproject) || files.some((f) => /(^|\/)test_[^/]+\.py$/.test(f))) {
    targets.push({ framework: 'pytest', label: 'pytest' })
  }
  if (set.has('Cargo.toml')) targets.push({ framework: 'cargo', label: 'cargo test' })
  if (set.has('go.mod')) targets.push({ framework: 'go', label: 'go test' })
  return targets
}

export async function loadTestTargets() {
  const root = useStore.getState().root
  if (!root) return useTests.setState({ targets: [], results: [] })
  const files = (await ipc.listFiles(root).catch(() => [] as string[])).map((p) => relativePath(root, p).replace(/\\/g, '/'))
  const targets = await detectTestTargets(files, (rel) => ipc.readText(joinPath(root, rel)).catch(() => null))
  if (useStore.getState().root === root) useTests.setState({ targets })
}

const q = (s: string) => `"${s.replace(/"/g, '\\"')}"`

interface Plan {
  command: string
  /** Reads the results once the tool has finished. */
  collect(output: string[]): Promise<TestCase[]>
}

async function tempPath(name: string): Promise<string> {
  return ipc.writeTemp(name, '')
}

async function readReport(path: string): Promise<string> {
  return ipc.readText(path).catch(() => '')
}

/** The command for a run, and how to read what it reports. */
export async function planRun(target: TestTarget, filter?: TestFilter): Promise<Plan> {
  const stamp = Date.now()
  switch (target.framework) {
    case 'dotnet': {
      const marker = await tempPath(`trx-${stamp}.txt`)
      const dir = marker.replace(/\.txt$/, '')
      const parts = ['dotnet test']
      if (target.project) parts.push(q(target.project))
      parts.push(`--results-directory ${q(dir)}`, '--logger "trx;LogFilePrefix=whisk"')
      if (filter) parts.push(`--filter ${q(`FullyQualifiedName${filter.group ? '~' : '='}${filter.name}`)}`)
      return {
        command: parts.join(' '),
        async collect() {
          const entries = await ipc.listDir(dir).catch(() => [])
          const reports = await Promise.all(entries.filter((e) => e.name.endsWith('.trx')).map((e) => readReport(e.path)))
          return reports.flatMap(parseTrx)
        }
      }
    }
    case 'vitest': {
      const file = await tempPath(`vitest-${stamp}.xml`)
      const parts = ['npx vitest run --reporter=default --reporter=junit', `--outputFile.junit=${q(file)}`]
      if (filter?.file) parts.push(q(filter.file))
      if (filter && !filter.group) parts.push(`-t ${q(filter.name)}`)
      return { command: parts.join(' '), collect: async () => parseJUnit(await readReport(file)) }
    }
    case 'jest': {
      const file = await tempPath(`jest-${stamp}.json`)
      const parts = ['npx jest --json', `--outputFile=${q(file)}`]
      if (filter?.file) parts.push(q(filter.file))
      if (filter && !filter.group) parts.push(`-t ${q(filter.name)}`)
      return { command: parts.join(' '), collect: async () => parseJestJson(await readReport(file)) }
    }
    case 'pytest': {
      const file = await tempPath(`pytest-${stamp}.xml`)
      const parts = ['python -m pytest', `--junitxml=${q(file)}`]
      if (filter) parts.push(q(filter.file ? `${filter.file}::${filter.name.split('.').join('::')}` : filter.name))
      return { command: parts.join(' '), collect: async () => parseJUnit(await readReport(file)) }
    }
    case 'cargo':
      return { command: filter ? `cargo test ${q(filter.name)}` : 'cargo test', collect: async (out) => parseCargoTest(out.join('\n')) }
    case 'go':
      return { command: filter ? `go test -v ./... -run ${q(`^${filter.name}$`)}` : 'go test -v ./...', collect: async (out) => parseGoTest(out.join('\n')) }
  }
}

/** Runs tests and shows the results. A filtered run updates just those tests in the tree. */
export async function runTests(target: TestTarget, filter?: TestFilter) {
  const root = useStore.getState().root
  if (!root || useTests.getState().running) return
  await saveAllDirty()
  usePanel.getState().show('tests')
  const plan = await planRun(target, filter)
  const log: string[] = [`> ${plan.command}`, '']
  useTests.setState({ running: filter?.label ?? target.label, log: [...log], lastRun: { target, filter } })
  let flush = 0
  const code = await runCommand(
    plan.command,
    (line) => {
      log.push(line)
      // Batch log updates so a chatty test run doesn't re-render per line.
      if (!flush) flush = window.setTimeout(() => ((flush = 0), useTests.setState({ log: [...log] })), 100)
    },
    root,
    (id) => useTests.setState({ commandId: id })
  )
  clearTimeout(flush)
  const found = await plan.collect(log)
  useTests.setState((s) => {
    const fresh = new Map(found.map((t) => [t.id, t]))
    const results = filter ? [...s.results.filter((t) => !fresh.has(t.id)), ...found] : found
    return { results, running: null, log: [...log], commandId: null }
  })
  if (found.length === 0) {
    useStore.getState().toast(code === 0 ? 'No tests were found.' : 'The test run failed before reporting any results. The output is in the Tests panel.', code === 0 ? 'info' : 'error')
  }
}

export function stopTests() {
  const id = useTests.getState().commandId
  if (id !== null) void ipc.killCommand(id)
}

export function rerunTests() {
  const last = useTests.getState().lastRun
  const target = last?.target ?? useTests.getState().targets[0]
  if (!target) return useStore.getState().toast('Whisk didn’t find any tests in this project.')
  return runTests(target, last?.filter)
}

export function runFailedTests() {
  const { results, targets } = useTests.getState()
  const failed = results.filter((t) => t.outcome === 'failed')
  const target = useTests.getState().lastRun?.target ?? targets[0]
  if (!target || failed.length === 0) return
  if (failed.length === 1) return runTests(target, filterFor(target, failed[0]))
  // Several: dotnet can take them all at once; the others just rerun everything.
  if (target.framework === 'dotnet') {
    return runTests(target, { label: `${failed.length} failed tests`, name: failed.map((t) => `${t.suite}.${t.name.replace(/\(.*$/, '')}`).join('|FullyQualifiedName='), group: false })
  }
  return runTests(target)
}

/** The filter that reruns one test from the results. */
export function filterFor(target: TestTarget, test: TestCase): TestFilter {
  const bare = test.name.replace(/\(.*$/, '')
  switch (target.framework) {
    case 'dotnet':
      return { label: bare, name: `${test.suite}.${bare}` }
    case 'vitest':
    case 'jest':
      return { label: test.name, name: test.name.split(' > ').pop()!, file: test.file ?? test.suite.split(' › ')[0] }
    case 'pytest': {
      const parts = test.suite.split('.')
      const cls = /^[A-Z]/.test(parts[parts.length - 1]) ? parts.pop() : undefined
      return { label: test.name, name: cls ? `${cls}.${test.name}` : test.name, file: `${parts.join('/')}.py` }
    }
    default:
      return { label: test.name, name: test.name }
  }
}

/** Opens the source of a test: from its stack trace when there is one, else by searching for it. */
export async function openTest(test: TestCase) {
  const root = useStore.getState().root
  if (!root) return
  const fromStack = test.stack && /(?:in |at |\()((?:[A-Za-z]:)?[^\s:()]+\.\w+):(?:line )?(\d+)/.exec(test.stack)
  if (fromStack) {
    const path = /^[A-Za-z]:/.test(fromStack[1]) ? fromStack[1] : joinPath(root, fromStack[1])
    if ((await ipc.pathState(path)) !== 'missing' && (await useStore.getState().openFile(path))) return revealLine(path, Number(fromStack[2]))
  }
  if (test.file && test.line) {
    const path = /^[A-Za-z]:/.test(test.file) ? test.file : joinPath(root, test.file)
    if (await useStore.getState().openFile(path)) return revealLine(path, test.line)
  }
  const name = test.name.replace(/\(.*$/, '').split(' > ').pop()!.trim()
  const word = /^\w+$/.test(name)
  const found = await ipc.searchProject({
    root,
    query: word ? `\\b${name}\\s*\\(` : name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    caseSensitive: true,
    wholeWord: false,
    regex: true,
    fileMask: '',
    includeHidden: false,
    maxResults: 5
  })
  const hit = found.matches.find((m) => !baseName(m.path).startsWith('.')) ?? found.matches[0]
  if (hit && (await useStore.getState().openFile(hit.path))) revealLine(hit.path, hit.line, hit.col)
  else useStore.getState().toast(`Couldn’t find ${name} in the project.`)
}

let installed = false

export function installTests() {
  if (installed) return
  installed = true
  let root = useStore.getState().root
  void loadTestTargets()
  useStore.subscribe((s) => {
    if (s.root === root) return
    root = s.root
    useTests.setState({ results: [], log: [], selected: null, lastRun: null })
    void loadTestTargets()
  })
}
