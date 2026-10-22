import { forEachDiagnostic, lintGutter, setDiagnosticsEffect, type Action, type Diagnostic } from '@codemirror/lint'
import { ViewPlugin, type EditorView, type ViewUpdate } from '@codemirror/view'
import { useSettings } from '../store/settings'
import { useStore } from '../store/store'
import { extension, relativePath } from '../lib/paths'
import { lensPath } from '../editor/codeLens'
import { scopeField } from '../editor/scopes'
import { allViews } from '../editor/views'
import { publishDiagnostics, WHISK_SOURCE } from './diagnostics'
import { effectiveLintConfig, useProjectLint } from './project'
import { runLint, type LintResult } from './rules'

/** Runs Whisk's lint rules a moment after typing stops, and on config changes. */

const LINT_DELAY_MS = 400

function turnOffAction(result: LintResult): Action {
  return {
    name: 'Turn off rule',
    apply: () => {
      const { lint, set } = useSettings.getState()
      if (result.ruleId.startsWith('custom:')) {
        const id = result.ruleId.slice('custom:'.length)
        set({ lint: { ...lint, custom: (lint.custom ?? []).map((c) => (c.id === id ? { ...c, severity: 'off' } : c)) } })
      } else {
        set({ lint: { ...lint, rules: { ...lint.rules, [result.ruleId]: { ...lint.rules?.[result.ruleId], severity: 'off' } } } })
      }
      useStore.getState().toast(`Turned off “${result.ruleTitle}”. Turn it back on in Settings › Linter.`)
    }
  }
}

function toDiagnostic(result: LintResult): Diagnostic {
  const actions: Action[] = []
  if (result.fix) {
    const { insert, label } = result.fix
    actions.push({ name: label, apply: (view, from, to) => view.dispatch({ changes: { from, to, insert } }) })
  }
  actions.push(turnOffAction(result))
  return {
    from: result.from,
    to: result.to,
    severity: result.severity,
    message: result.message,
    source: WHISK_SOURCE,
    renderMessage: () => {
      const el = document.createElement('span')
      el.textContent = result.message
      const rule = document.createElement('span')
      rule.className = 'cm-lint-rule'
      rule.textContent = result.ruleTitle
      el.append(' ', rule)
      return el
    },
    actions
  }
}

export function lintView(view: EditorView) {
  const path = view.state.facet(lensPath)
  const results = runLint(
    {
      doc: view.state.doc,
      path: relativePath(useStore.getState().root, path),
      extension: extension(path),
      scope: view.state.field(scopeField, false) ?? null,
      tabSize: view.state.tabSize
    },
    effectiveLintConfig()
  )
  publishDiagnostics(view, 'whisk', results.map(toDiagnostic))
}

const lintRunner = ViewPlugin.fromClass(
  class {
    private timer = 0
    constructor(readonly view: EditorView) {
      this.schedule(0)
    }
    update(update: ViewUpdate) {
      if (update.docChanged) this.schedule(LINT_DELAY_MS)
    }
    schedule(delay: number) {
      clearTimeout(this.timer)
      this.timer = window.setTimeout(() => lintView(this.view), delay)
    }
    destroy() {
      clearTimeout(this.timer)
    }
  }
)

/** Errors, warnings and notes in an editor, for the status bar. */
export function countProblems(view: EditorView): { errors: number; warnings: number; infos: number } {
  const counts = { errors: 0, warnings: 0, infos: 0 }
  forEachDiagnostic(view.state, (d) => {
    if (d.severity === 'error') counts.errors++
    else if (d.severity === 'warning') counts.warnings++
    else counts.infos++
  })
  return counts
}

export function diagnosticsChanged(update: ViewUpdate): boolean {
  return update.transactions.some((tr) => tr.effects.some((e) => e.is(setDiagnosticsEffect)))
}

export const lintExtension = [lintRunner, lintGutter()]

// Re-lint every open editor when the rules change, in Settings or in the project file.
useSettings.subscribe((s, prev) => {
  if (s.lint !== prev.lint) allViews().forEach(lintView)
})
useProjectLint.subscribe(() => allViews().forEach(lintView))
