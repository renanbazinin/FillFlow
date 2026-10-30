import bidiFactory from 'bidi-js'
import type { Font as FkFont, Glyph, GlyphPosition, GlyphRun, TypeFeatures } from '@pdf-lib/fontkit'

/**
 * Text shaping for the exporter: Unicode bidi (bidi-js) splits a line into directional runs
 * in visual order; each run is shaped by fontkit in logical order with an explicit direction,
 * which yields glyphs in visual (left→right) order plus GPOS positions.
 *
 * Why not let pdf-lib shape whole strings? fontkit picks the direction from the *first*
 * strong-script character and reverses the entire string when it is Hebrew ("שלום Hello"
 * comes out as "olleH םולש"), never mirrors brackets, and pdf-lib drops glyph positions.
 */

const bidi = bidiFactory()

/**
 * Same features the editor renders with: no kerning, no ligatures/contextual alternates
 * (CSS `font-kerning: none; font-variant-ligatures: none`). Shaping features scripts need
 * (ccmp, locl, mark, mkmk, rlig…) stay on.
 */
export const SHAPING_FEATURES: TypeFeatures = {
  kern: false,
  liga: false,
  clig: false,
  dlig: false,
  hlig: false,
  calt: false,
}

/** fontkit's runtime `layout` takes script/language/direction too (missing from its typings). */
type LayoutFn = (text: string, features: TypeFeatures, script?: string, language?: string, direction?: 'ltr' | 'rtl') => GlyphRun

/** Default-ignorable code points (bidi controls, ZWJ/ZWNJ, variation selectors…): invisible, zero width. */
const IGNORABLE: [number, number][] = [
  [0x00ad, 0x00ad],
  [0x034f, 0x034f],
  [0x061c, 0x061c],
  [0x115f, 0x1160],
  [0x17b4, 0x17b5],
  [0x180b, 0x180f],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x206f],
  [0x3164, 0x3164],
  [0xfe00, 0xfe0f],
  [0xfeff, 0xfeff],
  [0xffa0, 0xffa0],
  [0xfff0, 0xfff8],
  [0x1bca0, 0x1bca3],
  [0x1d173, 0x1d17a],
  [0xe0000, 0xe0fff],
]

export function isIgnorable(codePoint: number): boolean {
  for (const [a, b] of IGNORABLE) if (codePoint >= a && codePoint <= b) return true
  return false
}

/** Text as it is actually painted: ignorables removed; tab, form feed and CR become spaces (as in canvas). */
export function paintableText(text: string): string {
  let out = ''
  for (const ch of text) {
    const cp = ch.codePointAt(0)!
    if (cp === 9 || cp === 12 || cp === 13) out += ' '
    else if (!isIgnorable(cp)) out += ch
  }
  return out
}

export type Direction = 'ltr' | 'rtl'

/** Direction of the first strong character (what `dir="auto"` uses), or null if there is none. */
export function firstStrongDirection(text: string): Direction | null {
  for (const ch of text) {
    const t = bidi.getBidiCharTypeName(ch)
    if (t === 'L') return 'ltr'
    if (t === 'R' || t === 'AL') return 'rtl'
  }
  return null
}

export interface VisualRun {
  /** Logical range within the line, [start, end) in UTF-16 units. */
  start: number
  end: number
  level: number
  rtl: boolean
  /** Logical-order text of the run with RTL mirroring applied (e.g. "(" → ")"). */
  text: string
}

/**
 * Splits one line into directional runs ordered left→right as displayed.
 * `base` forces the paragraph direction; omit for auto (first strong character).
 */
export function visualRuns(line: string, base?: Direction): VisualRun[] {
  if (!line) return []
  const emb = bidi.getEmbeddingLevels(line, base ?? 'auto')
  const order = bidi.getReorderedIndices(line, emb, 0, line.length - 1)
  const mirrors = bidi.getMirroredCharactersMap(line, emb.levels, 0, line.length - 1)
  const runs: Omit<VisualRun, 'text'>[] = []
  for (const idx of order) {
    const level = emb.levels[idx]
    const last = runs[runs.length - 1]
    if (last && last.level === level) {
      if (level & 1 && idx === last.start - 1) {
        last.start = idx
        continue
      }
      if (!(level & 1) && idx === last.end) {
        last.end = idx + 1
        continue
      }
    }
    runs.push({ start: idx, end: idx + 1, level, rtl: (level & 1) === 1 })
  }
  return runs.map((r) => {
    let text = ''
    for (let i = r.start; i < r.end; i++) text += mirrors.get(i) ?? line[i]
    return { ...r, text }
  })
}

export interface ShapedRun extends VisualRun {
  /** Glyphs in visual order. */
  glyphs: Glyph[]
  positions: GlyphPosition[]
  /** Total advance in font units. */
  advance: number
}

/** Shapes one run of text (logical order) with an explicit direction; glyphs come back in visual order. */
export function shapeText(font: FkFont, text: string, direction: Direction): { glyphs: Glyph[]; positions: GlyphPosition[]; advance: number } {
  const clean = paintableText(text)
  if (!clean) return { glyphs: [], positions: [], advance: 0 }
  const run = (font.layout as unknown as LayoutFn).call(font, clean, SHAPING_FEATURES, undefined, undefined, direction)
  let advance = 0
  for (const p of run.positions) advance += p.xAdvance
  return { glyphs: run.glyphs, positions: run.positions, advance }
}

/** Bidi-reorders and shapes a line. */
export function shapeLine(font: FkFont, line: string, base?: Direction): ShapedRun[] {
  return visualRuns(line, base).map((r) => ({ ...r, ...shapeText(font, r.text, r.rtl ? 'rtl' : 'ltr') }))
}

/** True when some visible character of `text` has no glyph in `font`. */
export function hasMissingGlyphs(font: FkFont, text: string): boolean {
  for (const ch of paintableText(text)) {
    const cp = ch.codePointAt(0)!
    if (cp === 10 || cp === 32) continue
    if (!font.hasGlyphForCodePoint(cp)) return true
  }
  return false
}

/** Advance width of a line in points, shaped exactly like the exporter draws it. */
export function shapedLineWidth(font: FkFont, line: string, fontSize: number, base?: Direction): number {
  let advance = 0
  for (const run of shapeLine(font, line, base)) advance += run.advance
  return (advance / font.unitsPerEm) * fontSize
}
