import { Facet } from '@codemirror/state'

/**
 * The line ending a file is saved with. The editor itself splits lines on any
 * ending (so every part of Whisk counts lines the same way, even in files that
 * mix them); this remembers which one to write back.
 */
export const lineEnding = Facet.define<string, string>({ combine: (values) => values[0] ?? '\n' })

/** The ending most lines use: `\r\n` for a mostly-Windows file, else `\n`. */
export function dominantLineEnding(text: string): '\r\n' | '\n' {
  const crlf = (text.match(/\r\n/g) ?? []).length
  const lf = (text.match(/\n/g) ?? []).length - crlf
  return crlf > lf ? '\r\n' : '\n'
}
