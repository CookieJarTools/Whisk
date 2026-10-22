/**
 * Linter settings. The effective config for a file is: each rule's defaults,
 * then the user's choices in Settings › Linter, then the project's
 * `.whisk/lint.json` if it has one, so a team can share rules through git.
 */

export type Severity = 'off' | 'info' | 'warning' | 'error'

export type OptionValue = number | string | boolean

export interface RuleSetting {
  severity: Severity
  options: Record<string, OptionValue>
}

/** A rule the user writes as a regular expression. */
export interface CustomRule {
  id: string
  pattern: string
  /** Regex flags besides `g`, e.g. `i`. */
  flags?: string
  message: string
  severity: Severity
  /** Only check files matching this mask, e.g. `*.cs, *.ts`. Empty means all. */
  files?: string
}

/** What a user or project file may set; anything left out keeps the layer below. */
export interface LintOverrides {
  enabled?: boolean
  rules?: Record<string, Partial<RuleSetting>>
  custom?: CustomRule[]
  /** Paths not to lint, as globs relative to the project, e.g. `Assets/Plugins/**`. */
  ignore?: string[]
}

export interface LintConfig {
  enabled: boolean
  rules: Record<string, RuleSetting>
  custom: CustomRule[]
  ignore: string[]
}

export const PROJECT_CONFIG_PATH = '.whisk/lint.json'

export const DEFAULT_IGNORE = ['**/node_modules/**', '**/*.min.js', '**/*.g.cs', '**/*.Designer.cs']

/** Layers overrides on top of a config. Rules merge per rule; lists replace. */
export function mergeConfig(base: LintConfig, over: LintOverrides | null | undefined): LintConfig {
  if (!over) return base
  const rules = { ...base.rules }
  for (const [id, setting] of Object.entries(over.rules ?? {})) {
    const current = rules[id] ?? { severity: 'off', options: {} }
    rules[id] = {
      severity: setting.severity ?? current.severity,
      options: { ...current.options, ...(setting.options ?? {}) }
    }
  }
  return {
    enabled: over.enabled ?? base.enabled,
    rules,
    custom: over.custom ?? base.custom,
    ignore: over.ignore ?? base.ignore
  }
}

/** Glob → RegExp: `**` spans folders, `*` and `?` stay within one. Patterns without a `/` match the file name. */
export function globToRegExp(glob: string): RegExp {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i]
    if (ch === '*' && glob[i + 1] === '*') {
      const slash = glob[i + 2] === '/'
      re += slash ? '(?:.*/)?' : '.*'
      i += slash ? 2 : 1
    } else if (ch === '*') re += '[^/]*'
    else if (ch === '?') re += '[^/]'
    else re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`, 'i')
}

/** Does a project-relative path (either slash direction) match any of the globs or comma-separated masks? */
export function matchesAny(relativePath: string, globs: string[]): boolean {
  const path = relativePath.replace(/\\/g, '/')
  const name = path.slice(path.lastIndexOf('/') + 1)
  return globs
    .flatMap((g) => g.split(','))
    .map((g) => g.trim())
    .filter(Boolean)
    .some((g) => globToRegExp(g).test(g.includes('/') ? path : name))
}
