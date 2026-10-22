import { useEffect, useMemo, useRef } from 'react'
import MarkdownIt from 'markdown-it'
import { useStore, type CursorInfo, type Tab } from '../store/store'
import { createEditor } from '../editor/setup'
import { getView, registerView, unregisterView } from '../editor/views'
import { attachLanguageServer } from '../lsp/servers'
import { isMarkdown } from '../lib/languages'
import { relativePath } from '../lib/paths'
import { Icon } from './Icon'
import { ErrorBoundary } from './ErrorBoundary'
import { fileIcon } from './Sidebar'

const NO_CRUMBS: CursorInfo['crumbs'] = []
const LANES = 12
const md = new MarkdownIt({ html: false, linkify: true, typographer: true })

function EditorHost({ tab, visible }: { tab: Tab; visible: boolean }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const view = createEditor(tab.path, tab.initialText, ref.current!)
    registerView(tab.path, view)
    attachLanguageServer(view, tab.path)
    return () => {
      unregisterView(tab.path)
      view.destroy()
    }
    // The view owns the text after creation; only a new path means a new editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.path])

  useEffect(() => {
    if (!visible) return
    const view = getView(tab.path)
    view?.requestMeasure()
    view?.focus()
  }, [visible, tab.path])

  return <div className="editor-host" ref={ref} hidden={!visible} />
}

function MarkdownPreview({ path, full }: { path: string; full: boolean }) {
  const text = useStore((s) => s.markdownText[path] ?? '')
  const html = useMemo(() => md.render(text), [text])
  return <div className={`md-preview${full ? ' full' : ''}`} dangerouslySetInnerHTML={{ __html: html }} />
}

function TabBar() {
  const tabs = useStore((s) => s.tabs)
  const active = useStore((s) => s.active)
  const dirty = useStore((s) => s.dirty)
  const setActive = useStore((s) => s.setActive)
  const closeTab = useStore((s) => s.closeTab)
  const mode = useStore((s) => s.markdownMode)
  const setMode = useStore((s) => s.setMarkdownMode)

  const close = (path: string) => {
    if (dirty[path] && !window.confirm(`${path} has unsaved changes. Close it anyway?`)) return
    closeTab(path)
  }

  return (
    <div className="tabbar">
      <div className="tabs">
        {tabs.map((t) => (
          <div
            key={t.path}
            className={`tab${t.path === active ? ' active' : ''}`}
            onMouseDown={(e) => {
              if (e.button === 1) {
                e.preventDefault()
                close(t.path)
              } else if (e.button === 0) setActive(t.path)
            }}
            title={t.path}
          >
            <Icon name={fileIcon(t.path).icon} size={13} style={{ color: fileIcon(t.path).colour }} className="tab-icon" />
            <span>{t.name}</span>
            {dirty[t.path] ? (
              <span className="tab-dirty" />
            ) : (
              <button
                className="tab-close"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => close(t.path)}
                title="Close"
              >
                <Icon name="close" size={11} />
              </button>
            )}
          </div>
        ))}
      </div>
      {active && isMarkdown(active) && (
        <div className="tabbar-actions">
          <div className="seg">
            {(['edit', 'split', 'preview'] as const).map((m) => (
              <button key={m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>
                {m === 'edit' ? 'Edit' : m === 'split' ? 'Split' : 'Preview'}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Crumbs() {
  const root = useStore((s) => s.root)
  const active = useStore((s) => s.active)
  const crumbs = useStore((s) => s.cursor?.crumbs ?? NO_CRUMBS)
  if (!active) return null
  const parts = relativePath(root, active).split(/[\\/]/)
  // Symbols take the lane colour of their block, matching the scope rails in the editor.
  const all = [
    ...parts.map((p) => ({ text: p, lane: null as number | null })),
    ...crumbs.map((c) => ({ text: c.name, lane: c.depth % LANES }))
  ]
  return (
    <div className="crumbs">
      {all.map((c, i) => (
        <span key={i} style={{ display: 'contents' }}>
          {i > 0 && <span className="crumb-sep">›</span>}
          <span
            className={`crumb${c.lane !== null ? ' symbol' : ''}${i === all.length - 1 ? ' last' : ''}`}
            style={c.lane !== null ? { ['--lane' as string]: `var(--lane-${c.lane})` } : undefined}
          >
            {c.text}
          </span>
        </span>
      ))}
    </div>
  )
}

export function EditorArea() {
  const tabs = useStore((s) => s.tabs)
  const active = useStore((s) => s.active)
  const mode = useStore((s) => s.markdownMode)
  const activeIsMd = !!active && isMarkdown(active)
  const showEditor = !activeIsMd || mode !== 'preview'
  const showPreview = activeIsMd && mode !== 'edit'

  return (
    <main className="main">
      <TabBar />
      <Crumbs />
      <div className="editor-area">
        <div className="editor-pane" style={showEditor && tabs.length > 0 ? undefined : { display: 'none' }}>
          {tabs.map((t) => (
            <div key={t.path} className="editor-slot" style={t.path === active && showEditor ? undefined : { display: 'none' }}>
              <ErrorBoundary
                scope="editor"
                title={`Couldn't open ${t.name}`}
                actions={
                  <button className="btn" onClick={() => useStore.getState().closeTab(t.path)}>
                    Close this file
                  </button>
                }
              >
                <EditorHost tab={t} visible={t.path === active && showEditor} />
              </ErrorBoundary>
            </div>
          ))}
        </div>
        {showPreview && active && <MarkdownPreview path={active} full={!showEditor} />}
        {tabs.length === 0 && (
          <div className="editor-empty">Pick a file from the explorer, or press Ctrl+P.</div>
        )}
      </div>
    </main>
  )
}
