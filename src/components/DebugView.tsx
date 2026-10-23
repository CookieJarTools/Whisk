import { useEffect, useRef, useState } from 'react'
import { shortcutLabel } from '../keymap/keymap'
import { baseName } from '../lib/paths'
import { evaluate, loadChildren, pause, restartDebugging, resume, selectFrame, stepInto, stepOut, stepOver, stopDebugging, useDebug, type Variable } from '../debug/session'
import { Icon, type IconName } from './Icon'

/**
 * The Debug view in the bottom panel: stepping buttons, the call stack,
 * variables (expand to look inside), and a console for output and expressions.
 */

function VariableRow({ v, depth }: { v: Variable; depth: number }) {
  const children = useDebug((s) => s.children[v.variablesReference])
  const [open, setOpen] = useState(false)
  const expandable = v.variablesReference > 0
  return (
    <>
      <div
        className="dbg-var"
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => {
          if (!expandable) return
          if (!open) void loadChildren(v.variablesReference)
          setOpen(!open)
        }}
        title={v.type ? `${v.name}: ${v.type}` : v.name}
      >
        <span className={`tree-chev${open ? ' open' : ''}`}>{expandable && <Icon name="chevron" size={10} strokeWidth={2.4} />}</span>
        <span className="dbg-var-name">{v.name}</span>
        <span className="dbg-var-eq">=</span>
        <span className="dbg-var-value">{v.value}</span>
        {v.type && <span className="dbg-var-type">{v.type}</span>}
      </div>
      {open && children?.map((c, i) => <VariableRow key={`${c.name}:${i}`} v={c} depth={depth + 1} />)}
    </>
  )
}

function Scope({ name, reference, startOpen }: { name: string; reference: number; startOpen: boolean }) {
  const children = useDebug((s) => s.children[reference])
  const [open, setOpen] = useState(startOpen)
  return (
    <div>
      <div
        className="dbg-scope"
        onClick={() => {
          if (!open) void loadChildren(reference)
          setOpen(!open)
        }}
      >
        <span className={`tree-chev${open ? ' open' : ''}`}>
          <Icon name="chevron" size={10} strokeWidth={2.4} />
        </span>
        {name}
      </div>
      {open && (children ? children.map((v, i) => <VariableRow key={`${v.name}:${i}`} v={v} depth={1} />) : <div className="dbg-empty">Loading…</div>)}
    </div>
  )
}

function Console() {
  const lines = useDebug((s) => s.console)
  const paused = useDebug((s) => s.state === 'paused')
  const [input, setInput] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [back, setBack] = useState(-1)
  const end = useRef<HTMLDivElement>(null)

  // Braces matter: newer browsers return a promise from scrollIntoView, which React would take for a cleanup.
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [lines.length])

  return (
    <div className="dbg-console">
      <div className="dbg-console-lines">
        {lines.map((l, i) => (
          <div key={i} className={`dbg-line ${l.kind}`}>
            {l.kind === 'input' ? `› ${l.text}` : l.text}
          </div>
        ))}
        <div ref={end} />
      </div>
      <input
        className="dbg-console-input"
        placeholder={paused ? 'Evaluate an expression (Enter)' : 'Expressions can be evaluated while paused'}
        value={input}
        spellCheck={false}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && input.trim()) {
            void evaluate(input.trim())
            setHistory((h) => [input.trim(), ...h.filter((x) => x !== input.trim())].slice(0, 50))
            setInput('')
            setBack(-1)
          } else if (e.key === 'ArrowUp' && history.length) {
            const i = Math.min(history.length - 1, back + 1)
            setBack(i)
            setInput(history[i])
            e.preventDefault()
          } else if (e.key === 'ArrowDown') {
            const i = back - 1
            setBack(Math.max(-1, i))
            setInput(i >= 0 ? history[i] : '')
            e.preventDefault()
          }
        }}
      />
    </div>
  )
}

function ToolButton({ icon, title, action, disabled, onClick }: { icon: IconName; title: string; action: string; disabled?: boolean; onClick: () => void }) {
  const key = shortcutLabel(action)
  return (
    <button className="icon-btn" title={key ? `${title} (${key})` : title} disabled={disabled} onClick={onClick}>
      <Icon name={icon} size={13} />
    </button>
  )
}

export function DebugView() {
  const state = useDebug((s) => s.state)
  const config = useDebug((s) => s.config)
  const frames = useDebug((s) => s.frames)
  const frameId = useDebug((s) => s.frameId)
  const scopes = useDebug((s) => s.scopes)
  const reason = useDebug((s) => s.stopReason)
  const paused = state === 'paused'
  const live = state !== 'idle'

  return (
    <div className="dbg-view">
      <div className="term-tabs">
        {paused ? (
          <ToolButton icon="resume" title="Resume" action="debug.resume" onClick={resume} />
        ) : (
          <ToolButton icon="pause" title="Pause" action="debug.pause" disabled={state !== 'running'} onClick={pause} />
        )}
        <ToolButton icon="stepOver" title="Step over" action="debug.stepOver" disabled={!paused} onClick={stepOver} />
        <ToolButton icon="stepInto" title="Step into" action="debug.stepInto" disabled={!paused} onClick={stepInto} />
        <ToolButton icon="stepOut" title="Step out" action="debug.stepOut" disabled={!paused} onClick={stepOut} />
        <span className="dbg-sep" />
        <ToolButton icon="refresh" title="Restart" action="debug.restart" disabled={!live} onClick={() => void restartDebugging()} />
        <button className="icon-btn dbg-stop" title={`Stop (${shortcutLabel('run.stop')})`} disabled={!live} onClick={() => void stopDebugging()}>
          <Icon name="stop" size={11} />
        </button>
        <div className="term-tabs-spacer" />
        <span className="tests-summary">
          {state === 'idle'
            ? config
              ? `Last run: ${config.name}`
              : 'Not debugging'
            : state === 'starting'
              ? `Starting ${config?.name}…`
              : paused
                ? `Paused${reason ? ` (${reason})` : ''}`
                : `Running ${config?.name}`}
        </span>
      </div>
      <div className="dbg-main">
        <div className="dbg-frames">
          <div className="dbg-head">Call stack</div>
          {frames.length === 0 && <div className="dbg-empty">{paused ? 'No frames' : live ? 'Running…' : 'Set a breakpoint and press Debug.'}</div>}
          {frames.map((f) => (
            <div key={f.id} className={`dbg-frame${f.id === frameId ? ' on' : ''}${f.path ? '' : ' external'}`} onClick={() => void selectFrame(f)} title={f.path}>
              <span className="dbg-frame-name">{f.name}</span>
              {f.path && (
                <span className="dbg-frame-loc">
                  {baseName(f.path)}:{f.line}
                </span>
              )}
            </div>
          ))}
        </div>
        <div className="dbg-vars">
          <div className="dbg-head">Variables</div>
          {!paused && <div className="dbg-empty">Variables show when the program is paused.</div>}
          {paused && scopes.map((s, i) => <Scope key={`${frameId}:${s.variablesReference}`} name={s.name} reference={s.variablesReference} startOpen={i === 0 && !s.expensive} />)}
        </div>
        <Console />
      </div>
    </div>
  )
}
