import { useEffect, useState } from 'react'
import { useSettings } from '../store/settings'
import { useStore } from '../store/store'
import { DEFAULT_IGNORE, PROJECT_CONFIG_PATH, type CustomRule, type OptionValue, type Severity } from '../lint/config'
import { RULES } from '../lint/rules'
import { createProjectConfig, effectiveLintConfig, useProjectLint, userLintConfig } from '../lint/project'
import { Icon } from './Icon'

const SEVERITIES: { value: Severity; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'info', label: 'Note' },
  { value: 'warning', label: 'Warning' },
  { value: 'error', label: 'Error' }
]

function SeverityPicker({ value, onChange }: { value: Severity; onChange: (s: Severity) => void }) {
  return (
    <div className="seg severity-seg">
      {SEVERITIES.map((s) => (
        <button key={s.value} className={`${value === s.value ? 'on' : ''} sev-${s.value}`} onClick={() => onChange(s.value)}>
          {s.label}
        </button>
      ))}
    </div>
  )
}

function CustomRuleForm({ onAdd, onCancel }: { onAdd: (rule: CustomRule) => void; onCancel: () => void }) {
  const [id, setId] = useState('')
  const [pattern, setPattern] = useState('')
  const [message, setMessage] = useState('')
  const [files, setFiles] = useState('')
  const [ignoreCase, setIgnoreCase] = useState(false)
  let patternError = ''
  try {
    if (pattern) new RegExp(pattern)
  } catch (e) {
    patternError = (e as Error).message
  }
  const valid = /^[\w-]+$/.test(id) && pattern && !patternError && message.trim()
  return (
    <div className="server-form">
      <div className="server-form-grid">
        <label>Name</label>
        <input className="field" value={id} onChange={(e) => setId(e.target.value)} placeholder="e.g. no-find-object (letters, digits, - and _)" />
        <label>Pattern</label>
        <input className={`field${patternError ? ' invalid' : ''}`} value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="A regular expression, e.g. FindObjectOfType" spellCheck={false} />
        <label>Message</label>
        <input className="field" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Shown on each match, e.g. Cache this in Awake instead" />
        <label>Files</label>
        <input className="field" value={files} onChange={(e) => setFiles(e.target.value)} placeholder="Optional, e.g. *.cs, Assets/Scripts/**" />
        <label />
        <label className="wizard-check">
          <button className={`toggle${ignoreCase ? ' on' : ''}`} role="switch" aria-checked={ignoreCase} onClick={() => setIgnoreCase(!ignoreCase)}>
            <span />
          </button>
          Ignore case
        </label>
      </div>
      {patternError && <p className="set-hint error">{patternError}</p>}
      <div className="server-form-actions">
        <button className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="btn btn-primary"
          disabled={!valid}
          onClick={() => onAdd({ id, pattern, message: message.trim(), severity: 'warning', files: files.trim() || undefined, flags: ignoreCase ? 'i' : undefined })}
        >
          Add rule
        </button>
      </div>
    </div>
  )
}

