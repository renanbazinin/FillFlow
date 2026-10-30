import bidiFactory, { type Bidi, type EmbeddingLevels } from 'bidi-js'

/**
 * Bidirectional text for PDF appearance streams.
 *
 * A PDF content stream draws glyphs strictly left-to-right, so Hebrew (or any RTL) text must be
 * written in *visual* order. pdf-lib can't do this itself: fontkit reverses a whole string when
 * its first script character is RTL ("שלום 123" → "321 םולש") and never reverses when it is LTR.
 * These helpers run the Unicode Bidirectional Algorithm (bidi-js) and return strings in visual
 * order, with RTL brackets mirrored and combining marks kept after their base character.
 * Callers then encode the result one code point at a time so fontkit can't reorder it again.
 */

export type Direction = 'ltr' | 'rtl'

let instance: Bidi | null = null
const bidi = () => (instance ??= bidiFactory())

/** Characters of right-to-left scripts. */
const RTL_SCRIPT = /[\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Samaritan}\p{Script=Mandaic}\p{Script=Adlam}]/u

/** RLM, RLE, RLO and RLI force right-to-left runs too. */
const RTL_CONTROLS = new Set([0x200f, 0x202b, 0x202e, 0x2067])

/** Invisible formatting characters that must not reach a content stream (they'd draw .notdef boxes). */
function isInvisible(c: number): boolean {
  return (
    c === 0xad ||
    c === 0x61c ||
    (c >= 0x200b && c <= 0x200f) ||
    (c >= 0x202a && c <= 0x202e) ||
    (c >= 0x2060 && c <= 0x2069) ||
    c === 0xfeff
  )
}

const MARK = /^\p{M}$/u
const ZWJ = 0x200d

export function hasRtl(text: string): boolean {
  if (RTL_SCRIPT.test(text)) return true
  for (let i = 0; i < text.length; i++) if (RTL_CONTROLS.has(text.charCodeAt(i))) return true
  return false
}

/** Direction of the first strong character (what HTML `dir="auto"` uses); LTR when there is none. */
export function baseDirection(text: string): Direction {
  if (!hasRtl(text)) return 'ltr'
  const b = bidi()
  for (const ch of text) {
    const t = b.getBidiCharTypeName(ch)
    if (t === 'L') return 'ltr'
    if (t === 'R' || t === 'AL') return 'rtl'
  }
  return 'ltr'
}

export function stripInvisible(text: string): string {
  let out = ''
  for (let i = 0; i < text.length; i++) if (!isInvisible(text.charCodeAt(i))) out += text[i]
  return out
}

/** Cluster index per UTF-16 code unit: a base character plus its combining marks / surrogate half. */
function clusterIds(text: string): Int32Array {
  const ids = new Int32Array(text.length)
  let id = -1
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    const lowHalf = c >= 0xdc00 && c <= 0xdfff && i > 0 && (text.charCodeAt(i - 1) & 0xfc00) === 0xd800
    const cp = text.codePointAt(i) ?? c
    const joins = lowHalf || (i > 0 && (cp === ZWJ || MARK.test(String.fromCodePoint(cp))))
    if (!joins) id++
    ids[i] = Math.max(id, 0)
  }
  return ids
}

export interface BidiParagraph {
  /** Visual-order text of the code-unit range [start, end) — one laid-out line. */
  line(start: number, end: number): string
}

/** Prepares one paragraph (no line breaks) for line-by-line visual reordering. */
export function bidiParagraph(text: string, direction: Direction): BidiParagraph {
  if (direction === 'ltr' && !hasRtl(text)) {
    return { line: (start, end) => stripInvisible(text.slice(start, end)) }
  }
  const b = bidi()
  const levels: EmbeddingLevels = b.getEmbeddingLevels(text, direction)
  const mirrored = b.getMirroredCharactersMap(text, levels.levels)
  const clusters = clusterIds(text)
  return {
    line(start, end) {
      if (end <= start) return ''
      // bidi-js returns indices for the whole string with only [start, end] reordered.
      const order = b.getReorderedIndices(text, levels, start, end - 1).slice(start, end)
      let out = ''
      // A reversed RTL run puts marks before their base and low surrogates before high ones;
      // restore logical order inside every cluster.
      for (let i = 0; i < order.length; ) {
        let j = i + 1
        while (j < order.length && clusters[order[j]] === clusters[order[i]]) j++
        const group = order.slice(i, j).sort((x, y) => x - y)
        for (const k of group) out += mirrored.get(k) ?? text[k]
        i = j
      }
      return stripInvisible(out)
    },
  }
}

/** Visual order of a single line of text. */
export function visualOrder(text: string, direction: Direction = baseDirection(text)): string {
  return bidiParagraph(text, direction).line(0, text.length)
}
