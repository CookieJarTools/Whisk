import { useEffect, useMemo, useState } from 'react'
import { create } from 'zustand'
import { useStore } from '../store/store'
import { useSettings } from '../store/settings'
import { ipc } from '../lib/ipc'
import { runCommand } from '../lib/runCommand'
import { allServers, attachOpenFiles, type ServerDef } from '../lsp/servers'
import { SERVER_DIRECTORIES, type CustomServer } from '../lsp/catalogue'
import { Icon } from './Icon'

const LOG_LINES = 14

interface InstallState {
  running: boolean
  log: string[]
  code?: number | null
}

/** Install progress per server, kept outside the dialog so it survives closing Settings. */
const useInstalls = create<{ installs: Record<string, InstallState>; patch(key: string, s: Partial<InstallState>): void }>((set) => ({
  installs: {},
  patch: (key, s) =>
    set((st) => ({ installs: { ...st.installs, [key]: { ...(st.installs[key] ?? { running: false, log: [] }), ...s } } }))
}))

async function install(def: ServerDef, onDone: () => void) {
  const { patch } = useInstalls.getState()
  const toast = useStore.getState().toast
  patch(def.key, { running: true, log: [`> ${def.install}`], code: undefined })
  try {
    const code = await runCommand(def.install!, (line) => {
      const log = useInstalls.getState().installs[def.key]?.log ?? []
      patch(def.key, { log: [...log, line].slice(-200) })
    })
    patch(def.key, { running: false, code })
    await ipc.refreshPath()
    const found = await ipc.which(def.command)
    if (code === 0 && found) {
      toast(`${def.label} installed`, 'success')
      attachOpenFiles(def.key)
    } else if (code === 0) {
      toast(`${def.label} installed, but ${def.command} isn't on PATH yet. Restart Whisk to pick it up.`)
    } else {
      toast(`Installing ${def.label} failed (exit ${code}). See the log in Settings.`, 'error')
    }
  } catch (e) {
    patch(def.key, { running: false, code: -1, log: [...(useInstalls.getState().installs[def.key]?.log ?? []), String(e)] })
    toast(`Couldn't run the install for ${def.label}: ${e}`, 'error')
  }
  onDone()
}

function AddServerForm({ onClose }: { onClose: () => void }) {
  const [label, setLabel] = useState('')
  const [command, setCommand] = useState('')
  const [args, setArgs] = useState('')
  const [extensions, setExtensions] = useState('')
  const [installCmd, setInstallCmd] = useState('')
  const exts = extensions.split(/[\s,]+/).map((e) => e.replace(/^\./, '').toLowerCase()).filter(Boolean)
  const valid = label.trim() && command.trim() && exts.length > 0

  const save = () => {
    if (!valid) return
    const server: CustomServer = {
      key: `custom-${label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString(36)}`,
      label: label.trim(),
      command: command.trim(),
      args: args.trim() ? args.trim().split(/\s+/) : [],
      extensions: exts,
      install: installCmd.trim() || undefined
    }
    const { customServers, set } = useSettings.getState()
    set({ customServers: [...customServers, server] })
    onClose()
  }

  return (
    <div className="server-form">
      <div className="server-form-grid">
        <label>Name</label>
        <input className="field" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Elixir LS" />
        <label>Command</label>
        <input className="field" value={command} onChange={(e) => setCommand(e.target.value)} placeholder="e.g. elixir-ls" />
        <label>Arguments</label>
        <input className="field" value={args} onChange={(e) => setArgs(e.target.value)} placeholder="e.g. --stdio" />
        <label>File types</label>
        <input className="field" value={extensions} onChange={(e) => setExtensions(e.target.value)} placeholder="e.g. ex, exs" />
        <label>Install command</label>
        <input className="field" value={installCmd} onChange={(e) => setInstallCmd(e.target.value)} placeholder="Optional, e.g. npm install --global …" />
      </div>
      <p className="set-hint">The server must speak LSP over stdin/stdout. Its project's README usually lists the command and the --stdio flag.</p>
      <div className="server-form-actions">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn btn-primary" disabled={!valid} onClick={save}>
          Add server
        </button>
      </div>
    </div>
  )
}

