import { ipc } from './ipc'

/**
 * Errors go to the console and to `~/.whisk/logs/whisk.log`, so problems in
 * installed builds (which have no developer tools) can still be diagnosed.
 */

function describe(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}\n${error.stack ?? ''}`
  return String(error)
}

export function logError(context: string, error: unknown, extra?: string) {
  console.error(`[${context}]`, error)
  const line = `${new Date().toISOString()} [${context}] ${describe(error)}${extra ? `\n${extra}` : ''}`
  ipc.appendLog(line).catch(() => {})
}

let installed = false

/** Catches errors that escape everything else: uncaught exceptions and rejected promises. */
export function installErrorLogging() {
  if (installed) return
  installed = true
  window.addEventListener('error', (e) => logError('uncaught', e.error ?? e.message))
  window.addEventListener('unhandledrejection', (e) => logError('unhandled rejection', e.reason))
}
