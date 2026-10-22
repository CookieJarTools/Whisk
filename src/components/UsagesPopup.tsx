import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { baseName, relativePath } from '../lib/paths'
import { useStore } from '../store/store'
import { jumpTo } from '../editor/navigation'
import { fileIcon } from './Sidebar'
import { Icon } from './Icon'

/** One place a symbol is declared or used. `line` is 1-based, `col` a UTF-16 offset in that line. */
export interface Usage {
  path: string
  line: number
  col: number
  len: number
  text: string
}

interface PopupState {
  x: number
  y: number
  title: string
  items: Usage[]
  /** Found by text search rather than a language server, so comments and strings can show up. */
  approximate: boolean
  returnFocus: () => void
}

const usePopup = create<{ popup: PopupState | null; set(p: PopupState | null): void }>((set) => ({
  popup: null,
  set: (popup) => set({ popup })
}))

export function showUsagesPopup(popup: PopupState) {
  usePopup.getState().set(popup)
}

const WIDTH = 680
const MAX_HEIGHT = 380

function Snippet({ usage }: { usage: Usage }) {
  const lead = usage.text.length - usage.text.trimStart().length
  const text = usage.text.trim()
  const start = usage.col - lead
  if (usage.len <= 0 || start < 0 || start >= text.length) return <>{text}</>
  return (
    <>
      {text.slice(0, start)}
      <mark>{text.slice(start, start + usage.len)}</mark>
      {text.slice(start + usage.len)}
    </>
  )
}

/** Rider-style list of usages (or declarations), shown at the cursor. */
export function UsagesPopup() {
  const popup = usePopup((s) => s.popup)
  const root = useStore((s) => s.root)
  const [index, setIndex] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!popup) return
    setIndex(0)
    requestAnimationFrame(() => boxRef.current?.focus())
  }, [popup])

  useEffect(() => {
    boxRef.current?.querySelector('.usage-row.active')?.scrollIntoView({ block: 'nearest' })
  }, [index])

  if (!popup) return null

  const close = (refocus = true) => {
    usePopup.getState().set(null)
    if (refocus) popup.returnFocus()
  }
  const open = (u: Usage | undefined) => {
    if (!u) return
    close(false)
    void jumpTo(u.path, u.line, u.col, u.len)
  }
  const left = Math.max(8, Math.min(popup.x, window.innerWidth - WIDTH - 8))
  const top = popup.y + MAX_HEIGHT > window.innerHeight - 8 ? Math.max(8, popup.y - MAX_HEIGHT - 28) : popup.y
  const files = new Set(popup.items.map((u) => u.path)).size

  return (
    <div className="usages-backdrop" onMouseDown={() => close()}>
      <div
        ref={boxRef}
        className="usages"
        style={{ left, top, width: WIDTH }}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close()
          else if (e.key === 'ArrowDown') setIndex((i) => Math.min(i + 1, popup.items.length - 1))
          else if (e.key === 'ArrowUp') setIndex((i) => Math.max(i - 1, 0))
          else if (e.key === 'PageDown') setIndex((i) => Math.min(i + 10, popup.items.length - 1))
          else if (e.key === 'PageUp') setIndex((i) => Math.max(i - 10, 0))
          else if (e.key === 'Enter') open(popup.items[index])
          else return
          e.preventDefault()
          e.stopPropagation()
        }}
      >
        <div className="usages-head">
          <span className="usages-title">{popup.title}</span>
          <span className="usages-count">
            {popup.items.length} in {files} file{files === 1 ? '' : 's'}
          </span>
          {popup.approximate && (
            <span className="usages-note" title="No language server for this file, so these are whole-word text matches. Comments and strings can appear.">
              text matches
            </span>
          )}
          <button className="icon-btn" title="Close (Esc)" onClick={() => close()}>
            <Icon name="close" size={13} />
          </button>
        </div>
        <div className="usages-list" style={{ maxHeight: MAX_HEIGHT }}>
          {popup.items.map((u, i) => {
            const { icon, colour } = fileIcon(u.path)
            return (
              <button
                key={`${u.path}:${u.line}:${u.col}`}
                className={`usage-row${i === index ? ' active' : ''}`}
                onMouseMove={() => i !== index && setIndex(i)}
                onClick={() => open(u)}
                title={`${relativePath(root, u.path)}:${u.line}`}
              >
                <Icon name={icon} size={13} style={{ color: colour }} />
                <span className="usage-file">
                  {baseName(u.path)}
                  <span className="usage-line">:{u.line}</span>
                </span>
                <span className="usage-code">
                  <Snippet usage={u} />
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
