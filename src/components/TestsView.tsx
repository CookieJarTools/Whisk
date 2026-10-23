import { useMemo, useState } from 'react'
import { useStore } from '../store/store'
import { filterFor, openTest, rerunTests, runFailedTests, runTests, stopTests, useTests, type TestTarget } from '../tests/runner'
import type { Outcome, TestCase } from '../tests/parsers'
import { Icon } from './Icon'

/** The Tests view in the bottom panel: results as a tree, with the selected test's failure beside it. */

const MARK: Record<Outcome, string> = { passed: '✓', failed: '✗', skipped: '○' }

function duration(ms?: number): string {
  if (ms === undefined) return ''
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`
}

function worst(tests: TestCase[]): Outcome {
  if (tests.some((t) => t.outcome === 'failed')) return 'failed'
  if (tests.every((t) => t.outcome === 'skipped')) return 'skipped'
  return 'passed'
}

export function TestsView() {
  const targets = useTests((s) => s.targets)
  const results = useTests((s) => s.results)
  const running = useTests((s) => s.running)
  const log = useTests((s) => s.log)
  const selected = useTests((s) => s.selected)
  const lastRun = useTests((s) => s.lastRun)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [onlyFailed, setOnlyFailed] = useState(false)
  const target: TestTarget | undefined = lastRun?.target ?? targets[0]

  const suites = useMemo(() => {
    const groups = new Map<string, TestCase[]>()
    for (const t of results) {
      if (onlyFailed && t.outcome !== 'failed') continue
      groups.set(t.suite, [...(groups.get(t.suite) ?? []), t])
    }
    // Failing suites first, then by name.
    return [...groups.entries()].sort(([a, ta], [b, tb]) => Number(worst(tb) === 'failed') - Number(worst(ta) === 'failed') || a.localeCompare(b))
  }, [results, onlyFailed])

  const counts = { passed: 0, failed: 0, skipped: 0 }
  for (const t of results) counts[t.outcome]++
  const chosen = results.find((t) => t.id === selected)

  if (targets.length === 0 && results.length === 0) {
    return (
      <div className="panel-empty">
        Whisk didn’t find any tests in this project.
        <br />
        It looks for .NET test projects, Vitest, Jest, pytest, Cargo and Go.
      </div>
    )
  }

  const runAll = (t: TestTarget) => void runTests(t)
  const menu = (e: React.MouseEvent, test: TestCase) => {
    e.preventDefault()
    if (!target) return
    useStore.getState().openMenu(e.clientX, e.clientY, [
      { label: 'Run this test', onSelect: () => void runTests(target, filterFor(target, test)) },
      { label: 'Go to the test', onSelect: () => void openTest(test) }
    ])
  }

  return (
    <div className="tests-view">
      <div className="term-tabs">
        {targets.map((t) => (
          <button key={t.label} className="btn tests-run" disabled={!!running} onClick={() => runAll(t)} title={`Run every test with ${t.label}`}>
            <Icon name="play" size={11} /> {targets.length > 1 ? t.label : 'Run all'}
          </button>
        ))}
        <button className="icon-btn" title="Run the last run again" disabled={!!running || !target} onClick={() => void rerunTests()}>
          <Icon name="refresh" size={12} />
        </button>
        <button className="icon-btn" title="Run failed tests" disabled={!!running || counts.failed === 0} onClick={() => void runFailedTests()}>
          <Icon name="resume" size={12} />
        </button>
        {running && (
          <button className="icon-btn" title="Stop" onClick={stopTests}>
            <Icon name="stop" size={11} />
          </button>
        )}
        <label className="tests-filter">
          <input type="checkbox" checked={onlyFailed} onChange={(e) => setOnlyFailed(e.target.checked)} /> Failed only
        </label>
        <div className="term-tabs-spacer" />
        <span className="tests-summary">
          {running ? (
            <>Running {running}…</>
          ) : results.length ? (
            <>
              <span className="t-passed">{counts.passed} passed</span>
              {counts.failed > 0 && <span className="t-failed"> · {counts.failed} failed</span>}
              {counts.skipped > 0 && <span className="t-skipped"> · {counts.skipped} skipped</span>}
            </>
          ) : null}
        </span>
      </div>
      <div className="tests-main">
        <div className="tests-tree">
          {results.length === 0 && !running && <div className="panel-empty">Press Run all to run the tests.</div>}
          {suites.map(([suite, tests]) => {
            const open = !collapsed.has(suite)
            return (
              <div key={suite}>
                <div
                  className={`tests-suite t-${worst(tests)}`}
                  onClick={() =>
                    setCollapsed((s) => {
                      const next = new Set(s)
                      if (open) next.add(suite)
                      else next.delete(suite)
                      return next
                    })
                  }
                >
                  <span className={`tree-chev${open ? ' open' : ''}`}>
                    <Icon name="chevron" size={10} strokeWidth={2.4} />
                  </span>
                  <span className="tests-mark">{MARK[worst(tests)]}</span>
                  <span className="tests-name">{suite || '(no class)'}</span>
                  <span className="tests-time">{tests.length}</span>
                </div>
                {open &&
                  tests.map((t) => (
                    <div
                      key={t.id}
                      className={`tests-case t-${t.outcome}${t.id === selected ? ' on' : ''}`}
                      onClick={() => useTests.setState({ selected: t.id })}
                      onDoubleClick={() => void openTest(t)}
                      onContextMenu={(e) => menu(e, t)}
                      title="Double-click to open the test"
                    >
                      <span className="tests-mark">{MARK[t.outcome]}</span>
                      <span className="tests-name">{t.name}</span>
                      <span className="tests-time">{duration(t.durationMs)}</span>
                    </div>
                  ))}
              </div>
            )
          })}
        </div>
        <div className="tests-detail">
          {chosen && !running ? (
            <>
              <div className={`tests-detail-head t-${chosen.outcome}`}>
                {MARK[chosen.outcome]} {chosen.name}
                <span className="tests-time">{duration(chosen.durationMs)}</span>
              </div>
              {chosen.message && <pre className="tests-message">{chosen.message}</pre>}
              {chosen.stack && chosen.stack !== chosen.message && <pre className="tests-stack">{chosen.stack}</pre>}
              {!chosen.message && !chosen.stack && <div className="config-hint">{chosen.outcome === 'passed' ? 'Passed.' : 'Skipped.'}</div>}
            </>
          ) : (
            <pre className="tests-log">{log.join('\n')}</pre>
          )}
        </div>
      </div>
    </div>
  )
}
