import { useEffect, useMemo, useRef, useState } from 'react'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { homeDir } from '@tauri-apps/api/path'
import { useStore } from '../store/store'
import { ipc } from '../lib/ipc'
import { joinPath } from '../lib/paths'
import { runCommand } from '../lib/runCommand'
import { NAME_PATTERN, TEMPLATES, withGit, type Answers, type Template } from '../wizard/templates'
import { Icon } from './Icon'

const LOCATION_KEY = 'whisk.newProjectLocation'

function defaultsFor(t: Template): Record<string, string | boolean> {
  return Object.fromEntries(t.options.map((o) => [o.id, o.default]))
}

/** Rider-style New Project window: templates on the left, the form on the right. */
export function NewProjectWizard() {
  const open = useStore((s) => s.wizardOpen)
  const setOpen = useStore((s) => s.setWizardOpen)
  const [templateId, setTemplateId] = useState(TEMPLATES[0].id)
  const [name, setName] = useState('MyProject')
  const [location, setLocation] = useState('')
  const [git, setGit] = useState(true)
  const [options, setOptions] = useState<Record<string, string | boolean>>(defaultsFor(TEMPLATES[0]))
  const [tools, setTools] = useState<Record<string, boolean>>({})
  const [target, setTarget] = useState<'missing' | 'empty' | 'used'>('missing')
  const [running, setRunning] = useState(false)
  const [log, setLog] = useState<string[]>([])
  const [failed, setFailed] = useState(false)
  const logRef = useRef<HTMLPreElement>(null)

  const template = TEMPLATES.find((t) => t.id === templateId)!
  const dir = location && name ? joinPath(location, name) : ''
  const groups = useMemo(() => [...new Set(TEMPLATES.map((t) => t.group))], [])

  useEffect(() => {
    if (!open) return
    setLog([])
    setFailed(false)
    let saved: string | null = null
    try {
      saved = localStorage.getItem(LOCATION_KEY)
    } catch {
      // Falls back to the open folder's parent or the home folder.
    }
    const root = useStore.getState().root
    if (saved) setLocation(saved)
    else if (root) setLocation(root.replace(/[\\/][^\\/]+[\\/]?$/, ''))
    else homeDir().then(setLocation)
    const programs = new Set(TEMPLATES.flatMap((t) => t.needs.map((n) => n.program)).concat('git'))
    for (const p of programs) ipc.which(p).then((found) => setTools((t) => ({ ...t, [p]: !!found })))
  }, [open])

  useEffect(() => {
    if (!dir) return
    ipc.pathState(dir).then(setTarget)
  }, [dir])

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [log])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !running && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, running, setOpen])

  if (!open) return null

  const pick = (t: Template) => {
    setTemplateId(t.id)
    setOptions(defaultsFor(t))
  }
  const browse = async () => {
    const picked = await openDialog({ directory: true, multiple: false, title: 'Where to create the project', defaultPath: location || undefined })
    if (typeof picked === 'string') setLocation(picked)
  }

  const missing = template.needs.filter((n) => tools[n.program] === false)
  const nameOk = NAME_PATTERN.test(name)
  const problem = !nameOk
    ? 'Use letters, digits, _ . or - and start with a letter.'
    : target === 'used'
      ? 'A folder with that name already exists and isn’t empty.'
      : missing.length
        ? `Needs ${missing.map((m) => m.label).join(' and ')}.`
        : git && tools.git === false
          ? 'Git isn’t installed; untick “Create a git repository”.'
          : ''

  const create = async () => {
    if (problem || running || !dir) return
    const answers: Answers = { name, location, git, options }
    const steps = withGit(template, answers, dir, template.steps(answers, dir))
    setRunning(true)
    setFailed(false)
    setLog([])
    const add = (line: string) => setLog((l) => [...l, line].slice(-400))
    try {
      localStorage.setItem(LOCATION_KEY, location)
    } catch {
      // Remembering the location is a convenience only.
    }
    try {
      for (const step of steps) {
        if (step.kind === 'mkdir') await ipc.createDir(step.path)
        else if (step.kind === 'write') {
          add(`✓ wrote ${step.path.slice(dir.length + 1) || step.path}`)
          await ipc.writeText(step.path, step.content)
        } else {
          add(`> ${step.command}`)
          const code = await runCommand(step.command, add, step.cwd)
          if (code !== 0) throw new Error(`${step.label} failed (exit ${code})`)
        }
      }
      add('Done.')
      const store = useStore.getState()
      store.openFolder(dir)
      await store.openFile(joinPath(dir, template.openFile(answers)))
      store.toast(`Created ${name}`, 'success')
      setOpen(false)
    } catch (e) {
      add(String(e))
      setFailed(true)
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="palette-backdrop settings-backdrop" onMouseDown={() => !running && setOpen(false)}>
      <div className="wizard" onMouseDown={(e) => e.stopPropagation()}>
        <nav className="wizard-nav">
          <div className="settings-heading">New project</div>
          {groups.map((g) => (
            <div key={g} className="wizard-group">
              <div className="wizard-group-label">{g}</div>
              {TEMPLATES.filter((t) => t.group === g).map((t) => (
                <button key={t.id} className={`wizard-template${t.id === templateId ? ' active' : ''}`} onClick={() => pick(t)} disabled={running}>
                  <span className="kind-badge" style={{ ['--lane' as string]: `var(--lane-${t.badge.lane})` }}>
                    {t.badge.letter}
                  </span>
                  {t.label}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <section className="wizard-body">
          <div className="settings-body-head">
            <span>{template.label}</span>
            <button className="icon-btn" title="Close (Esc)" onClick={() => setOpen(false)} disabled={running}>
              <Icon name="close" size={14} />
            </button>
          </div>
          <p className="set-note">{template.description}</p>

          <div className="wizard-form">
            <label>Name</label>
            <input className={`field${nameOk ? '' : ' invalid'}`} value={name} onChange={(e) => setName(e.target.value)} spellCheck={false} autoFocus />
            <label>Location</label>
            <div className="wizard-location">
              <input className="field" value={location} onChange={(e) => setLocation(e.target.value)} spellCheck={false} />
              <button className="btn" onClick={browse}>
                Browse…
              </button>
            </div>
            <span />
            <span className="set-hint">Creates {dir || '…'}</span>
            {template.options.map((o) => (
              <OptionField key={o.id} option={o} value={options[o.id]} onChange={(v) => setOptions((x) => ({ ...x, [o.id]: v }))} />
            ))}
            <label>Git</label>
            <label className="wizard-check">
              <button className={`toggle${git ? ' on' : ''}`} role="switch" aria-checked={git} onClick={() => setGit(!git)}>
                <span />
              </button>
              Create a git repository
            </label>
          </div>

          {missing.length > 0 && (
            <div className="wizard-warning">
              {missing.map((m) => (
                <span key={m.program}>
                  This template uses <code>{m.program}</code>, which isn’t installed.{' '}
                  <button className="link-btn" onClick={() => ipc.openExternal(m.url)}>
                    Get {m.label} <Icon name="external" size={11} />
                  </button>
                </span>
              ))}
            </div>
          )}

          {log.length > 0 && <pre ref={logRef} className={`install-log wizard-log${failed ? ' failed' : ''}`}>{log.join('\n')}</pre>}

          <div className="wizard-actions">
            {problem && !missing.length && <span className="wizard-problem">{problem}</span>}
            <button className="btn" onClick={() => setOpen(false)} disabled={running}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={create} disabled={!!problem || running}>
              {running ? 'Creating…' : 'Create'}
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}

function OptionField({
  option,
  value,
  onChange
}: {
  option: Template['options'][number]
  value: string | boolean | undefined
  onChange: (v: string | boolean) => void
}) {
  return (
    <>
      <label>{option.type === 'toggle' ? '' : option.label}</label>
      {option.type === 'select' ? (
        <div className="seg wizard-seg">
          {option.choices!.map((c) => (
            <button key={c.value} className={value === c.value ? 'on' : ''} onClick={() => onChange(c.value)}>
              {c.label}
            </button>
          ))}
        </div>
      ) : option.type === 'toggle' ? (
        <label className="wizard-check" title={option.hint}>
          <button className={`toggle${value ? ' on' : ''}`} role="switch" aria-checked={!!value} onClick={() => onChange(!value)}>
            <span />
          </button>
          {option.label}
        </label>
      ) : (
        <input className="field" value={String(value ?? '')} placeholder={option.hint} onChange={(e) => onChange(e.target.value)} spellCheck={false} />
      )}
    </>
  )
}
