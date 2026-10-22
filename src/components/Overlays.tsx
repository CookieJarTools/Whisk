import { useEffect } from 'react'
import { useStore } from '../store/store'

export function ContextMenu() {
  const menu = useStore((s) => s.menu)
  const close = useStore((s) => s.closeMenu)

  useEffect(() => {
    if (!menu) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', close)
    }
  }, [menu, close])

  if (!menu) return null
  const left = Math.min(menu.x, window.innerWidth - 240)
  const top = Math.min(menu.y, window.innerHeight - menu.items.length * 30 - 16)
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 59 }} onMouseDown={close} onContextMenu={(e) => e.preventDefault()}>
      <div className="ctxmenu" style={{ left, top }} onMouseDown={(e) => e.stopPropagation()}>
        {menu.items.map((item, i) => {
          if (item.type === 'divider') return <div key={i} className="ctxmenu-sep" />
          if (item.type === 'header') return <div key={i} className="ctxmenu-header">{item.label}</div>
          return (
            <button
              key={i}
              className="ctxmenu-item"
              onClick={() => {
                close()
                item.onSelect?.()
              }}
            >
              {item.label}
              {item.hint && <span className="hint">{item.hint}</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts)
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.message}
        </div>
      ))}
    </div>
  )
}
