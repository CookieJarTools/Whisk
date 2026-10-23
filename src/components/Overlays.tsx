import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useStore } from '../store/store'

export function ContextMenu() {
  const menu = useStore((s) => s.menu)
  const close = useStore((s) => s.closeMenu)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  // Measure the menu, then keep it inside the window.
  useLayoutEffect(() => {
    if (!menu || !ref.current) return setPos(null)
    const { width, height } = ref.current.getBoundingClientRect()
    setPos({
      left: Math.max(8, Math.min(menu.x, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(menu.y, window.innerHeight - height - 8))
    })
  }, [menu])

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
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 59 }} onMouseDown={close} onContextMenu={(e) => e.preventDefault()}>
      <div
        ref={ref}
        className="ctxmenu"
        style={pos ? pos : { left: menu.x, top: menu.y, visibility: 'hidden' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {menu.items.map((item, i) => {
          if (item.type === 'divider') return <div key={i} className="ctxmenu-sep" />
          if (item.type === 'header') return <div key={i} className="ctxmenu-header">{item.label}</div>
          return (
            <button
              key={i}
              className="ctxmenu-item"
              disabled={!item.onSelect}
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
