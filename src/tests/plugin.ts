import type { IdePlugin, SymbolMatch } from '../plugins/api'
import { languageFor } from '../lib/languages'
import { useStore } from '../store/store'
import { runTests, useTests, type Framework, type TestFilter } from './runner'

/**
 * "▶ Run test" above test methods (and "▶ Run tests" above test classes),
 * as a built-in plugin through the same API as everyone else's.
 */

const TEST_ATTRIBUTE = /\[\s*(Fact|Theory|Test|TestCase|TestCaseSource|TestMethod|DataTestMethod|UnityTest)\b/
const FRAMEWORKS_FOR: Record<string, Framework[]> = {
  csharp: ['dotnet'],
  python: ['pytest'],
  rust: ['cargo'],
  go: ['go']
}

function isTestMethod(s: SymbolMatch): boolean {
  if (TEST_ATTRIBUTE.test(s.declaration)) return true
  if (s.path.endsWith('.py')) return /^test_?/.test(s.name)
  if (s.path.endsWith('.rs')) return /#\[(tokio::)?test\]/.test(s.declaration)
  if (s.path.endsWith('_test.go')) return /^Test[A-Z_]/.test(s.name)
  return false
}

function isTestClass(s: SymbolMatch): boolean {
  if (s.path.endsWith('.py')) return /^Test/.test(s.name)
  if (s.path.endsWith('.cs')) return /\[(TestFixture|TestClass)\b/.test(s.declaration) || /Tests?$/.test(s.name)
  return false
}

function targetFor(path: string) {
  const wanted = FRAMEWORKS_FOR[languageFor(path).lspId] ?? []
  return useTests.getState().targets.find((t) => wanted.includes(t.framework))
}

function run(path: string, filter: TestFilter) {
  const target = targetFor(path)
  if (!target) return useStore.getState().toast('Whisk didn’t find a test project for this file.')
  if (useTests.getState().running) return useStore.getState().toast('Tests are already running.')
  void runTests(target, filter)
}

export const testsPlugin: IdePlugin = {
  id: 'whisk.tests',
  name: 'Tests',
  activate(ctx) {
    ctx.registerSymbolAction({
      id: 'run-test',
      label: '▶ Run test',
      title: 'Run this test',
      kinds: ['method', 'function'],
      when: isTestMethod,
      run: (symbol) => {
        const owner = symbol.containers.filter(Boolean).pop()
        const file = symbol.relativePath.replace(/\\/g, '/')
        if (symbol.path.endsWith('.cs')) {
          // "Class.Method" matched anywhere in the full name, as file-scoped namespaces aren't blocks.
          return run(symbol.path, { label: symbol.name, name: owner ? `${owner}.${symbol.name}` : symbol.name, group: true })
        }
        if (symbol.path.endsWith('.py')) return run(symbol.path, { label: symbol.name, name: owner ? `${owner}.${symbol.name}` : symbol.name, file })
        run(symbol.path, { label: symbol.name, name: symbol.name, file })
      }
    })
    ctx.registerSymbolAction({
      id: 'run-tests-in-class',
      label: '▶ Run tests',
      title: 'Run the tests in this class',
      kinds: ['class'],
      when: isTestClass,
      run: (symbol) => {
        const file = symbol.relativePath.replace(/\\/g, '/')
        if (symbol.path.endsWith('.cs')) return run(symbol.path, { label: symbol.name, name: `${symbol.name}.`, group: true })
        run(symbol.path, { label: symbol.name, name: symbol.name, file, group: true })
      }
    })
  }
}
