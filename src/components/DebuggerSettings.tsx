import { useEffect, useState } from 'react'
import { useStore } from '../store/store'
import { useSettings } from '../store/settings'
import { ipc } from '../lib/ipc'
import { runCommand } from '../lib/runCommand'
import { BUILT_IN_ADAPTERS, type AdapterDef, type CustomDebugger } from '../debug/adapters'
import { shortcutLabel } from '../keymap/keymap'
import { Icon } from './Icon'

/**
 * Settings › Debuggers: the built-in debug adapters with one-click installs,
 * and your own for any other language (any adapter that speaks DAP over stdio).
 */

const DEFAULT_LAUNCH = `{
  "type": "my-language",
  "program": "\${file}",
  "cwd": "\${workspaceFolder}"
}`

function AddDebuggerForm({ onClose }: { onClose: () => void }) {
  const [label, setLabel] = useState('')
  const [command, setCommand] = useState('')
  const [args, setArgs] = useState('')
  const [extensions, setExtensions] = useState('')
  const [launch, setLaunch] = useState(DEFAULT_LAUNCH)
  const exts = extensions.split(/[\s,]+/).map((e) => e.replace(/^\./, '').toLowerCase()).filter(Boolean)
  let launchOk = true
  try {
    JSON.parse(launch.replace(/\$\{\w+\}/g, 'x'))
  } catch {
    launchOk = false
  }
  const valid = label.trim() && command.trim() && launchOk

  const save = () => {
    if (!valid) return
    const debuggerDef: CustomDebugger = {
      id: `custom-${label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      label: label.trim(),
      command: command.trim(),
      args: args.trim() ? args.trim().split(/\s+/) : [],
      extensions: exts,
      launch
    }
    const { customDebuggers, set } = useSettings.getState()
    set({ customDebuggers: [...customDebuggers.filter((d) => d.id !== debuggerDef.id), debuggerDef] })
    onClose()
  }

  return (
    <div className="server-form">
      <div className="server-form-grid">
        <label>Name</label>
        <input className="field" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Lua (local-lua-debugger)" />
        <label>Command</label>
        <input className="field" value={command} onChange={(e) => setCommand(e.target.value)} placeholder="The adapter program" />
        <label>Arguments</label>
        <input className="field" value={args} onChange={(e) => setArgs(e.target.value)} placeholder="Optional" />
        <label>File types</label>
        <input className="field" value={extensions} onChange={(e) => setExtensions(e.target.value)} placeholder="For “Current file”, e.g. lua" />
        <label>Launch</label>
        <textarea className={`field launch-field${launchOk ? '' : ' bad'}`} rows={6} value={launch} onChange={(e) => setLaunch(e.target.value)} spellCheck={false} />
      </div>
      <p className="set-hint">
        The adapter must speak the Debug Adapter Protocol over stdin/stdout. “Launch” is what Whisk sends to start the program; its README lists the
        fields. <code>{'${file}'}</code>, <code>{'${fileDirname}'}</code> and <code>{'${workspaceFolder}'}</code> are filled in.
      </p>
      <div className="server-form-actions">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn btn-primary" disabled={!valid} onClick={save}>
          Add debugger
        </button>
      </div>
    </div>
  )
}

export function DebuggerSettings() {
  const custom = useSettings((s) => s.customDebuggers)
  const [ready, setReady] = useState<Record<string, boolean | undefined>>({})
  const [prereqs, setPrereqs] = useState<Record<string, boolean>>({})
  const [installing, setInstalling] = useState<Record<string, string[] | undefined>>({})
  const [failed, setFailed] = useState<Record<string, boolean>>({})
  const [adding, setAdding] = useState(false)
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    for (const a of BUILT_IN_ADAPTERS) {
      void a.resolve().then((r) => setReady((s) => ({ ...s, [a.type]: !!r })))
      if (a.prerequisite) void ipc.which(a.prerequisite.program).then((p) => setPrereqs((s) => ({ ...s, [a.prerequisite!.program]: !!p })))
    }
    for (const c of custom) void ipc.which(c.command).then((p) => setReady((s) => ({ ...s, [c.id]: !!p })))
  }, [custom, refresh])

  const install = async (a: AdapterDef) => {
    const command = await a.install!()
    const log = [`> ${command}`]
    setInstalling((s) => ({ ...s, [a.type]: [...log] }))
    setFailed((s) => ({ ...s, [a.type]: false }))
    const code = await runCommand(command, (line) => {
      log.push(line)
      setInstalling((s) => ({ ...s, [a.type]: [...log] }))
    })
    await ipc.refreshPath()
    setInstalling((s) => ({ ...s, [a.type]: code === 0 ? undefined : log }))
    setFailed((s) => ({ ...s, [a.type]: code !== 0 }))
    useStore.getState().toast(code === 0 ? `${a.label} installed.` : `Installing ${a.label} failed. The log is in Settings › Debuggers.`, code === 0 ? 'success' : 'error')
    setRefresh((r) => r + 1)
  }

  const getPrerequisite = (a: AdapterDef) => (
    <button className="btn" onClick={() => ipc.openExternal(a.prerequisite!.url)}>
      Get {a.prerequisite!.label} <Icon name="external" size={12} />
    </button>
  )

  const controls = (a: AdapterDef) => {
    if (a.bundled) return a.prerequisite && prereqs[a.prerequisite.program] === false ? getPrerequisite(a) : <span className="set-badge ok">Comes with Whisk</span>
    if (installing[a.type] && !failed[a.type]) return <span className="set-badge">Installing…</span>
    if (ready[a.type]) return <span className="set-badge ok">Installed</span>
    if (ready[a.type] === undefined) return <span className="set-badge">Checking…</span>
    if (a.prerequisite && !prereqs[a.prerequisite.program]) return getPrerequisite(a)
    if (!a.install) {
      return (
        <button className="btn" onClick={() => ipc.openExternal(a.homepage)}>
          Install guide <Icon name="external" size={12} />
        </button>
      )
    }
    return (
      <button className="btn btn-primary" onClick={() => void install(a)}>
        Install
      </button>
    )
  }

  return (
    <>
      <p className="set-note">
        Debug with the bug button at the top{shortcutLabel('run.debug') ? ` (${shortcutLabel('run.debug')})` : ''}. Click in the gutter left of the line numbers to set a breakpoint;
        right-click one to give it a condition.
      </p>
      <div className="set-toolbar">
        <div className="set-hint" style={{ flex: 1 }}>
          Built in: C#, Unity, Python, and C, C++ and Rust. Add any other debugger that speaks the Debug Adapter Protocol.
        </div>
        <button className="btn" onClick={() => setAdding((a) => !a)}>
          <Icon name="plus" size={13} /> Add your own
        </button>
      </div>
      {adding && <AddDebuggerForm onClose={() => setAdding(false)} />}
      {BUILT_IN_ADAPTERS.map((a) => (
        <div key={a.type} className="server-row">
          <div className="set-row">
            <div className="set-text">
              <div className="set-title">{a.label}</div>
              <div className="set-hint">{a.languages}</div>
            </div>
            <div className="set-control server-controls">
              <button className="icon-btn" title="Website" onClick={() => ipc.openExternal(a.homepage)}>
                <Icon name="external" size={13} />
              </button>
              {controls(a)}
            </div>
          </div>
          {installing[a.type] && <pre className={`install-log${failed[a.type] ? ' failed' : ''}`}>{installing[a.type]!.slice(-14).join('\n')}</pre>}
        </div>
      ))}
      {custom.map((c) => (
        <div key={c.id} className="server-row">
          <div className="set-row">
            <div className="set-text">
              <div className="set-title">
                {c.label} <span className="set-badge">Yours</span>
              </div>
              <div className="set-hint">
                {c.extensions.length ? c.extensions.map((e) => `.${e}`).join(', ') : 'Run configurations with debug.type'} · <code>{[c.command, ...c.args].join(' ')}</code> ·
                type <code>{c.id}</code>
              </div>
            </div>
            <div className="set-control server-controls">
              <button
                className="icon-btn"
                title="Remove"
                onClick={() => useSettings.getState().set({ customDebuggers: custom.filter((d) => d.id !== c.id) })}
              >
                <Icon name="trash" size={13} />
              </button>
              {ready[c.id] ? <span className="set-badge ok">Found</span> : <span className="set-badge">Not on PATH</span>}
            </div>
          </div>
        </div>
      ))}
      <div className="set-links">
        <span>Looking for another language?</span>
        <button className="link-btn" onClick={() => ipc.openExternal('https://microsoft.github.io/debug-adapter-protocol/implementors/adapters/')}>
          Debug adapters list <Icon name="external" size={11} />
        </button>
      </div>
    </>
  )
}
