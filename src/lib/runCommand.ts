import { listen } from '@tauri-apps/api/event'
import { ipc } from './ipc'

let nextId = 1

/**
 * Runs a shell command line (in `cwd` if given), calling `onLine` for each line
 * of output. Resolves with the exit code, or null if the process couldn't report one.
 * `onStart` gets the id `ipc.killCommand` takes to stop it.
 */
export async function runCommand(
  commandLine: string,
  onLine: (line: string) => void,
  cwd?: string,
  onStart?: (id: number) => void
): Promise<number | null> {
  const id = nextId++
  let finish: (code: number | null) => void = () => {}
  const exited = new Promise<number | null>((resolve) => (finish = resolve))
  const stopOutput = await listen<{ id: number; line: string }>('install-output', (e) => {
    if (e.payload.id === id) onLine(e.payload.line)
  })
  const stopExit = await listen<{ id: number; code: number | null }>('install-exit', (e) => {
    if (e.payload.id === id) finish(e.payload.code)
  })
  try {
    await ipc.runCommand(id, commandLine, cwd)
    onStart?.(id)
    return await exited
  } finally {
    stopOutput()
    stopExit()
  }
}
