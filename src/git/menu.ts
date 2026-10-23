import { useStore, type MenuItem } from '../store/store'
import { checkout, fetch, listBranches, pull, push, useGit } from './store'

/** The branch menu from the status bar: pull, push, fetch, and switching or making branches. */
export async function openBranchMenu(x: number, y: number) {
  const branches = await listBranches()
  const busy = !!useGit.getState().busy
  const items: MenuItem[] = [
    { label: 'Pull', onSelect: busy ? undefined : () => void pull() },
    { label: 'Push', onSelect: busy ? undefined : () => void push() },
    { label: 'Fetch', onSelect: busy ? undefined : () => void fetch() },
    { label: 'Commit…', onSelect: () => useStore.getState().setSideView('commit') },
    { type: 'divider' },
    {
      label: 'New branch…',
      onSelect: () => {
        const name = window.prompt('Name for the new branch')?.trim()
        if (name) void checkout(name, true)
      }
    },
    { type: 'header', label: 'Branches' },
    ...branches.map((b) => ({
      label: b.current ? `● ${b.name}` : b.name,
      onSelect: b.current ? undefined : () => void checkout(b.name)
    }))
  ]
  // Open upwards from the status bar.
  useStore.getState().openMenu(x, Math.max(8, y - items.length * 28 - 16), items)
}
