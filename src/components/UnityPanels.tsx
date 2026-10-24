import { useState } from 'react'
import { dismissUnityBanner, makeWhiskDefault, setUpUnity, useUnity } from '../unity/unity'
import { Icon } from './Icon'

/** Shown above the editor in a Unity project that hasn't been set up for Whisk yet. */
export function UnityBanner() {
  const state = useUnity((s) => s.state)
  const dismissed = useUnity((s) => s.dismissed)
  const [busy, setBusy] = useState(false)
  if (state.kind !== 'available' || dismissed) return null
  return (
    <div className="unity-banner">
      <Icon name="sparkle" size={13} />
      <span>
        This is a Unity project. Make Whisk its script editor? Unity opens scripts here, and the bug button debugs the Unity editor with nothing to set up.
      </span>
      <button
        className="btn btn-primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          await setUpUnity()
          setBusy(false)
        }}
      >
        {busy ? 'Setting up…' : 'Set up Unity'}
      </button>
      <button className="btn" onClick={dismissUnityBanner}>
        Not now
      </button>
    </div>
  )
}

function Row({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="set-row">
      <div className="set-text">
        <div className="set-title">{title}</div>
        <div className="set-hint">{hint}</div>
      </div>
      <div className="set-control">{children}</div>
    </div>
  )
}

/** Settings › Unity. */
export function UnitySettings() {
  const state = useUnity((s) => s.state)
  if (state.kind === 'none') {
    return <p className="set-note">Open a Unity project to set it up for Whisk. Whisk offers when you open one.</p>
  }
  return (
    <>
      <p className="set-note">
        Whisk adds a small package to the project (Packages/com.cookiejar.ide.whisk). It puts Whisk in Unity's list of script editors, writes the .csproj and
        .sln files Whisk's C# support reads, and gets Unity ready when you debug. Commit it and your team gets it too.
      </p>
      <Row
        title="Whisk package"
        hint={state.kind === 'installed' ? `Version ${state.version}. Whisk updates it when a newer one comes with an update.` : 'Not in this project yet.'}
      >
        {state.kind === 'installed' ? (
          <span className="set-badge ok">Installed</span>
        ) : (
          <button className="btn btn-primary" onClick={() => void setUpUnity()}>
            Set up Unity
          </button>
        )}
      </Row>
      <Row title="Script editor" hint="Makes Whisk the editor Unity opens scripts in. You can change it back in Unity under Preferences › External Tools.">
        <button className="btn" disabled={state.kind !== 'installed'} onClick={() => void makeWhiskDefault()}>
          Use Whisk in Unity
        </button>
      </Row>
      <Row title="Debugging" hint="Pick “Unity Editor” at the top and press the bug button while the project is open in Unity. Whisk switches Unity to Debug mode for the session and attaches.">
        <span className="set-badge ok">Ready</span>
      </Row>
    </>
  )
}
