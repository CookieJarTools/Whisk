import { beforeAll, describe, expect, it } from 'vitest'

// A stand-in for the browser's localStorage, installed before the stores load.
const storage = new Map<string, string>()
beforeAll(() => {
  ;(globalThis as any).localStorage = {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, v),
    removeItem: (k: string) => void storage.delete(k)
  }
  ;(globalThis as any).window = { setTimeout, clearTimeout, addEventListener: () => {} }
})

describe('session', () => {
  it('saves open tabs per folder, including the folder being left', async () => {
    const { useStore } = await import('../store/store')
    const { installSessionSaving, loadSession, saveSession } = await import('./session')
    installSessionSaving()

    useStore.setState({ root: 'F:\\Game', tabs: [], active: null })
    useStore.setState({
      tabs: [
        { path: 'F:\\Game\\A.cs', name: 'A.cs', initialText: '' },
        { path: 'F:\\Game\\B.cs', name: 'B.cs', initialText: '' }
      ],
      active: 'F:\\Game\\B.cs'
    })
    saveSession()
    expect(loadSession('f:/game')).toEqual({
      tabs: [
        { path: 'F:\\Game\\A.cs', line: 1, col: 0 },
        { path: 'F:\\Game\\B.cs', line: 1, col: 0 }
      ],
      active: 'F:\\Game\\B.cs'
    })

    // Change the tabs, then switch folder before the delayed save fires.
    useStore.setState({ tabs: [{ path: 'F:\\Game\\C.cs', name: 'C.cs', initialText: '' }], active: 'F:\\Game\\C.cs' })
    useStore.setState({ root: 'F:\\Other', tabs: [], active: null })
    expect(loadSession('F:\\Game')?.active).toBe('F:\\Game\\C.cs')
    expect(loadSession('F:\\Other')).toBeNull()
  })
})
