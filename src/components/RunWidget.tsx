import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore, type MenuItem } from '../store/store'
import { shortcutLabel } from '../keymap/keymap'
import { activeFileConfig, isRunning, loadConfigs, runSelected, saveProjectConfigs, selectConfig, selectedConfig, stopSelected, useRun } from '../run/store'
import type { RunConfig } from '../run/configs'
import { useTerminals } from '../terminal/terminals'
import { startDebugging, useDebug } from '../debug/session'
import { Icon } from './Icon'

/** Rider's run widget in the title bar: pick a configuration, then run, debug or stop it. */
export function RunWidget() {
  const configs = useRun((s) => s.configs)
  const selected = useRun((s) => s.selected)
  const active = useStore((s) => s.active)
  // Re-render when runs start and stop.
  useTerminals((s) => s.terminals)
  useRun((s) => s.running)
  const debugging = useDebug((s) => s.state !== 'idle')
  const [editing, setEditing] = useState(false)

  const root = useStore((s) => s.root)
  if (!root) return null
  const config = selected === 'current-file' ? activeFileConfig() : configs.find((c) => c.id === selected)
  const label = selected === 'current-file' ? (config?.name ?? 'Current file') : (config?.name ?? 'Add configuration…')
  const running = isRunning(config?.id ?? null) || debugging
  void active

  const openMenu = (e: React.MouseEvent) => {
    const r = e.currentTarget.getBoundingClientRect()
    const items: MenuItem[] = []
    const shared = configs.filter((c) => c.source === 'project')
    const found = configs.filter((c) => c.source === 'detected')
    if (shared.length) items.push({ type: 'header', label: 'Shared (.whisk/run.json)' }, ...shared.map((c) => item(c)))
    if (found.length) items.push({ type: 'header', label: 'Found in the project' }, ...found.map((c) => item(c)))
    items.push(
      { type: 'divider' },
      { label: selected === 'current-file' ? '● Current file' : 'Current file', hint: 'Runs the open file', onSelect: () => selectConfig('current-file') },
      { type: 'divider' },
      { label: 'Edit configurations…', onSelect: () => setEditing(true) },
      { label: 'Look for configurations again', onSelect: () => void loadConfigs() }
    )
    useStore.getState().openMenu(r.left, r.bottom + 4, items)
  }

  const item = (c: RunConfig): MenuItem => ({
    label: c.id === selected ? `● ${c.name}` : c.name,
    hint: c.command.length > 36 ? c.command.slice(0, 34) + '…' : c.command,
    onSelect: () => selectConfig(c.id)
  })

  return (
    <div className="run-widget">
      <button className="run-pick" onClick={openMenu} title="Choose what to run">
        <span className="run-pick-label">{label}</span>
        <Icon name="chevronDown" size={11} strokeWidth={2} />
      </button>
      <button
        className="run-btn run"
        title={config && !config.command ? 'This one is for debugging only' : `Run ${shortcutLabel('run.run')}`}
        disabled={!config?.command}
        onClick={() => void runSelected()}
      >
        <Icon name="play" size={12} />
      </button>
      <button
        className="run-btn debug"
        title={config?.debug ? `Debug ${shortcutLabel('run.debug')}` : 'Whisk can’t debug this configuration yet'}
        disabled={!config?.debug || debugging}
        onClick={() => config && void startDebugging(config)}
      >
        <Icon name="bug" size={13} />
      </button>
      {running && (
        <button className="run-btn stop" title={`Stop ${shortcutLabel('run.stop')}`} onClick={() => (debugging ? useDebug.getState().stop() : stopSelected())}>
          <Icon name="stop" size={11} />
        </button>
      )}
      {editing && createPortal(<ConfigDialog onClose={() => setEditing(false)} />, document.body)}
    </div>
  )
}

interface Draft {
  name: string
  command: string
  cwd: string
  env: string
  debug?: RunConfig['debug']
}

