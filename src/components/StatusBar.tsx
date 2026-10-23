import { useStore } from '../store/store'
import { languageFor } from '../lib/languages'
import { serverFor } from '../lsp/servers'
import { openPluginsFolder, usePlugins } from '../plugins/host'
import { Icon } from './Icon'
import { nextDiagnostic } from '@codemirror/lint'
import { getView } from '../editor/views'
import { shortcutLabel } from '../keymap/keymap'
import { installUpdate, useUpdates } from '../updates/updates'
import { useGit } from '../git/store'
import { openBranchMenu } from '../git/menu'

export function StatusBar() {
  const active = useStore((s) => s.active)
  const cursor = useStore((s) => s.cursor)
  const servers = useStore((s) => s.servers)
  const toast = useStore((s) => s.toast)
  const lang = active ? languageFor(active) : null
  const serverDef = active ? serverFor(active) : null
  const server = serverDef ? servers[serverDef.key] : undefined
  const plugins = usePlugins((s) => s.loaded)
  const problems = useStore((s) => (s.active ? s.problems[s.active] : undefined))
  const update = useUpdates((s) => (s.phase === 'ready' ? s.info?.version : null))

  return (
    <footer className="statusbar">
      {serverDef && (
        <button
          className="sb-item"
          title={server?.message ?? serverDef.label}
          onClick={() =>
            server?.state === 'missing' || server?.state === 'failed'
              ? useStore.getState().setSettingsOpen(true, 'languages')
              : toast(server?.message ?? `${serverDef.label} starts when you open a ${lang!.label} file.`)
          }
        >
          <span className={`sb-dot ${server?.state ?? ''}`} />
          {server?.state === 'missing' ? `${serverDef.label} not installed` : (server?.message ?? serverDef.label)}
        </button>
      )}
      {problems && problems.errors + problems.warnings + problems.infos > 0 && (
        <button
          className="sb-item sb-problems"
          title={`Next problem (${shortcutLabel('problems.next')}) · list them (${shortcutLabel('problems.list') || 'Find action'})`}
          onClick={() => {
            const view = getView(active)
            if (view) nextDiagnostic(view)
            view?.focus()
          }}
        >
          {problems.errors > 0 && <span className="sb-err">● {problems.errors}</span>}
          {problems.warnings > 0 && <span className="sb-warn">▲ {problems.warnings}</span>}
          {problems.infos > 0 && <span className="sb-info">◆ {problems.infos}</span>}
        </button>
      )}
      <div className="sb-spacer" />
      <BranchChip />
      {update && (
        <button className="sb-item sb-update" title="Restart Whisk to install the update" onClick={() => installUpdate()}>
          <Icon name="download" size={12} /> Restart to update to {update}
        </button>
      )}
      <button
        className="sb-item"
        title={plugins.map((p) => `${p.name} (${p.source})`).join('\n') + '\n\nClick to open the plugins folder'}
        onClick={() => openPluginsFolder()}
      >
        <Icon name="plug" size={12} /> {plugins.length} plugin{plugins.length === 1 ? '' : 's'}
      </button>
      {cursor && active && <span className="sb-item">Ln {cursor.line}, Col {cursor.col}</span>}
      {lang && <span className="sb-item">{lang.label}</span>}
      <span className="sb-item">UTF-8</span>
      <button className="sb-item" title="Settings (Ctrl+,)" onClick={() => useStore.getState().setSettingsOpen(true)}>
        <Icon name="settings" size={12} />
      </button>
    </footer>
  )
}

function BranchChip() {
  const status = useGit((s) => s.status)
  const busy = useGit((s) => s.busy)
  if (!status) return null
  return (
    <button
      className="sb-item"
      title={status.upstream ? `Tracking ${status.upstream}. Click for pull, push and branches.` : 'Click for pull, push and branches.'}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        void openBranchMenu(r.left, r.top)
      }}
    >
      <Icon name="branch" size={12} />
      {busy ?? status.branch ?? 'detached'}
      {!busy && status.ahead > 0 && <span className="sb-ab">↑{status.ahead}</span>}
      {!busy && status.behind > 0 && <span className="sb-ab">↓{status.behind}</span>}
    </button>
  )
}
