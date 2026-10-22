import { useEffect, useState, type ReactNode } from 'react'
import { useStore } from '../store/store'
import { FONT_SIZES, isCompact, useSettings } from '../store/settings'
import { LanguageServers } from './LanguageServers'
import { KeymapSettings } from './KeymapSettings'
import { UpdatesSettings } from './UpdatesSettings'
import { LinterSettings } from './LinterSettings'
import { shortcutLabel } from '../keymap/keymap'
import { ide, openPluginsFolder, usePlugins } from '../plugins/host'
import { Icon } from './Icon'

type Section = 'layout' | 'editor' | 'keymap' | 'linter' | 'claude' | 'languages' | 'plugins' | 'updates'

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'layout', label: 'Layout' },
  { id: 'editor', label: 'Editor' },
  { id: 'keymap', label: 'Keymap' },
  { id: 'linter', label: 'Linter' },
  { id: 'claude', label: 'Claude' },
  { id: 'languages', label: 'Language servers' },
  { id: 'plugins', label: 'Plugins' },
  { id: 'updates', label: 'Updates' }
]

function Row({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="set-row">
      <div className="set-text">
        <div className="set-title">{title}</div>
        {hint && <div className="set-hint">{hint}</div>}
      </div>
      <div className="set-control">{children}</div>
    </div>
  )
}

function Toggle({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button className={`toggle${on ? ' on' : ''}`} role="switch" aria-checked={on} onClick={() => onChange(!on)}>
      <span />
    </button>
  )
}

function Layout() {
  const s = useSettings()
  const showHidden = useStore((st) => st.showHidden)
  const setShowHidden = useStore((st) => st.setShowHidden)
  return (
    <>
      <Row title="Compact mode" hint={`Hide the title bar and explorer until the mouse touches the window edge. ${shortcutLabel('view.compact')}`}>
        <Toggle on={isCompact(s)} onChange={() => s.toggleCompact()} />
      </Row>
      <Row title="Auto-hide title bar" hint={`Slides in from the top edge. ${shortcutLabel('view.titlebar')}`}>
        <Toggle on={s.hideTitleBar} onChange={(v) => s.set({ hideTitleBar: v })} />
      </Row>
      <Row title="Auto-hide explorer" hint={`Slides in from the left edge. ${shortcutLabel('view.explorer')}`}>
        <Toggle on={s.hideExplorer} onChange={(v) => s.set({ hideExplorer: v })} />
      </Row>
      <Row title="Show hidden files" hint="Unity .meta files, .csproj/.sln and logs in the explorer">
        <Toggle on={showHidden} onChange={setShowHidden} />
      </Row>
    </>
  )
}

function Editor() {
  const s = useSettings()
  const clamp = (v: number) => Math.min(FONT_SIZES.max, Math.max(FONT_SIZES.min, v))
  return (
    <>
      <Row title="Font size" hint="Editor text, in px">
        <div className="stepper">
          <button onClick={() => s.set({ editorFontSize: clamp(s.editorFontSize - FONT_SIZES.step) })}>−</button>
          <span>{s.editorFontSize}</span>
          <button onClick={() => s.set({ editorFontSize: clamp(s.editorFontSize + FONT_SIZES.step) })}>+</button>
        </div>
      </Row>
      <Row title="Word wrap" hint="Markdown always wraps">
        <Toggle on={s.wordWrap} onChange={(v) => s.set({ wordWrap: v })} />
      </Row>
      <Row title="Scope rails" hint="Lanes down the left of each block, lit around the cursor">
        <Toggle on={s.scopeRails} onChange={(v) => s.set({ scopeRails: v })} />
      </Row>
      <Row title="Action row above declarations" hint="Plugin actions like “✦ Ask Claude · + context”">
        <Toggle on={s.codeLens} onChange={(v) => s.set({ codeLens: v })} />
      </Row>
    </>
  )
}

function Claude() {
  const [target, setTarget] = useState(() => ide.settings.get<'desktop' | 'code'>('claude.target', 'desktop'))
  const choose = (t: 'desktop' | 'code') => {
    ide.settings.set('claude.target', t)
    setTarget(t)
  }
  return (
    <Row title="Send code to" hint="Where “Ask Claude” goes. Claude Code needs the `claude` command on PATH.">
      <div className="seg">
        <button className={target === 'desktop' ? 'on' : ''} onClick={() => choose('desktop')}>
          Desktop app
        </button>
        <button className={target === 'code' ? 'on' : ''} onClick={() => choose('code')}>
          Claude Code
        </button>
      </div>
    </Row>
  )
}

function Plugins() {
  const plugins = usePlugins((s) => s.loaded)
  return (
    <>
      {plugins.map((p) => (
        <Row key={p.id} title={p.name} hint={p.source === 'built-in' ? 'Built in' : 'From your plugins folder'}>
          <span className="set-badge ok">Loaded</span>
        </Row>
      ))}
      <Row title="Plugins folder" hint="~/.whisk/plugins/<name>/plugin.js, loaded at start-up">
        <button className="btn" onClick={() => openPluginsFolder()}>
          Open folder
        </button>
      </Row>
    </>
  )
}

const BODIES: Record<Section, () => ReactNode> = {
  layout: Layout,
  editor: Editor,
  claude: Claude,
  keymap: KeymapSettings,
  linter: LinterSettings,
  languages: LanguageServers,
  plugins: Plugins,
  updates: UpdatesSettings
}

export function SettingsDialog() {
  const open = useStore((s) => s.settingsOpen)
  const setOpen = useStore((s) => s.setSettingsOpen)
  const requested = useStore((s) => s.settingsSection)
  const [section, setSection] = useState<Section>('layout')

  useEffect(() => {
    if (open && requested && SECTIONS.some((s) => s.id === requested)) setSection(requested as Section)
  }, [open, requested])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setOpen])

  if (!open) return null
  const Body = BODIES[section]
  return (
    <div className="palette-backdrop settings-backdrop" onMouseDown={() => setOpen(false)}>
      <div className="settings" onMouseDown={(e) => e.stopPropagation()}>
        <nav className="settings-nav">
          <div className="settings-heading">Settings</div>
          {SECTIONS.map((s) => (
            <button key={s.id} className={`settings-tab${section === s.id ? ' active' : ''}`} onClick={() => setSection(s.id)}>
              {s.label}
            </button>
          ))}
        </nav>
        <section className="settings-body">
          <div className="settings-body-head">
            <span>{SECTIONS.find((s) => s.id === section)!.label}</span>
            <button className="icon-btn" title="Close (Esc)" onClick={() => setOpen(false)}>
              <Icon name="close" size={13} />
            </button>
          </div>
          <Body />
        </section>
      </div>
    </div>
  )
}