const toDraft = (c: RunConfig): Draft => ({
  debug: c.debug,
  name: c.name,
  command: c.command,
  cwd: c.cwd ?? '',
  env: Object.entries(c.env ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')
})

function fromDraft(d: Draft, index: number): RunConfig {
  const env = Object.fromEntries(
    d.env
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.includes('='))
      .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
  )
  return { id: `project:${index}`, name: d.name.trim(), command: d.command.trim(), cwd: d.cwd.trim() || undefined, env, debug: d.debug, source: 'project' }
}

/** Edit configurations: shared ones are saved to .whisk/run.json; found ones can be copied there to change. */
function ConfigDialog({ onClose }: { onClose: () => void }) {
  const configs = useRun((s) => s.configs)
  const [shared, setShared] = useState<Draft[]>(() => configs.filter((c) => c.source === 'project').map(toDraft))
  const found = configs.filter((c) => c.source === 'detected')
  const [index, setIndex] = useState(0)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const current = shared[index]
  const update = (patch: Partial<Draft>) => setShared((list) => list.map((d, i) => (i === index ? { ...d, ...patch } : d)))
  const add = (from?: RunConfig) => {
    setShared((list) => [...list, from ? { ...toDraft(from), name: `${from.name} (copy)` } : { name: 'New configuration', command: '', cwd: '', env: '' }])
    setIndex(shared.length)
  }
  const save = async () => {
    const valid = shared.filter((d) => d.name.trim() && d.command.trim())
    await saveProjectConfigs(valid.map(fromDraft))
    useStore.getState().toast('Saved to .whisk/run.json. Commit it to share with your team.', 'success')
    onClose()
  }

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div className="config-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="settings-body-head">
          <span>Run configurations</span>
          <button className="icon-btn" title="Close (Esc)" onClick={onClose}>
            <Icon name="close" size={13} />
          </button>
        </div>
        <div className="config-main">
          <div className="config-list">
            <div className="config-group">Shared</div>
            {shared.map((d, i) => (
              <button key={i} className={`config-item${i === index ? ' on' : ''}`} onClick={() => setIndex(i)}>
                {d.name || 'Untitled'}
              </button>
            ))}
            <button className="config-item add" onClick={() => add()}>
              <Icon name="plus" size={12} /> New
            </button>
            {found.length > 0 && <div className="config-group">Found in the project</div>}
            {found.map((c) => (
              <button key={c.id} className="config-item found" title="Copy to shared to change it" onClick={() => add(c)}>
                {c.name}
              </button>
            ))}
          </div>
          <div className="config-form">
            {current ? (
              <>
                <label>
                  Name
                  <input value={current.name} onChange={(e) => update({ name: e.target.value })} />
                </label>
                <label>
                  Command
                  <input value={current.command} placeholder="dotnet run --project src/App" onChange={(e) => update({ command: e.target.value })} spellCheck={false} />
                </label>
                <label>
                  Working folder <span className="config-hint">relative to the project; blank for the project folder</span>
                  <input value={current.cwd} onChange={(e) => update({ cwd: e.target.value })} spellCheck={false} />
                </label>
                <label>
                  Environment <span className="config-hint">one NAME=value per line</span>
                  <textarea rows={4} value={current.env} onChange={(e) => update({ env: e.target.value })} spellCheck={false} />
                </label>
                <button
                  className="btn"
                  onClick={() => {
                    setShared((list) => list.filter((_, i) => i !== index))
                    setIndex(Math.max(0, index - 1))
                  }}
                >
                  <Icon name="trash" size={12} /> Remove
                </button>
              </>
            ) : (
              <div className="panel-empty">
                Add a configuration, or copy one Whisk found
                <br />
                to change its command or environment.
              </div>
            )}
          </div>
        </div>
        <div className="config-foot">
          <span className="config-hint">Saved in .whisk/run.json</span>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => void save()}>
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

/** For the keymap: Run and Debug the selected configuration. */
export function debugSelected() {
  const config = selectedConfig()
  if (!config) return useStore.getState().toast('Pick something to run first.')
  if (!config.debug) return useStore.getState().toast(`Whisk can’t debug “${config.name}” yet.`)
  void startDebugging(config)
}
