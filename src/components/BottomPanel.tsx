import { useEffect, useRef, type ReactNode } from 'react'
import { usePanel, type PanelView } from '../store/panel'
import {
  attachTerminal,
  clearTerminal,
  closeTerminal,
  fitTerminal,
  focusTerminal,
  openTerminal,
  stopTerminal,
  useTerminals,
  type TerminalInfo
} from '../terminal/terminals'
import { shortcutLabel } from '../keymap/keymap'
import { Icon } from './Icon'

const MIN_HEIGHT = 120

/** One terminal's screen; shown only while it's the active tab. */
function TerminalScreen({ id, visible }: { id: number; visible: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const height = usePanel((s) => s.height)

  useEffect(() => {
    if (!visible || !ref.current) return
    attachTerminal(id, ref.current)
    focusTerminal(id)
  }, [id, visible])

  useEffect(() => {
    if (!visible || !ref.current) return
    const observer = new ResizeObserver(() => fitTerminal(id))
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [id, visible, height])

  return <div className="term-screen" ref={ref} style={visible ? undefined : { display: 'none' }} />
}

/** Tabs for a set of terminals (shells, or program runs), with their screens. */
export function TerminalTabs({ kind, empty, actions }: { kind: TerminalInfo['kind']; empty: ReactNode; actions?: ReactNode }) {
  const all = useTerminals((s) => s.terminals)
  const active = useTerminals((s) => s.active)
  const terminals = all.filter((t) => t.kind === kind)
  const current = terminals.find((t) => t.id === active) ?? terminals[terminals.length - 1]

  return (
    <div className="term-view">
      <div className="term-tabs">
        {terminals.map((t) => (
          <div
            key={t.id}
            className={`term-tab${t.id === current?.id ? ' active' : ''}${t.exitCode !== undefined ? ' ended' : ''}`}
            onMouseDown={(e) => {
              if (e.button === 1) closeTerminal(t.id)
              else useTerminals.setState({ active: t.id })
            }}
            title={t.exitCode !== undefined ? `${t.title} (ended)` : t.title}
          >
            <span className={`term-dot${t.exitCode === undefined ? ' live' : t.exitCode === 0 || t.exitCode === null ? '' : ' failed'}`} />
            <span>{t.title}</span>
            <button className="tab-close" onMouseDown={(e) => e.stopPropagation()} onClick={() => closeTerminal(t.id)} title="Close">
              <Icon name="close" size={10} />
            </button>
          </div>
        ))}
        {kind === 'shell' && (
          <button className="icon-btn" title="New terminal" onClick={() => void openTerminal()}>
            <Icon name="plus" size={13} />
          </button>
        )}
        <div className="term-tabs-spacer" />
        {current && (
          <>
            {current.exitCode === undefined && (
              <button className="icon-btn" title="Stop" onClick={() => stopTerminal(current.id)}>
                <Icon name="stop" size={12} />
              </button>
            )}
            <button className="icon-btn" title="Clear" onClick={() => clearTerminal(current.id)}>
              <Icon name="trash" size={12} />
            </button>
          </>
        )}
        {actions}
      </div>
      <div className="term-body">
        {terminals.length === 0 && <div className="panel-empty">{empty}</div>}
        {terminals.map((t) => (
          <TerminalScreen key={t.id} id={t.id} visible={t.id === current?.id} />
        ))}
      </div>
    </div>
  )
}

/** Views other features add to the panel (run output, tests, debugger). */
const extraViews: { id: PanelView; label: string; render: () => ReactNode }[] = []

export function registerPanelView(view: { id: PanelView; label: string; render: () => ReactNode }) {
  if (!extraViews.some((v) => v.id === view.id)) extraViews.push(view)
}

function Resizer() {
  const setHeight = usePanel((s) => s.setHeight)
  return (
    <div
      className="panel-resizer"
      onMouseDown={(e) => {
        e.preventDefault()
        const startY = e.clientY
        const start = usePanel.getState().height
        const move = (ev: MouseEvent) => {
          const max = window.innerHeight - 160
          setHeight(Math.min(max, Math.max(MIN_HEIGHT, start + startY - ev.clientY)))
        }
        const up = () => {
          window.removeEventListener('mousemove', move)
          window.removeEventListener('mouseup', up)
        }
        window.addEventListener('mousemove', move)
        window.addEventListener('mouseup', up)
      }}
    />
  )
}

export function BottomPanel() {
  const open = usePanel((s) => s.open)
  const view = usePanel((s) => s.view)
  const height = usePanel((s) => s.height)
  const show = usePanel((s) => s.show)
  const close = usePanel((s) => s.close)
  const shells = useTerminals((s) => s.terminals.filter((t) => t.kind === 'shell').length)

  // Opening the terminal view with nothing in it starts a shell, as Rider does.
  useEffect(() => {
    if (open && view === 'terminal' && shells === 0) void openTerminal()
  }, [open, view, shells])

  if (!open) return null
  const views = [{ id: 'terminal' as PanelView, label: 'Terminal' }, ...extraViews]
  const extra = extraViews.find((v) => v.id === view)
  return (
    <section className="bottom-panel" style={{ height }}>
      <Resizer />
      <div className="panel-head">
        {views.map((v) => (
          <button key={v.id} className={`panel-tab${view === v.id ? ' on' : ''}`} onClick={() => show(v.id)}>
            {v.label}
          </button>
        ))}
        <div className="term-tabs-spacer" />
        <button className="icon-btn" title={`Hide ${shortcutLabel('view.terminal')}`} onClick={close}>
          <Icon name="chevronDown" size={13} />
        </button>
      </div>
      <div className="panel-body">
        {view === 'terminal' ? <TerminalTabs kind="shell" empty="Starting a shell…" /> : extra?.render()}
      </div>
    </section>
  )
}
