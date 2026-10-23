import { getCurrentWindow } from '@tauri-apps/api/window'
import { RunWidget } from './RunWidget'
import { useStore, type MenuItem } from '../store/store'
import { useSettings } from '../store/settings'
import { baseName, samePath } from '../lib/paths'
import { Icon } from './Icon'
import { pickFolder } from './Welcome'
import { shortcutLabel } from '../keymap/keymap'

/** Linear-style workspace menu: the open folder, with folder actions behind it. */
function WorkspaceSwitcher() {
  const root = useStore((s) => s.root)
  const openMenu = useStore((s) => s.openMenu)

  const showMenu = (e: React.MouseEvent<HTMLButtonElement>) => {
    const { recent, showHidden, setShowHidden, refreshTree, closeFolder, openFolder } = useStore.getState()
    const others = recent.filter((p) => !root || !samePath(p, root))
    const items: MenuItem[] = [
      { label: 'New project…', onSelect: () => useStore.getState().setWizardOpen(true) },
      { label: 'Open folder…', onSelect: pickFolder }
    ]
    if (others.length) {
      items.push({ type: 'divider' }, { type: 'header', label: 'Recent' })
      for (const p of others.slice(0, 6)) items.push({ label: baseName(p), hint: p, onSelect: () => openFolder(p) })
    }
    if (root) {
      items.push(
        { type: 'divider' },
        { label: 'Show hidden files', hint: showHidden ? '✓' : '', onSelect: () => setShowHidden(!showHidden) },
        { label: 'Refresh explorer', onSelect: refreshTree },
        { label: 'Close folder', onSelect: closeFolder }
      )
    }
    items.push({ type: 'divider' }, { label: 'Settings…', hint: shortcutLabel('app.settings'), onSelect: () => useStore.getState().setSettingsOpen(true) })
    const rect = e.currentTarget.getBoundingClientRect()
    openMenu(rect.left, rect.bottom + 4, items)
  }

  return (
    <button className="workspace" onClick={showMenu}>
      <span className="workspace-mark">{root ? baseName(root).charAt(0).toUpperCase() : 'S'}</span>
      <span className="workspace-name">{root ? baseName(root) : 'Whisk'}</span>
      <Icon name="chevronDown" size={12} strokeWidth={2} className="workspace-chev" />
    </button>
  )
}

export function TitleBar() {
  const docked = useSettings((s) => !s.hideExplorer)
  const width = useStore((s) => (s.root && docked ? s.sidebarWidth : 0))
  const win = getCurrentWindow()
  return (
    <div className="titlebar" data-tauri-drag-region>
      <div className="tb-left" style={{ width: width || undefined }} data-tauri-drag-region>
        <WorkspaceSwitcher />
      </div>
      <div className="tb-spacer" data-tauri-drag-region />
      <RunWidget />
      <div className="tb-win">
        <button title="Minimise" onClick={() => win.minimize()}>
          <Icon name="winMin" size={13} />
        </button>
        <button title="Maximise" onClick={() => win.toggleMaximize()}>
          <Icon name="winMax" size={11} />
        </button>
        <button className="close" title="Close" onClick={() => win.close()}>
          <Icon name="close" size={13} />
        </button>
      </div>
    </div>
  )
}