/** Settings › Linter: Whisk's own rules. Language-server errors are separate and always on. */
export function LinterSettings() {
  const lint = useSettings((s) => s.lint)
  const set = useSettings((s) => s.set)
  const root = useStore((s) => s.root)
  const project = useProjectLint()
  const [adding, setAdding] = useState(false)
  const [ignoreText, setIgnoreText] = useState('')
  const config = effectiveLintConfig()
  const userConfig = userLintConfig(lint)

  useEffect(() => {
    setIgnoreText((lint.ignore ?? DEFAULT_IGNORE).join('\n'))
  }, [lint.ignore])

  const setRule = (id: string, patch: { severity?: Severity; options?: Record<string, OptionValue> }) => {
    const current = lint.rules?.[id] ?? {}
    set({ lint: { ...lint, rules: { ...lint.rules, [id]: { ...current, ...patch, options: { ...current.options, ...patch.options } } } } })
  }
  const setCustom = (custom: CustomRule[]) => set({ lint: { ...lint, custom } })
  const custom = lint.custom ?? []
  const projectSets = (id: string) => !!project.overrides?.rules?.[id]

  return (
    <>
      <div className="set-row">
        <div className="set-text">
          <div className="set-title">Check files with Whisk’s rules</div>
          <div className="set-hint">Runs as you type, on every language. Errors from language servers show as well, whatever this is set to.</div>
        </div>
        <div className="set-control">
          <button className={`toggle${userConfig.enabled ? ' on' : ''}`} role="switch" aria-checked={userConfig.enabled} onClick={() => set({ lint: { ...lint, enabled: !userConfig.enabled } })}>
            <span />
          </button>
        </div>
      </div>

      <div className="set-row">
        <div className="set-text">
          <div className="set-title">Project rules</div>
          <div className={`set-hint${project.error ? ' error' : ''}`}>
            {project.error ??
              (project.path
                ? `This project has ${PROJECT_CONFIG_PATH}. Anything it sets wins over the settings below.`
                : `Save these rules to ${PROJECT_CONFIG_PATH} in the project to share them with your team through git.`)}
          </div>
        </div>
        <div className="set-control">
          {project.path ? (
            <button className="btn" onClick={() => useStore.getState().openFile(project.path!).then(() => useStore.getState().setSettingsOpen(false))}>
              Open {PROJECT_CONFIG_PATH}
            </button>
          ) : (
            <button
              className="btn"
              disabled={!root}
              title={root ? undefined : 'Open a folder first'}
              onClick={async () => {
                const path = await createProjectConfig()
                if (path) useStore.getState().toast(`Created ${PROJECT_CONFIG_PATH}`, 'success')
              }}
            >
              Create {PROJECT_CONFIG_PATH}
            </button>
          )}
        </div>
      </div>

      <div className="keymap-category" style={{ marginTop: 14 }}>
        Rules
      </div>
      {RULES.map((rule) => {
        const setting = userConfig.rules[rule.id]
        return (
          <div key={rule.id} className="set-row lint-rule">
            <div className="set-text">
              <div className="set-title">
                {rule.title}
                {projectSets(rule.id) && (
                  <span className="set-badge" title={`Set in ${PROJECT_CONFIG_PATH}: ${config.rules[rule.id].severity}`}>
                    Project: {config.rules[rule.id].severity}
                  </span>
                )}
              </div>
              <div className="set-hint">{rule.description}</div>
              {rule.options?.map((o) => (
                <label key={o.key} className="lint-option">
                  {o.label}
                  <input
                    className="field"
                    type={o.type === 'number' ? 'number' : 'text'}
                    min={o.type === 'number' ? 1 : undefined}
                    value={String(setting.options[o.key] ?? o.default)}
                    onChange={(e) => setRule(rule.id, { options: { [o.key]: o.type === 'number' ? Number(e.target.value) || Number(o.default) : e.target.value } })}
                  />
                </label>
              ))}
            </div>
            <div className="set-control">
              <SeverityPicker value={setting.severity} onChange={(severity) => setRule(rule.id, { severity })} />
            </div>
          </div>
        )
      })}

      <div className="keymap-category" style={{ marginTop: 14, display: 'flex', alignItems: 'center' }}>
        Your rules
        <button className="btn" style={{ marginLeft: 'auto' }} onClick={() => setAdding((a) => !a)}>
          <Icon name="plus" size={13} /> Add a rule
        </button>
      </div>
      {adding && (
        <CustomRuleForm
          onCancel={() => setAdding(false)}
          onAdd={(rule) => {
            setCustom([...custom.filter((c) => c.id !== rule.id), rule])
            setAdding(false)
          }}
        />
      )}
      {custom.length === 0 && !adding && <p className="set-note">Flag anything with a regular expression, e.g. a call your team has agreed to avoid.</p>}
      {custom.map((rule) => (
        <div key={rule.id} className="set-row lint-rule">
          <div className="set-text">
            <div className="set-title">{rule.id}</div>
            <div className="set-hint">
              <code>{rule.pattern}</code> · {rule.message}
              {rule.files && <> · {rule.files}</>}
            </div>
          </div>
          <div className="set-control server-controls">
            <SeverityPicker value={rule.severity} onChange={(severity) => setCustom(custom.map((c) => (c.id === rule.id ? { ...c, severity } : c)))} />
            <button className="icon-btn" title="Remove" onClick={() => setCustom(custom.filter((c) => c.id !== rule.id))}>
              <Icon name="trash" size={13} />
            </button>
          </div>
        </div>
      ))}

      <div className="keymap-category" style={{ marginTop: 14 }}>
        Ignored paths
      </div>
      <p className="set-note">One per line, relative to the project, e.g. Assets/Plugins/** or *.generated.cs.</p>
      <textarea
        className="field lint-ignore"
        value={ignoreText}
        spellCheck={false}
        onChange={(e) => setIgnoreText(e.target.value)}
        onBlur={() => set({ lint: { ...lint, ignore: ignoreText.split('\n').map((l) => l.trim()).filter(Boolean) } })}
      />

      <div className="server-form-actions" style={{ justifyContent: 'flex-start', marginTop: 16 }}>
        <button className="btn" onClick={() => set({ lint: {} })}>
          Reset to defaults
        </button>
      </div>
    </>
  )
}
