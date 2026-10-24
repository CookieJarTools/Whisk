import { useEffect, useMemo, useRef } from 'react'
import MarkdownIt from 'markdown-it'
import { useStore, type CursorInfo, type Pane, type Tab } from '../store/store'
import { createEditor } from '../editor/setup'
import { createDiffView } from '../editor/diffView'
import { getView, registerView, unregisterView } from '../editor/views'
import { attachLanguageServer } from '../lsp/servers'
import { isMarkdown } from '../lib/languages'
import { relativePath } from '../lib/paths'
import { shortcutLabel } from '../keymap/keymap'
import { Icon } from './Icon'
import { ErrorBoundary } from './ErrorBoundary'
import { fileIcon } from './Sidebar'
import { BottomPanel } from './BottomPanel'
import { UnityBanner } from './UnityPanels'

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

function DiffHost({ tab }: { tab: Tab }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const view = createDiffView(tab.diff!, tab.name, ref.current!)
    return () => view.destroy()
  }, [tab.diff, tab.name])
  const { leftTitle, rightTitle } = tab.diff!
  return (
    <div className="diff-host">
      <div className="diff-titles">
        <span>{leftTitle}</span>
        <span>{rightTitle}</span>
      </div>
      <div className="diff-body" ref={ref} />
    </div>
  )
}

function MarkdownPreview({ path, full }: { path: string; full: boolean }) {
  const text = useStore((s) => s.markdownText[path] ?? '')
  const html = useMemo(() => md.render(text), [text])
  return <div className={`md-preview${full ? ' full' : ''}`} dangerouslySetInnerHTML={{ __html: html }} />
}

/** Grid columns for a pane's header rows: both of its columns. */
const paneColumns = (pane: Pane) => ({ gridColumn: `${pane * 2 + 1} / span 2` })

