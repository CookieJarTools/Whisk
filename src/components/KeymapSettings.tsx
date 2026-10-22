import { useEffect, useMemo, useRef, useState } from 'react'
import { useSettings } from '../store/settings'
import { PRESETS, PRESET_ORDER, type PresetId } from '../keymap/presets'
import { DOUBLE_SHIFT, DoubleShiftDetector, eventToShortcut } from '../keymap/keys'
import { actionsBoundTo, allActions, bindingsFor, isModified, resetBindings, setBindings, setRecording } from '../keymap/keymap'
import { Icon } from './Icon'

/**
 * Rider-style keymap editor: pick a preset, search actions (or press a shortcut
 * to find what it does), record new bindings, and resolve clashes.
 */

interface Pending {
  actionId: string
  shortcut: string
  conflicts: { id: string; title: string }[]
}

/** Captures the next shortcut pressed (double Shift included) while active. */
function useShortcutCapture(active: boolean, onCapture: (shortcut: string) => void, onCancel: () => void) {
  // Latest callbacks via refs, so re-renders don't re-register listeners (and reset the double-Shift detector).
  const capture = useRef(onCapture)
  const cancel = useRef(onCancel)
  capture.current = onCapture
  cancel.current = onCancel
  useEffect(() => {
    if (!active) return
    setRecording(true)
    const detector = new DoubleShiftDetector()
    const down = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      detector.keydown(e)
      if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        cancel.current()
        return
      }
      const shortcut = eventToShortcut(e)
      if (shortcut) capture.current(shortcut)
    }
    const up = (e: KeyboardEvent) => {
      if (detector.keyup(e)) capture.current(DOUBLE_SHIFT)
    }
    window.addEventListener('keydown', down, true)
    window.addEventListener('keyup', up, true)
    return () => {
      setRecording(false)
      window.removeEventListener('keydown', down, true)
      window.removeEventListener('keyup', up, true)
    }
  }, [active])
}

