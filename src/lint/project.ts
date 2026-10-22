import { create } from 'zustand'
import { ipc } from '../lib/ipc'
import { joinPath, samePath } from '../lib/paths'
import { useStore } from '../store/store'
import { useSettings } from '../store/settings'
import { mergeConfig, PROJECT_CONFIG_PATH, type LintConfig, type LintOverrides } from './config'
import { defaultConfig } from './rules'

/** The open project's `.whisk/lint.json`, if it has one. */
interface ProjectLint {
  path: string | null
  overrides: LintOverrides | null
  error: string | null
}

export const useProjectLint = create<ProjectLint>(() => ({ path: null, overrides: null, error: null }))

export function projectConfigPath(root: string): string {
  return joinPath(joinPath(root, '.whisk'), 'lint.json')
}

export async function loadProjectLint(root: string | null) {
  if (!root) {
    useProjectLint.setState({ path: null, overrides: null, error: null })
    return
  }
  const path = projectConfigPath(root)
  const state = await ipc.pathState(path)
  if (state === 'missing') {
    useProjectLint.setState({ path: null, overrides: null, error: null })
    return
  }
  try {
    const overrides = JSON.parse(await ipc.readText(path)) as LintOverrides
    useProjectLint.setState({ path, overrides, error: null })
  } catch (e) {
    const error = `${PROJECT_CONFIG_PATH} couldn't be read: ${e instanceof SyntaxError ? e.message : e}`
    useProjectLint.setState({ path, overrides: null, error })
    useStore.getState().toast(error, 'error')
  }
}

export function isProjectConfig(path: string): boolean {
  const root = useStore.getState().root
  return !!root && samePath(path, projectConfigPath(root))
}

/** Defaults, then Settings › Linter: the user's own choices, before any project file. */
export function userLintConfig(lint: LintOverrides = useSettings.getState().lint): LintConfig {
  return mergeConfig(defaultConfig(), lint)
}

/** Defaults, then Settings › Linter, then the project's file. */
export function effectiveLintConfig(): LintConfig {
  return mergeConfig(userLintConfig(), useProjectLint.getState().overrides)
}

/** Writes the current effective rules to the project, so they can be committed and shared. */
export async function createProjectConfig(): Promise<string | null> {
  const root = useStore.getState().root
  if (!root) return null
  const config = effectiveLintConfig()
  const file: LintOverrides = { enabled: config.enabled, rules: config.rules, custom: config.custom, ignore: config.ignore }
  const path = projectConfigPath(root)
  await ipc.writeText(path, JSON.stringify(file, null, 2) + '\n')
  await loadProjectLint(root)
  return path
}
