import type { CSSProperties } from 'react'

/** Same stroke icon set as CrumbTree, trimmed to what an editor needs. */
const PATHS = {
  folder: 'M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6z',
  file: 'M6 3h8l4 4v14H6zM14 3v4h4',
  fileCode: 'M6 3h8l4 4v14H6zM14 3v4h4M10 12l-2 2 2 2M14 12l2 2-2 2',
  fileText: 'M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h4',
  chevronDown: 'M6 9l6 6 6-6',
  check: 'M4 12l5 5L20 6',
  plus: 'M12 5v14M5 12h14',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  external: 'M14 5h5v5M19 5l-8 8M12 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-6',
  keyboard: 'M3 7h18v10H3zM7 11h.01M11 11h.01M15 11h.01M8 14h8',
  template: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM16.5 13v7M13 16.5h7',
  settings: 'M4 7h10M18 7h2M4 17h4M12 17h8M16 5v4M10 15v4',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  folderOpen: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1M3 7v10a2 2 0 0 0 2 2h12l4-8H7l-4 8',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.5-4.5',
  refresh: 'M20 11a8 8 0 1 0-1 5m1 4v-5h-5',
  close: 'M6 6l12 12M18 6L6 18',
  chevron: 'M9 6l6 6-6 6',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 4v3M20.5 5.5h-3',
  plug: 'M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0V8zM12 17v4',
  terminal: 'M4 5h16v14H4zM7 9l3 3-3 3M13 15h4',
  winMin: 'M5 12h14',
  winMax: 'M5 5h14v14H5z',
  /** The Whisk logo: the app icon's balloon of wires and handle, at 24px. */
  logo: 'M9.7 14.3C6 10.7 14.1 2.6 18.4 5.6C21.4 9.9 13.3 18 9.7 14.3ZM9.7 14.3C8.3 10.4 15 4.3 18.4 5.6M9.7 14.3C13.6 15.7 19.7 9 18.4 5.6M9.2 14.8L4.9 19.1',
  download: 'M12 4v11m0 0l-4-4m4 4l4-4M5 20h14',
  split: 'M4 5h16v14H4zM12 5v14',
  diff: 'M7 4v10M3 9h8M13 17h8M17 4l-4 4 4 4',
  branch: 'M6 4v12M6 16a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM18 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM18 8c0 5-12 3-12 8',
  play: 'M7 4l13 8-13 8z',
  stop: 'M6 6h12v12H6z',
  bug: 'M9 7V5a3 3 0 0 1 6 0v2M7 9h10v5a5 5 0 0 1-10 0zM3 12h4M17 12h4M4 7l3 2M20 7l-3 2M4 19l3-2M20 19l-3-2M12 11v8',
  beaker: 'M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3M7.5 14h9',
  stepOver: 'M4 14a8 8 0 0 1 15-3M19 5v6h-6M11 19a1 1 0 1 0 2 0 1 1 0 0 0-2 0',
  stepInto: 'M12 3v11M8 10l4 4 4-4M11 19a1 1 0 1 0 2 0 1 1 0 0 0-2 0',
  stepOut: 'M12 15V4M8 8l4-4 4 4M11 19a1 1 0 1 0 2 0 1 1 0 0 0-2 0',
  resume: 'M6 4v16M10 4l10 8-10 8z'
}

export type IconName = keyof typeof PATHS

export function Icon({
  name,
  size = 16,
  className,
  style,
  strokeWidth = 1.7
}: {
  name: IconName
  size?: number
  className?: string
  style?: CSSProperties
  strokeWidth?: number
}) {
  return (
    <svg
      className={className}
      style={style}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={PATHS[name]} />
    </svg>
  )
}