export function KeymapSettings() {
  const preset = useSettings((s) => s.keymapPreset)
  const overrides = useSettings((s) => s.keyOverrides)
  const set = useSettings((s) => s.set)
  const [filter, setFilter] = useState('')
  const [byShortcut, setByShortcut] = useState<string | null>(null)
  const [findingShortcut, setFindingShortcut] = useState(false)
  const [recordingFor, setRecordingFor] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)

  // `overrides` and `preset` aren't read directly, but any change must re-read bindings.
  const actions = useMemo(() => allActions(), [overrides, preset]) // eslint-disable-line react-hooks/exhaustive-deps

  useShortcutCapture(
    findingShortcut,
    (s) => {
      setByShortcut(s)
      setFindingShortcut(false)
    },
    () => setFindingShortcut(false)
  )
  useShortcutCapture(
    !!recordingFor,
    (shortcut) => {
      const actionId = recordingFor!
      setRecordingFor(null)
      if (bindingsFor(actionId).includes(shortcut)) return
      const conflicts = actionsBoundTo(shortcut, actionId).map((a) => ({ id: a.id, title: a.title }))
      if (conflicts.length) setPending({ actionId, shortcut, conflicts })
      else setBindings(actionId, [...bindingsFor(actionId), shortcut])
    },
    () => setRecordingFor(null)
  )

  const resolve = (choice: 'remove' | 'keep') => {
    if (!pending) return
    if (choice === 'remove') {
      for (const c of pending.conflicts) setBindings(c.id, bindingsFor(c.id).filter((b) => b !== pending.shortcut))
    }
    setBindings(pending.actionId, [...bindingsFor(pending.actionId), pending.shortcut])
    setPending(null)
  }

  const q = filter.trim().toLowerCase()
  const visible = actions.filter((a) => {
    if (byShortcut) return bindingsFor(a.id).includes(byShortcut)
    return !q || a.title.toLowerCase().includes(q) || a.category.toLowerCase().includes(q) || bindingsFor(a.id).some((b) => b.toLowerCase().includes(q))
  })
  const categories = [...new Set(visible.map((a) => a.category))]
  const modifiedCount = Object.keys(overrides[preset] ?? {}).length

  return (
    <>
      <div className="set-row">
        <div className="set-text">
          <div className="set-title">Keymap</div>
          <div className="set-hint">{PRESETS[preset].description}. Changes are kept per keymap.</div>
        </div>
        <div className="set-control">
          <div className="seg">
            {PRESET_ORDER.map((id: PresetId) => (
              <button key={id} className={preset === id ? 'on' : ''} onClick={() => set({ keymapPreset: id })}>
                {PRESETS[id].label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="set-toolbar">
        <div className="field-with-icon">
          <Icon name="search" size={13} />
          {byShortcut ? (
            <span className="field shortcut-filter">
              Bound to <span className="kbd">{byShortcut}</span>
              <button className="icon-btn" title="Clear" onClick={() => setByShortcut(null)}>
                <Icon name="close" size={12} />
              </button>
            </span>
          ) : (
            <input className="field" placeholder="Search actions or shortcuts" value={filter} onChange={(e) => setFilter(e.target.value)} />
          )}
        </div>
        <button
          className={`btn${findingShortcut ? ' recording' : ''}`}
          title="Press a shortcut to see which action uses it"
          onClick={() => setFindingShortcut((f) => !f)}
        >
          <Icon name="keyboard" size={13} /> {findingShortcut ? 'Press a shortcut…' : 'Find by shortcut'}
        </button>
        {modifiedCount > 0 && (
          <button className="btn" onClick={() => resetBindings()}>
            Reset all ({modifiedCount})
          </button>
        )}
      </div>

      {categories.map((category) => (
        <div key={category} className="keymap-group">
          <div className="keymap-category">{category}</div>
          {visible
            .filter((a) => a.category === category)
            .map((action) => {
              const bindings = bindingsFor(action.id)
              const modified = isModified(action.id)
              return (
                <div key={action.id}>
                  <div className="keymap-row">
                    <span className={`keymap-title${modified ? ' modified' : ''}`} title={modified ? 'Changed from the keymap default' : undefined}>
                      {action.title}
                    </span>
                    <span className="keymap-keys">
                      {bindings.map((b) => (
                        <span key={b} className="key-chip">
                          {b}
                          <button title={`Remove ${b}`} onClick={() => setBindings(action.id, bindings.filter((x) => x !== b))}>
                            <Icon name="close" size={10} />
                          </button>
                        </span>
                      ))}
                      {recordingFor === action.id ? (
                        <span className="key-chip recording">Press keys… (Esc to cancel)</span>
                      ) : (
                        <button className="key-add" title="Add a shortcut" onClick={() => setRecordingFor(action.id)}>
                          <Icon name="plus" size={12} />
                        </button>
                      )}
                      {modified && (
                        <button className="link-btn" onClick={() => resetBindings(action.id)}>
                          Reset
                        </button>
                      )}
                    </span>
                  </div>
                  {pending?.actionId === action.id && (
                    <div className="keymap-conflict">
                      <span>
                        <span className="kbd">{pending.shortcut}</span> is already used by {pending.conflicts.map((c) => c.title).join(', ')}.
                      </span>
                      <span className="keymap-conflict-actions">
                        <button className="btn btn-primary" onClick={() => resolve('remove')}>
                          Remove it there
                        </button>
                        <button className="btn" onClick={() => resolve('keep')}>
                          Keep both
                        </button>
                        <button className="btn" onClick={() => setPending(null)}>
                          Cancel
                        </button>
                      </span>
                    </div>
                  )}
                </div>
              )
            })}
        </div>
      ))}
      {visible.length === 0 && <p className="set-note">No actions match.</p>}
    </>
  )
}
