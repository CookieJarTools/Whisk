/**
 * Reading test results from the report each tool writes: TRX (dotnet test),
 * JUnit XML (pytest, Vitest), Jest's JSON, and the plain text of `cargo test`
 * and `go test -v`. The XML is read with small regexes rather than a DOM, so
 * this runs anywhere (the reports are machine-written and regular).
 */

export type Outcome = 'passed' | 'failed' | 'skipped'

export interface TestCase {
  /** Unique within a run: suite + name. */
  id: string
  /** The test itself, e.g. `AddsNumbers`. */
  name: string
  /** What it belongs to: a class (`Game.Tests.MathTests`), module or file. */
  suite: string
  outcome: Outcome
  durationMs?: number
  message?: string
  stack?: string
  /** Source file, when the report says. */
  file?: string
  line?: number
}

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }

export function decodeXml(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, code: string) => {
      if (code[0] === '#') return String.fromCodePoint(code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10))
      return ENTITIES[code] ?? whole
    })
}

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of tag.matchAll(/([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) out[m[1]] = decodeXml(m[3] ?? m[4] ?? '')
  return out
}

/** Each `<name …>…</name>` or `<name …/>` element: its attributes and inner XML. */
function elements(xml: string, name: string): { attrs: Record<string, string>; body: string }[] {
  const out: { attrs: Record<string, string>; body: string }[] = []
  const re = new RegExp(`<${name}\\b([^>]*?)(/>|>([\\s\\S]*?)</${name}>)`, 'g')
  for (const m of xml.matchAll(re)) out.push({ attrs: attrs(m[1]), body: m[3] ?? '' })
  return out
}

function inner(xml: string, name: string): string | undefined {
  const m = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`).exec(xml)
  return m ? decodeXml(m[1]).trim() : undefined
}

/** `00:00:01.2345678` → milliseconds. */
function timespan(text?: string): number | undefined {
  const m = text && /^(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(text)
  return m ? Math.round((Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000) : undefined
}

const TRX_OUTCOME: Record<string, Outcome> = { Passed: 'passed', Failed: 'failed', Error: 'failed', Timeout: 'failed', Aborted: 'failed' }

/** Reads a .trx file from `dotnet test --logger trx`. */
export function parseTrx(xml: string): TestCase[] {
  const methods = new Map<string, { className: string; name: string }>()
  for (const def of elements(xml, 'UnitTest')) {
    const method = elements(def.body, 'TestMethod')[0]
    if (def.attrs.id && method) methods.set(def.attrs.id, { className: method.attrs.className ?? '', name: method.attrs.name ?? def.attrs.name ?? '' })
  }
  return elements(xml, 'UnitTestResult').map(({ attrs: a, body }) => {
    const method = methods.get(a.testId)
    const suite = method?.className.split(',')[0].trim() || ''
    // xUnit names results "Namespace.Class.Method(args)"; show just the method part.
    let name = a.testName ?? method?.name ?? ''
    if (suite && name.startsWith(suite + '.')) name = name.slice(suite.length + 1)
    return {
      id: `${suite}::${name}`,
      name,
      suite,
      outcome: TRX_OUTCOME[a.outcome] ?? 'skipped',
      durationMs: timespan(a.duration),
      message: inner(body, 'Message'),
      stack: inner(body, 'StackTrace')
    }
  })
}

/** Reads JUnit XML (pytest --junitxml, vitest --reporter=junit). */
export function parseJUnit(xml: string): TestCase[] {
  return elements(xml, 'testcase').map(({ attrs: a, body }) => {
    const failure = elements(body, 'failure')[0] ?? elements(body, 'error')[0]
    const skipped = /<skipped\b/.test(body)
    const suite = a.classname || a.file || ''
    const time = Number(a.time)
    return {
      id: `${suite}::${a.name}`,
      name: a.name ?? '',
      suite,
      outcome: failure ? 'failed' : skipped ? 'skipped' : 'passed',
      durationMs: Number.isFinite(time) ? Math.round(time * 1000) : undefined,
      message: failure ? failure.attrs.message || decodeXml(failure.body).trim().split('\n')[0] : undefined,
      stack: failure ? decodeXml(failure.body).trim() : undefined,
      file: a.file,
      line: a.line ? Number(a.line) : undefined
    }
  })
}

/** Reads `jest --json` output. */
export function parseJestJson(text: string): TestCase[] {
  let data: any
  try {
    data = JSON.parse(text)
  } catch {
    return []
  }
  const out: TestCase[] = []
  for (const file of data?.testResults ?? []) {
    for (const t of file.assertionResults ?? []) {
      const suite = [file.name, ...(t.ancestorTitles ?? [])].filter(Boolean).join(' › ')
      const failures: string[] = t.failureMessages ?? []
      out.push({
        id: `${suite}::${t.title}`,
        name: t.title,
        suite,
        outcome: t.status === 'passed' ? 'passed' : t.status === 'failed' ? 'failed' : 'skipped',
        durationMs: typeof t.duration === 'number' ? t.duration : undefined,
        message: failures[0]?.split('\n')[0],
        stack: failures.join('\n\n') || undefined,
        file: file.name,
        line: t.location?.line
      })
    }
  }
  return out
}

/** Reads the text `cargo test` prints. */
export function parseCargoTest(output: string): TestCase[] {
  const lines = output.split(/\r?\n/)
  const failures = new Map<string, string>()
  for (let i = 0; i < lines.length; i++) {
    const head = /^---- (\S+) stdout ----$/.exec(lines[i])
    if (!head) continue
    const body: string[] = []
    for (i++; i < lines.length && !/^---- \S+ stdout ----$/.test(lines[i]) && lines[i] !== 'failures:'; i++) body.push(lines[i])
    i--
    failures.set(head[1], body.join('\n').trim())
  }
  const out: TestCase[] = []
  for (const line of lines) {
    const m = /^test (\S+) \.\.\. (ok|FAILED|ignored)/.exec(line)
    if (!m) continue
    const full = m[1]
    const cut = full.lastIndexOf('::')
    const stack = failures.get(full)
    out.push({
      id: full,
      name: cut >= 0 ? full.slice(cut + 2) : full,
      suite: cut >= 0 ? full.slice(0, cut) : '',
      outcome: m[2] === 'ok' ? 'passed' : m[2] === 'FAILED' ? 'failed' : 'skipped',
      message: stack?.split('\n').find((l) => /panicked|assert/.test(l))?.trim() ?? stack?.split('\n')[0],
      stack
    })
  }
  return out
}

/** Reads the text `go test -v ./...` prints. */
export function parseGoTest(output: string): TestCase[] {
  const lines = output.split(/\r?\n/)
  const logs = new Map<string, string[]>()
  const out: TestCase[] = []
  let current: string | null = null
  let pkg = ''
  const pending: { name: string; outcome: Outcome; durationMs?: number }[] = []
  for (const line of lines) {
    const run = /^=== RUN\s+(\S+)/.exec(line)
    const done = /^\s*--- (PASS|FAIL|SKIP): (\S+) \(([\d.]+)s\)/.exec(line)
    const pkgLine = /^(ok|FAIL)\s+(\S+)\s/.exec(line)
    if (run) {
      current = run[1]
      logs.set(current, [])
    } else if (done) {
      pending.push({ name: done[2], outcome: done[1] === 'PASS' ? 'passed' : done[1] === 'FAIL' ? 'failed' : 'skipped', durationMs: Math.round(Number(done[3]) * 1000) })
    } else if (pkgLine) {
      pkg = pkgLine[2]
      for (const p of pending.splice(0)) {
        const log = (logs.get(p.name) ?? []).join('\n').trim()
        out.push({ id: `${pkg}::${p.name}`, name: p.name, suite: pkg, outcome: p.outcome, durationMs: p.durationMs, message: p.outcome === 'failed' ? log.split('\n')[0]?.trim() : undefined, stack: p.outcome === 'failed' ? log : undefined })
      }
    } else if (current && line.startsWith('    ')) {
      logs.get(current)?.push(line.trim())
    }
  }
  return out
}