function TabBar({ pane, split }: { pane: Pane; split: boolean }) {
  const allTabs = useStore((s) => s.tabs)
  const tabs = useMemo(() => allTabs.filter((t) => (t.pane ?? 0) === pane), [allTabs, pane])
  const active = useStore((s) => s.paneActive[pane])
  const focused = useStore((s) => s.focusedPane === pane)
  const dirty = useStore((s) => s.dirty)
  const setActive = useStore((s) => s.setActive)
  const closeTab = useStore((s) => s.closeTab)
  const moveToPane = useStore((s) => s.moveToPane)
  const mode = useStore((s) => s.markdownMode)
  const setMode = useStore((s) => s.setMarkdownMode)
  const other: Pane = pane === 0 ? 1 : 0

  const close = (path: string) => {
    if (dirty[path] && !window.confirm(`${path} has unsaved changes. Close it anyway?`)) return
    closeTab(path)
  }

  const tabMenu = (e: React.MouseEvent, t: Tab) => {
    e.preventDefault()
    useStore.getState().openMenu(e.clientX, e.clientY, [
      { label: other === 1 ? 'Move to the right' : 'Move to the left', onSelect: () => moveToPane(t.path, other) },
      { type: 'divider' },
      { label: 'Close', onSelect: () => close(t.path) },
      { label: 'Close others in this pane', onSelect: () => tabs.filter((o) => o.path !== t.path).forEach((o) => close(o.path)) }
    ])
  }

  return (
    <div className={`tabbar${split && focused ? ' focused' : ''}${pane === 1 ? ' right' : ''}`} style={paneColumns(pane)}>
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
            onContextMenu={(e) => tabMenu(e, t)}
            title={t.diff ? `${t.diff.leftTitle} ↔ ${t.diff.rightTitle}` : t.path}
          >
            {t.diff ? (
              <Icon name="diff" size={13} className="tab-icon" />
            ) : (
              <Icon name={fileIcon(t.path).icon} size={13} style={{ color: fileIcon(t.path).colour }} className="tab-icon" />
            )}
            <span>{t.name}</span>
            {dirty[t.path] ? (
              <span className="tab-dirty" />
            ) : (
              <button className="tab-close" onMouseDown={(e) => e.stopPropagation()} onClick={() => close(t.path)} title="Close">
                <Icon name="close" size={11} />
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="tabbar-actions">
        {active && isMarkdown(active) && (
          <div className="seg">
            {(['edit', 'split', 'preview'] as const).map((m) => (
              <button key={m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>
                {m === 'edit' ? 'Edit' : m === 'split' ? 'Split' : 'Preview'}
              </button>
            ))}
          </div>
        )}
        {active && pane === 0 && !split && (
          <button className="icon-btn" title={`Split right ${shortcutLabel('view.splitRight')}`} onClick={() => moveToPane(active, 1)}>
            <Icon name="split" size={13} />
          </button>
        )}
      </div>
    </div>
  )
}

function Crumbs({ pane }: { pane: Pane }) {
  const root = useStore((s) => s.root)
  const active = useStore((s) => s.paneActive[pane])
  const focused = useStore((s) => s.focusedPane === pane)
  const crumbs = useStore((s) => (focused ? (s.cursor?.crumbs ?? NO_CRUMBS) : NO_CRUMBS))
  if (!active || active.startsWith('diff:')) return <div className={`crumbs${pane === 1 ? ' right' : ''}`} style={paneColumns(pane)} />
  const parts = relativePath(root, active).split(/[\\/]/)
  // Symbols take the lane colour of their block, matching the scope rails in the editor.
  const all = [
    ...parts.map((p) => ({ text: p, lane: null as number | null })),
    ...crumbs.map((c) => ({ text: c.name, lane: c.depth % LANES }))
  ]
  return (
    <div className={`crumbs${pane === 1 ? ' right' : ''}`} style={paneColumns(pane)}>
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

/**
 * One or two panes side by side. Every editor lives in the same grid, so moving
 * a tab between panes only changes its column: the editor, its unsaved text
 * and its undo history all survive the move.
 */
export function EditorArea() {
  const tabs = useStore((s) => s.tabs)
  const paneActive = useStore((s) => s.paneActive)
  const focusPane = useStore((s) => s.focusPane)
  const mode = useStore((s) => s.markdownMode)
  const split = tabs.some((t) => t.pane === 1)
  const panes: Pane[] = split ? [0, 1] : [0]

  // Each pane takes two columns: the editor, and a markdown preview beside it.
  const layout = panes.map((p) => {
    const active = paneActive[p]
    const isMd = !!active && isMarkdown(active)
    return { showEditor: !isMd || mode !== 'preview', showPreview: isMd && mode !== 'edit' }
  })
  const columns = layout
    .map(({ showEditor, showPreview }) => (showEditor && showPreview ? 'minmax(0, 1fr) minmax(0, 1fr)' : showPreview ? '0 minmax(0, 1fr)' : 'minmax(0, 1fr) 0'))
    .join(' ')

  return (
    <main className="main">
      <UnityBanner />
      <div className={`panes${split ? ' split' : ''}`} style={{ gridTemplateColumns: columns }}>
        {panes.map((p) => (
          <TabBar key={`bar${p}`} pane={p} split={split} />
        ))}
        {panes.map((p) => (
          <Crumbs key={`crumbs${p}`} pane={p} />
        ))}
        {tabs.map((t) => {
          const pane = t.pane ?? 0
          const visible = t.path === paneActive[pane] && (layout[pane]?.showEditor ?? true)
          return (
            <div
              key={t.path}
              className={`editor-slot${pane === 1 ? ' right' : ''}`}
              style={{ gridColumn: pane * 2 + 1, display: visible ? undefined : 'none' }}
              onMouseDownCapture={() => focusPane(pane)}
            >
              <ErrorBoundary
                scope="editor"
                title={`Couldn't open ${t.name}`}
                actions={
                  <button className="btn" onClick={() => useStore.getState().closeTab(t.path)}>
                    Close this file
                  </button>
                }
              >
                {t.diff ? <DiffHost tab={t} /> : <EditorHost tab={t} visible={visible} />}
              </ErrorBoundary>
            </div>
          )
        })}
        {panes.map((p) =>
          layout[p].showPreview && paneActive[p] ? (
            <div key={`md${p}`} className="md-slot" style={{ gridColumn: p * 2 + 2 }}>
              <MarkdownPreview path={paneActive[p]!} full={!layout[p].showEditor} />
            </div>
          ) : null
        )}
        {tabs.length === 0 && (
          <div className="editor-empty" style={{ gridColumn: '1 / -1' }}>
            Pick a file from the explorer, or press Ctrl+P.
          </div>
        )}
      </div>
      <BottomPanel />
    </main>
  )
}
