import { open } from '@tauri-apps/plugin-dialog'
import { useStore } from '../store/store'
import { useSettings } from '../store/settings'
import { shortcutLabel } from '../keymap/keymap'
import { Icon } from './Icon'

export async function pickFolder() {
  const picked = await open({ directory: true, multiple: false, title: 'Open folder' })
  if (typeof picked === 'string') useStore.getState().openFolder(picked)
}

const TIPS: [string, string][] = [
  ['search.everywhere', 'Search everywhere'],
  ['search.text', 'Find in files'],
  ['nav.file', 'Go to file'],
  ['app.actions', 'Find action'],
  ['nav.definition', 'Go to definition'],
  ['app.settings', 'Settings']
]

export function Welcome() {
  const recent = useStore((s) => s.recent)
  const openFolder = useStore((s) => s.openFolder)
  // Re-render when the keymap changes so the tips show the current shortcuts.
  useSettings((s) => s.keymapPreset + JSON.stringify(s.keyOverrides))
  return (
    <div className="welcome">
      <div className="welcome-inner">
        <div className="brand-mark">
          <Icon name="logo" size={24} strokeWidth={1.8} />
        </div>
        <h1>Whisk</h1>
        <p>A small editor for reading and writing code. Open a folder, or start a new project.</p>
        <div className="welcome-actions">
          <button className="btn btn-primary" onClick={pickFolder}>
            <Icon name="folderOpen" size={14} /> Open folder…
          </button>
          <button className="btn" onClick={() => useStore.getState().setWizardOpen(true)}>
            <Icon name="template" size={14} /> New project…
          </button>
        </div>
        {recent.length > 0 && (
          <div className="welcome-list">
            <div className="welcome-label">Recent</div>
            {recent.map((p) => (
              <button key={p} className="welcome-recent" title={p} onClick={() => openFolder(p)}>
                {p}
              </button>
            ))}
          </div>
        )}
        <div className="keys">
          {TIPS.map(([id, label]) => {
            const key = shortcutLabel(id)
            return key ? (
              <span key={id} style={{ display: 'contents' }}>
                <span className="kbd">{key}</span>
                <span>{label}</span>
              </span>
            ) : null
          })}
        </div>
      </div>
    </div>
  )
}
