import { create } from 'zustand'
import { useStore } from '../store/store'
import type { RunConfig } from '../run/configs'

/** The debug session. (The debugger itself arrives in the next change.) */

interface DebugState {
  state: 'idle' | 'starting' | 'running' | 'paused'
  stop(): void
}

export const useDebug = create<DebugState>(() => ({ state: 'idle', stop: () => {} }))

export async function startDebugging(config: RunConfig) {
  useStore.getState().toast(`Debugging “${config.name}” isn’t available yet.`)
}
