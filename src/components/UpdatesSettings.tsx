import { useEffect, useState } from 'react'
import { useSettings } from '../store/settings'
import { ipc, type Release } from '../lib/ipc'
import { checkForUpdate, compareVersions, downloadUpdate, installUpdate, loadReleases, selectVersion, useUpdates } from '../updates/updates'
import { Icon } from './Icon'

function formatDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function Toggle({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button className={`toggle${on ? ' on' : ''}`} role="switch" aria-checked={on} onClick={() => onChange(!on)}>
      <span />
    </button>
  )
}

/** Settings › Updates: version, check now, automatic updates, and installing any released version. */
export function UpdatesSettings() {
  const { currentVersion, phase, info, progress, error, lastChecked, releases } = useUpdates()
  const autoUpdate = useSettings((s) => s.autoUpdate)
  const prereleases = useSettings((s) => s.prereleases)
  const set = useSettings((s) => s.set)
  const [releaseError, setReleaseError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const busy = phase === 'checking' || phase === 'downloading' || phase === 'installing'

  useEffect(() => {
    loadReleases().catch((e) => setReleaseError(String(e)))
  }, [])

  const status = (() => {
    switch (phase) {
      case 'checking':
        return 'Checking…'
      case 'none':
        return 'You’re on the latest version.'
      case 'available':
        return info ? `Whisk ${info.version} is available.` : ''
      case 'downloading':
        return progress !== null ? `Downloading… ${Math.round(progress * 100)}%` : 'Downloading…'
      case 'ready':
        return info ? `Whisk ${info.version} is downloaded and ready.` : 'Ready to install.'
      case 'installing':
        return 'Installing…'
      case 'error':
        return error ?? 'Something went wrong.'
      default:
        return lastChecked ? '' : 'Not checked yet.'
    }
  })()

  const primary = (() => {
    if (phase === 'available')
      return (
        <button className="btn btn-primary" onClick={() => downloadUpdate()}>
          <Icon name="download" size={13} /> Download {info?.version}
        </button>
      )
    if (phase === 'ready')
      return (
        <button className="btn btn-primary" onClick={() => installUpdate()}>
          Restart and install
        </button>
      )
    return (
      <button className="btn" disabled={busy} onClick={() => checkForUpdate()}>
        <Icon name="refresh" size={13} /> Check for updates
      </button>
    )
  })()

  const install = async (release: Release) => {
    const older = compareVersions(release.version, currentVersion) < 0
    if (older && !window.confirm(`Install the older version ${release.version}? You can update again at any time.`)) return
    const found = await selectVersion(release.tag)
    if (found && (await downloadUpdate())) await installUpdate()
  }

  const shown = (releases ?? []).filter((r) => prereleases || !r.prerelease || r.version === currentVersion)

  return (
    <>
      <div className="set-row">
        <div className="set-text">
          <div className="set-title">
            Whisk {currentVersion}
            {import.meta.env.DEV && <span className="set-badge">Development build</span>}
          </div>
          <div className={`set-hint${phase === 'error' ? ' error' : ''}`}>
            {status}
            {lastChecked && phase !== 'checking' && <> · Last checked {new Date(lastChecked).toLocaleTimeString()}</>}
          </div>
          {phase === 'downloading' && progress !== null && (
            <div className="progress">
              <span style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
          )}
        </div>
        <div className="set-control">{primary}</div>
      </div>
      <div className="set-row">
        <div className="set-text">
          <div className="set-title">Automatic updates</div>
          <div className="set-hint">Checks every few hours and downloads new versions in the background. You choose when to restart.</div>
        </div>
        <div className="set-control">
          <Toggle on={autoUpdate} onChange={(v) => set({ autoUpdate: v })} />
        </div>
      </div>
      <div className="set-row">
        <div className="set-text">
          <div className="set-title">Include pre-releases</div>
          <div className="set-hint">Offer test versions before they’re marked stable.</div>
        </div>
        <div className="set-control">
          <Toggle on={prereleases} onChange={(v) => set({ prereleases: v })} />
        </div>
      </div>

      <div className="keymap-category" style={{ marginTop: 16 }}>
        Versions
      </div>
      {releaseError && <p className="set-note">Couldn’t load releases: {releaseError}</p>}
      {releases && shown.length === 0 && <p className="set-note">No releases published yet.</p>}
      {!releases && !releaseError && <p className="set-note">Loading releases…</p>}
      {shown.map((r) => {
        const isCurrent = r.version === currentVersion
        const newer = compareVersions(r.version, currentVersion) > 0
        return (
          <div key={r.tag} className="release-row">
            <div className="set-row">
              <div className="set-text">
                <div className="set-title">
                  {r.name}
                  {isCurrent && <span className="set-badge ok">Installed</span>}
                  {r.prerelease && <span className="set-badge">Pre-release</span>}
                </div>
                <div className="set-hint">
                  {formatDate(r.publishedAt)}
                  {r.notes && (
                    <>
                      {' · '}
                      <button className="link-btn" onClick={() => setExpanded(expanded === r.tag ? null : r.tag)}>
                        {expanded === r.tag ? 'Hide notes' : 'Release notes'}
                      </button>
                    </>
                  )}
                </div>
              </div>
              <div className="set-control server-controls">
                <button className="icon-btn" title="Open on GitHub" onClick={() => ipc.openExternal(r.url)}>
                  <Icon name="external" size={13} />
                </button>
                {!isCurrent &&
                  (r.installable ? (
                    <button className={`btn${newer ? ' btn-primary' : ''}`} disabled={busy || import.meta.env.DEV} onClick={() => install(r)}>
                      {newer ? 'Update to this' : 'Switch to this'}
                    </button>
                  ) : (
                    <span className="set-badge" title="This release has no signed update file">Manual install</span>
                  ))}
              </div>
            </div>
            {expanded === r.tag && <pre className="install-log release-notes">{r.notes}</pre>}
          </div>
        )
      })}
    </>
  )
}
