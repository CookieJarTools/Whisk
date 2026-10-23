import { create } from 'zustand'

/** The bottom panel under the editor: terminals, program output, tests and the debugger. */

export type PanelView = 'terminal' | 'run' | 'tests' | 'debug'

const HEIGHT_KEY = 'whisk.panelHeight'

function savedHeight(): number {
  try {
    return Number(localStorage.getItem(HEIGHT_KEY)) || 260
  } catch {
    return 260
  }
}

interface PanelState {
  open: boolean
  view: PanelView
  height: number
  show(view: PanelView): void
  /** Opens the panel on `view`, or closes it when that view is already showing. */
  toggle(view: PanelView): void
  close(): void
  setHeight(height: number): void
}

export const usePanel = create<PanelState>((set, get) => ({
  open: false,
  view: 'terminal',
  height: savedHeight(),
  show: (view) => set({ open: true, view }),
  toggle: (view) => set(get().open && get().view === view ? { open: false } : { open: true, view }),
  close: () => set({ open: false }),
  setHeight(height) {
    try {
      localStorage.setItem(HEIGHT_KEY, String(height))
    } catch {
      // Not remembered; nothing else changes.
    }
    set({ height })
  }
}))
