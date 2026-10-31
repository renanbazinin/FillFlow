import bidiFactory from 'bidi-js'
import type { Font as FkFont, Glyph, GlyphPosition, GlyphRun, TypeFeatures } from '@pdf-lib/fontkit'
import { graphemes, isIgnorable } from '../text/layout'

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

export interface ShapedText {
  /** Glyphs in visual order. */
  glyphs: Glyph[]
  positions: GlyphPosition[]
  /** Grapheme cluster (index in logical order) of each glyph: letter spacing goes after a whole cluster. */
  clusters: number[]
  /** Total advance in font units. */
  advance: number
}

export interface ShapedRun extends VisualRun, ShapedText {}

/** Hebrew points that compose with their letter into a precomposed glyph: dagesh/mapiq, shin dot, sin dot. */
const COMPOSING_POINTS = '\u05BC\u05C1\u05C2'
const HEBREW_POINTED = /[\u05D0-\u05EA][\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7]{2,}/g

/**
 * Moves dagesh, shin dot and sin dot right after their letter. Canonical order puts vowels first
 * (שָׁ is shin, qamats, shin dot), but the fonts only compose letter + dagesh/dot into their
 * precomposed glyph when the two are adjacent, and otherwise leave the dot unpositioned, beside
 * the letter. Browsers (HarfBuzz) compose them in either order.
 */
function composingPointsFirst(text: string): string {
  return text.replace(HEBREW_POINTED, (cluster) => {
    const [letter, ...points] = cluster
    const first = points.filter((p) => COMPOSING_POINTS.includes(p)).sort()
    return letter + first.join('') + points.filter((p) => !COMPOSING_POINTS.includes(p)).join('')
  })
}

/**
 * The grapheme cluster each glyph belongs to. fontkit records the code points behind every glyph,
 * and in logical order the glyphs consume the text's code points in turn.
 */
function glyphClusters(text: string, glyphs: Glyph[], direction: Direction): number[] {
  const clusterOf: number[] = []
  graphemes(text).forEach((cluster, i) => {
    for (const _ of cluster) clusterOf.push(i)
  })
  const out = new Array<number>(glyphs.length)
  let consumed = 0
  let cluster = 0
  for (let n = 0; n < glyphs.length; n++) {
    const i = direction === 'rtl' ? glyphs.length - 1 - n : n
    const count = glyphs[i].codePoints.length
    // A glyph without code points (an extra glyph a character was split into) joins the previous one.
    if (count) cluster = clusterOf[Math.min(consumed, clusterOf.length - 1)]
    consumed += count
    out[i] = cluster
  }
  return out
}

/** Shapes one run of text (logical order) with an explicit direction; glyphs come back in visual order. */
export function shapeText(font: FkFont, text: string, direction: Direction): ShapedText {
  const clean = composingPointsFirst(paintableText(text))
  if (!clean) return { glyphs: [], positions: [], clusters: [], advance: 0 }
  const run = (font.layout as unknown as LayoutFn).call(font, clean, SHAPING_FEATURES, undefined, undefined, direction)
  let advance = 0
  for (const p of run.positions) advance += p.xAdvance
  return { glyphs: run.glyphs, positions: run.positions, clusters: glyphClusters(clean, run.glyphs, direction), advance }
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
