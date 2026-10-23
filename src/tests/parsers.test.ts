import { describe, expect, it } from 'vitest'
import { decodeXml, parseCargoTest, parseGoTest, parseJestJson, parseJUnit, parseTrx } from './parsers'
import xunitTrx from './fixtures/xunit.trx?raw'
import vitestJUnit from './fixtures/vitest-junit.xml?raw'
import cargoText from './fixtures/cargo.txt?raw'

const FIXTURES: Record<string, string> = { 'xunit.trx': xunitTrx, 'vitest-junit.xml': vitestJUnit, 'cargo.txt': cargoText }
const fixture = (name: string) => FIXTURES[name]

describe('parseTrx (real dotnet test output, xUnit)', () => {
  const tests = parseTrx(fixture('xunit.trx'))

  it('reads every result with its class and outcome', () => {
    expect(tests).toHaveLength(5)
    expect(new Set(tests.map((t) => t.suite))).toEqual(new Set(['Calc.Tests.MathTests']))
    const byName = Object.fromEntries(tests.map((t) => [t.name, t.outcome]))
    expect(byName).toMatchObject({ AddsNumbers: 'passed', FailsOnPurpose: 'failed', Skipped: 'skipped', 'Positive(n: 1)': 'passed' })
  })

  it('keeps the failure message and stack trace', () => {
    const failed = tests.find((t) => t.name === 'FailsOnPurpose')!
    expect(failed.message).toContain('Assert.Equal() Failure')
    expect(failed.stack).toContain('UnitTest1.cs:line 9')
    expect(failed.durationMs).toBeGreaterThanOrEqual(0)
  })
})

describe('parseJUnit (real Vitest output)', () => {
  it('reads cases from every suite', () => {
    const tests = parseJUnit(fixture('vitest-junit.xml'))
    expect(tests.length).toBeGreaterThan(5)
    expect(tests.every((t) => t.outcome === 'passed')).toBe(true)
    expect(tests[0].suite).toBe('src/lib/fuzzy.test.ts')
    expect(tests[0].name).toBe('fuzzyMatch > matches CamelCase humps')
  })

  it('reads pytest-style failures and skips', () => {
    const xml = `<testsuites><testsuite name="pytest">
      <testcase classname="tests.test_math" name="test_add" time="0.002" />
      <testcase classname="tests.test_math" name="test_sub" time="0.010"><failure message="assert 1 == 2">def test_sub():
&gt;       assert 1 == 2
E       assert 1 == 2</failure></testcase>
      <testcase classname="tests.test_math" name="test_later" time="0"><skipped message="todo" /></testcase>
    </testsuite></testsuites>`
    const tests = parseJUnit(xml)
    expect(tests.map((t) => t.outcome)).toEqual(['passed', 'failed', 'skipped'])
    expect(tests[1].message).toBe('assert 1 == 2')
    expect(tests[1].stack).toContain('>       assert 1 == 2')
    expect(tests[1].durationMs).toBe(10)
  })
})

describe('parseCargoTest (real cargo test output)', () => {
  it('reads outcomes and the panic for failures', () => {
    const tests = parseCargoTest(fixture('cargo.txt'))
    expect(tests.map((t) => [t.name, t.outcome])).toEqual([
      ['ignored', 'skipped'],
      ['adds', 'passed'],
      ['fails_on_purpose', 'failed']
    ])
    expect(tests[2].suite).toBe('tests')
    expect(tests[2].stack).toContain('left: 4')
    expect(tests[2].message).toContain('panicked')
  })
})

describe('parseGoTest', () => {
  it('reads go test -v output', () => {
    const out = [
      '=== RUN   TestAdd',
      '--- PASS: TestAdd (0.00s)',
      '=== RUN   TestSub',
      '    math_test.go:12: got 1, want 2',
      '--- FAIL: TestSub (0.01s)',
      'FAIL',
      'FAIL\texample.com/calc\t0.123s'
    ].join('\n')
    const tests = parseGoTest(out)
    expect(tests.map((t) => [t.suite, t.name, t.outcome])).toEqual([
      ['example.com/calc', 'TestAdd', 'passed'],
      ['example.com/calc', 'TestSub', 'failed']
    ])
    expect(tests[1].message).toBe('math_test.go:12: got 1, want 2')
  })
})

describe('parseJestJson', () => {
  it('reads assertion results', () => {
    const json = JSON.stringify({
      testResults: [
        {
          name: 'C:/app/sum.test.js',
          assertionResults: [
            { title: 'adds', ancestorTitles: ['sum'], status: 'passed', duration: 3, failureMessages: [] },
            { title: 'fails', ancestorTitles: ['sum'], status: 'failed', duration: 1, failureMessages: ['Error: expected 1\n    at sum.test.js:5'] }
          ]
        }
      ]
    })
    const tests = parseJestJson(json)
    expect(tests.map((t) => t.outcome)).toEqual(['passed', 'failed'])
    expect(tests[1]).toMatchObject({ suite: 'C:/app/sum.test.js › sum', message: 'Error: expected 1' })
  })
})

describe('decodeXml', () => {
  it('decodes entities and character references', () => {
    expect(decodeXml('a &lt;b&gt; &amp; &#xD;&#10;c')).toBe('a <b> & \r\nc')
  })
})
