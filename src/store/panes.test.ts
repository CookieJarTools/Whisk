import { beforeAll, describe, expect, it } from 'vitest'

beforeAll(() => {
  const storage = new Map<string, string>()
  ;(globalThis as any).localStorage = {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, v),
    removeItem: (k: string) => void storage.delete(k)
  }
})

const tab = (path: string, pane?: 0 | 1) => ({ path, name: path, initialText: '', pane })

describe('split panes', () => {
  it('moves a tab right, keeps both sides active, and closes the split when the right empties', async () => {
    const { useStore } = await import('./store')
    useStore.setState({ tabs: [tab('a'), tab('b'), tab('c')], paneActive: ['b', null], focusedPane: 0, active: 'b' })

    useStore.getState().moveToPane('b', 1)
    let s = useStore.getState()
    expect(s.paneActive).toEqual(['c', 'b'])
    expect(s.focusedPane).toBe(1)
    expect(s.active).toBe('b')

    useStore.getState().setActive('a')
    s = useStore.getState()
    expect(s.active).toBe('a')
    expect(s.focusedPane).toBe(0)
    expect(s.paneActive).toEqual(['a', 'b'])

    useStore.getState().setActive('b')
    useStore.getState().closeTab('b')
    s = useStore.getState()
    expect(s.tabs.some((t) => t.pane === 1)).toBe(false)
    expect(s.focusedPane).toBe(0)
    expect(s.active).toBe('a')
  })

  it('opens a diff tab in the focused pane and replaces it when reopened', async () => {
    const { useStore } = await import('./store')
    useStore.setState({ tabs: [tab('a')], paneActive: ['a', null], focusedPane: 0, active: 'a' })
    const spec = { leftTitle: 'HEAD', left: 'x', rightTitle: 'Working', right: 'y' }
    useStore.getState().openDiff('git:a', 'a (changes)', spec)
    useStore.getState().openDiff('git:a', 'a (changes)', { ...spec, right: 'z' })
    const s = useStore.getState()
    expect(s.tabs.filter((t) => t.diff)).toHaveLength(1)
    expect(s.active).toBe('diff:git:a')
    expect(s.tabs.find((t) => t.diff)!.diff!.right).toBe('z')
  })
})
