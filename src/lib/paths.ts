/** `C:\Dev`, `C:/Dev` and `/home/me` are absolute; `src/main.rs` isn't. */
export const isAbsolute = (p: string) => /^([A-Za-z]:[\\/]|\/)/.test(p)

export function baseName(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] || path
}

export function extension(path: string): string {
  const name = baseName(path)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export function relativePath(root: string | null, path: string): string {
  if (!root) return path
  const r = root.replace(/[\\/]+$/, '')
  return path.toLowerCase().startsWith(r.toLowerCase()) ? path.slice(r.length + 1) : path
}

export function joinPath(dir: string, name: string): string {
  const sep = dir.includes('\\') ? '\\' : '/'
  return dir.replace(/[\\/]+$/, '') + sep + name
}

/** `F:\Dev\a b.cs` → `file:///F:/Dev/a%20b.cs` */
export function pathToUri(path: string): string {
  const forward = path.replace(/\\/g, '/')
  const encoded = forward
    .split('/')
    .map((seg, i) => (i === 0 && /^[A-Za-z]:$/.test(seg) ? seg : encodeURIComponent(seg)))
    .join('/')
  return encoded.startsWith('/') ? `file://${encoded}` : `file:///${encoded}`
}

export function uriToPath(uri: string): string {
  let path = decodeURIComponent(uri.replace(/^file:\/\//, ''))
  // `/F:/Dev/...` on Windows
  if (/^\/[A-Za-z]:/.test(path)) path = path.slice(1).replace(/\//g, '\\')
  return path
}

/** Servers differ on drive-letter case and escaping, so compare URIs through this. */
export function normalizeUri(uri: string): string {
  return uriToPath(uri).replace(/\\/g, '/').toLowerCase()
}

export function samePath(a: string, b: string): boolean {
  return a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase()
}
