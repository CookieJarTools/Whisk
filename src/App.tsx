import { useEffect, useRef, useState } from 'react'
import { useStore } from './store/store'
import { useSettings } from './store/settings'
import { TitleBar } from './components/TitleBar'
import { Sidebar } from './components/Sidebar'
import { EditorArea } from './components/EditorArea'
import { StatusBar } from './components/StatusBar'
import { SearchEverywhere } from './components/SearchEverywhere'
import { NewProjectWizard } from './components/NewProjectWizard'
import { UsagesPopup } from './components/UsagesPopup'
import { ContextMenu, Toasts } from './components/Overlays'
import { SettingsDialog } from './components/Settings'
import { Welcome } from './components/Welcome'
import { loadPlugins } from './plugins/host'
import { stopAllServers } from './lsp/servers'
import claudePlugin from './plugins/claude'
import { installKeymap } from './keymap/keymap'
import { startUpdater } from './updates/updates'
import { ipc } from './lib/ipc'

/** How long a slid-in bar stays after the mouse leaves it, so brushing past doesn't flicker. */
const PEEK_LINGER_MS = 350

/** Zen-style reveal: show on entering an edge strip, hide a moment after leaving. */
function usePeek() {
  const [open, setOpen] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  const show = () => {
    clearTimeout(timer.current)
    setOpen(true)
  }
  const hide = () => {
    clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      // Keep it out while one of its menus is open.
      if (!useStore.getState().menu) setOpen(false)
    }, PEEK_LINGER_MS)
  }
  return { open, show, hide }
}

export default function App() {
  const root = useStore((s) => s.root)
  const hideTitleBar = useSettings((s) => s.hideTitleBar)
  const hideExplorer = useSettings((s) => s.hideExplorer)
  const top = usePeek()
  const left = usePeek()

  useEffect(() => {
    installKeymap()
    startUpdater()
    loadPlugins([claudePlugin])
    ipc.startupArgs().then(async ({ folder, files }) => {
      const store = useStore.getState()
      if (folder) store.openFolder(folder)
      for (const file of files) await store.openFile(file)
    })
  }, [])

  // Language servers belong to a folder; switching folders restarts them.
  useEffect(() => {
    return () => {
      stopAllServers()
    }
  }, [root])

  const explorerFloats = !!root && hideExplorer
  return (
    <div className={`app${hideTitleBar ? ' no-titlebar' : ''}`} onContextMenu={(e) => e.preventDefault()}>
      {hideTitleBar ? (
        <>
          <div className="edge edge-top" onMouseEnter={top.show} />
          <div className={`titlebar-float${top.open ? ' peek' : ''}`} onMouseEnter={top.show} onMouseLeave={top.hide}>
            <TitleBar />
          </div>
        </>
      ) : (
        <TitleBar />
      )}
      <div className="body">
        {explorerFloats && <div className="edge edge-left" onMouseEnter={left.show} />}
        {root && (
          <Sidebar
            floating={explorerFloats}
            peek={left.open}
            onMouseEnter={explorerFloats ? left.show : undefined}
            onMouseLeave={explorerFloats ? left.hide : undefined}
          />
        )}
        <div className="panel">
          {root ? <EditorArea /> : <Welcome />}
          <StatusBar />
        </div>
      </div>
      <SearchEverywhere />
      <NewProjectWizard />
      <UsagesPopup />
      <SettingsDialog />
      <ContextMenu />
      <Toasts />
    </div>
  )
}
