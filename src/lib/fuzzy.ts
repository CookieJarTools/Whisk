/**
 * Fuzzy matching for the search popups. Characters must appear in order; hits
 * at word starts, CamelCase humps (`VCh` → VoxelChunk) and runs of consecutive
 * characters score higher, and shorter texts win ties.
 */

export interface FuzzyMatch {
  score: number
  /** Indexes of the matched characters in the text, for highlighting. */
  positions: number[]
}

function isBoundary(text: string, i: number): boolean {
  if (i === 0) return true
  const prev = text[i - 1]
  const ch = text[i]
  if ('/\\._-: '.includes(prev)) return true
  return ch >= 'A' && ch <= 'Z' && !(prev >= 'A' && prev <= 'Z')
}

export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const q = query.replace(/\s+/g, '')
  if (!q) return { score: 0, positions: [] }
  const lowerText = text.toLowerCase()
  const lowerQuery = q.toLowerCase()
  // Exact substring beats any scattered match.
  const sub = lowerText.indexOf(lowerQuery)
  if (sub >= 0) {
    const positions = Array.from({ length: q.length }, (_, k) => sub + k)
    return { score: 100 + (isBoundary(text, sub) ? 40 : 0) - text.length * 0.05 - sub * 0.5, positions }
  }
  const positions: number[] = []
  let score = 0
  let ti = 0
  for (let qi = 0; qi < lowerQuery.length; qi++) {
    const ch = lowerQuery[qi]
    // Prefer the next hump or word start for this character, else the next occurrence.
    let found = -1
    for (let i = ti; i < lowerText.length; i++) {
      if (lowerText[i] === ch && isBoundary(text, i)) {
        found = i
        break
      }
    }
    const plain = lowerText.indexOf(ch, ti)
    if (plain < 0 && found < 0) return null
    if (found < 0 || (plain >= 0 && plain === ti)) found = plain
    const consecutive = positions.length > 0 && found === positions[positions.length - 1] + 1
    score += 1 + (isBoundary(text, found) ? 8 : 0) + (consecutive ? 4 : 0)
    positions.push(found)
    ti = found + 1
  }
  return { score: score - text.length * 0.05, positions }
}