export function LanguageServers() {
  const status = useStore((s) => s.servers)
  const customCount = useSettings((s) => s.customServers.length)
  const installs = useInstalls((s) => s.installs)
  const [installed, setInstalled] = useState<Record<string, boolean>>({})
  const [prereqs, setPrereqs] = useState<Record<string, boolean>>({})
  const [filter, setFilter] = useState('')
  const [adding, setAdding] = useState(false)
  const [refresh, setRefresh] = useState(0)
  // customCount is a dependency so the list updates when a server is added or removed.
  const servers = useMemo(() => allServers(), [customCount]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    for (const s of servers) ipc.which(s.command).then((p) => setInstalled((i) => ({ ...i, [s.key]: !!p })))
    const programs = new Set(servers.map((s) => s.needs?.program).filter(Boolean) as string[])
    for (const p of programs) ipc.which(p).then((found) => setPrereqs((r) => ({ ...r, [p]: !!found })))
  }, [servers, refresh])

  const q = filter.trim().toLowerCase()
  const shown = servers.filter((s) => !q || `${s.label} ${s.languages} ${s.extensions.join(' ')}`.toLowerCase().includes(q))
  const removeCustom = (key: string) => {
    const { customServers, set } = useSettings.getState()
    set({ customServers: customServers.filter((c) => c.key !== key) })
  }

  const controls = (s: ServerDef) => {
    const job = installs[s.key]
    if (job?.running) return <span className="set-badge">Installing…</span>
    if (installed[s.key]) return <span className="set-badge ok">Installed</span>
    if (s.install && (!s.needs || prereqs[s.needs.program])) {
      return (
        <button className="btn btn-primary" onClick={() => install(s, () => setRefresh((r) => r + 1))}>
          Install
        </button>
      )
    }
    if (s.install && s.needs) {
      return (
        <button className="btn" title={`The install uses ${s.needs.program}`} onClick={() => ipc.openExternal(s.needs!.url)}>
          Get {s.needs.label} <Icon name="external" size={12} />
        </button>
      )
    }
    if (s.needs && !prereqs[s.needs.program]) {
      return (
        <button className="btn" onClick={() => ipc.openExternal(s.needs!.url)}>
          Get {s.needs.label} <Icon name="external" size={12} />
        </button>
      )
    }
    return (
      <button className="btn" onClick={() => ipc.openExternal(s.homepage)}>
        Install guide <Icon name="external" size={12} />
      </button>
    )
  }

  return (
    <>
      <p className="set-note">
        A server starts the first time you open a file it handles, and gives that file suggestions, go-to-definition, find usages and errors.
      </p>
      <div className="set-toolbar">
        <div className="field-with-icon">
          <Icon name="search" size={13} />
          <input className="field" placeholder="Filter by language or file type" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        <button className="btn" onClick={() => setAdding((a) => !a)}>
          <Icon name="plus" size={13} /> Add your own
        </button>
      </div>
      {adding && <AddServerForm onClose={() => setAdding(false)} />}
      {shown.map((s) => {
        const job = installs[s.key]
        const message = status[s.key]?.state === 'ready' || status[s.key]?.state === 'failed' ? status[s.key]?.message : undefined
        return (
          <div key={s.key} className="server-row">
            <div className="set-row">
              <div className="set-text">
                <div className="set-title">
                  {s.label}
                  {s.custom && <span className="set-badge">Yours</span>}
                </div>
                <div className="set-hint">
                  {s.languages} · <code>{[s.command, ...s.args].join(' ')}</code>
                  {message && <> · {message}</>}
                </div>
              </div>
              <div className="set-control server-controls">
                {s.homepage && (
                  <button className="icon-btn" title="Website" onClick={() => ipc.openExternal(s.homepage)}>
                    <Icon name="external" size={13} />
                  </button>
                )}
                {s.custom && (
                  <button className="icon-btn" title="Remove" onClick={() => removeCustom(s.key)}>
                    <Icon name="trash" size={13} />
                  </button>
                )}
                {controls(s)}
              </div>
            </div>
            {job && (job.running || job.code !== 0) && (
              <pre className={`install-log${job.code ? ' failed' : ''}`}>{job.log.slice(-LOG_LINES).join('\n')}</pre>
            )}
          </div>
        )
      })}
      <div className="set-links">
        <span>Looking for another language?</span>
        {SERVER_DIRECTORIES.map((d) => (
          <button key={d.url} className="link-btn" onClick={() => ipc.openExternal(d.url)}>
            {d.label} <Icon name="external" size={11} />
          </button>
        ))}
      </div>
    </>
  )
}
