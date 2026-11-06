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

/** fontkit's matcher behind every contextual lookup (OTProcessor#match). */
type MatchFn = (this: unknown, index: number, sequence: unknown[], fn: unknown, matched?: unknown) => unknown

let backtrackFixed = false

/**
 * fontkit (1.1.1) compares the backtrack of a chaining contextual lookup with the glyphs before
 * the current one farthest first, but OpenType lists it nearest first, as HarfBuzz (the editor's
 * shaper) reads it. Tinos and Cousine position a point after a pointed letter with such lookups,
 * so the export moved the tsere of בְרֵא off where the screen draws it. All fonts share the
 * matcher, so it is fixed once: a backtrack is the only sequence matched backwards from the
 * current glyph, starting as many glyphs back as it is long.
 */
function matchBacktrackNearestFirst(font: FkFont): void {
  if (backtrackFixed) return
  const engine = (font as unknown as { _layoutEngine?: { engine?: { GPOSProcessor?: object; GSUBProcessor?: object } } })._layoutEngine?.engine
  let proto: object | null = engine?.GPOSProcessor ?? engine?.GSUBProcessor ?? null
  while (proto && !Object.hasOwn(proto, 'match')) proto = Object.getPrototypeOf(proto) as object | null
  if (!proto) return
  const target = proto as { match: MatchFn }
  const match = target.match
  target.match = function (index, sequence, fn, matched) {
    const backtrack = index < 0 && -index === sequence.length
    return match.call(this, index, backtrack ? [...sequence].reverse() : sequence, fn, matched)
  }
  backtrackFixed = true
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

export interface ShapedText {
  /** Glyphs in visual order. */
  glyphs: Glyph[]
  positions: GlyphPosition[]
  /** Grapheme cluster (index in logical order) of each glyph: letter spacing goes after a whole cluster. */
  clusters: number[]
  /**
   * Characters each glyph stands for, as typed: its code points, except that a mirrored bracket
   * stands for the bracket typed (the ")" glyph drawn for a right-to-left "("), and a Hebrew
   * presentation form for its letter and points (see spellOutPresentationForms). Copying gives these.
   */
  chars: string[]
  /** The grapheme clusters as typed (logical order, with the typed brackets, presentation forms spelled out); `clusters` indexes them. */
  typed: string[]
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
 * Hebrew presentation forms (שׁ U+FB2A, וֹ U+FB4B…) spelled out as the letter and points they stand
 * for. pdf.js (Firefox's viewer) spells them out before it puts right-to-left text back in order,
 * which then puts the points before their letter (שׁ copied as "ׁש"); spelled out in the PDF, they
 * are put back in order with the rest.
 */
export function spellOutPresentationForms(text: string): string {
  return text.replace(/[\uFB1D-\uFB4F]/g, (ch) => ch.normalize('NFD'))
}

/** How many code points `codePoints` decompose into (NFD). */
function decomposedLength(codePoints: number[]): number {
  let n = 0
  for (const _ of String.fromCodePoint(...codePoints).normalize('NFD')) n++
  return n
}

/**
 * The grapheme cluster each glyph belongs to and the characters it stands for. fontkit records the
 * code points behind every glyph, and in logical order the glyphs consume the text's code points
 * in turn; `typed` is the same text before mirroring.
 *
 * fontkit shares one glyph object per glyph id, which keeps the code points of its first use, in
 * this text or any other (parsed fonts are shared across exports). So code points are counted
 * decomposed (NFD), where שׁ typed as one character (U+FB2A) or as ש and its dot comes to the same;
 * the .notdef glyph stands for one missing character each time whatever it says; and when the
 * counts still don't add up, the characters fall back to the glyphs' own.
 */
function glyphSources(text: string, typed: string, glyphs: Glyph[], direction: Direction): Pick<ShapedText, 'clusters' | 'chars'> {
  // The typed text's decomposed code points, each with its cluster and the typed character it is from.
  const typedChars = [...typed]
  const units: { cluster: number; char: number; cp: string }[] = []
  let c = 0
  graphemes(text).forEach((cluster, i) => {
    for (const ch of cluster) {
      for (const cp of (typedChars[c] ?? ch).normalize('NFD')) units.push({ cluster: i, char: c, cp })
      c++
    }
  })
  const startsChar = (k: number) => k <= 0 || k >= units.length || units[k].char !== units[k - 1].char
  /** What units [from, to) stand for: whole characters as typed (presentation forms spelled out), or else these code points. */
  const span = (from: number, to: number) => {
    to = Math.min(to, units.length)
    if (from >= to) return ''
    if (!startsChar(from) || !startsChar(to)) return units.slice(from, to).map((u) => u.cp).join('')
    return spellOutPresentationForms(typedChars.slice(units[from].char, units[to - 1].char + 1).join(''))
  }
  const clusters = new Array<number>(glyphs.length)
  const chars = new Array<string>(glyphs.length)
  let consumed = 0
  let cluster = 0
  for (let n = 0; n < glyphs.length; n++) {
    const i = direction === 'rtl' ? glyphs.length - 1 - n : n
    let count = 1
    if (glyphs[i].id !== 0) count = decomposedLength(glyphs[i].codePoints)
    else while (!startsChar(consumed + count)) count++
    // A glyph without code points (an extra glyph a character was split into) joins the previous one.
    if (count) cluster = units[Math.min(consumed, units.length - 1)].cluster
    clusters[i] = cluster
    chars[i] = span(consumed, consumed + count)
    consumed += count
  }
  if (consumed !== units.length) glyphs.forEach((g, i) => (chars[i] = g.id === 0 ? '' : spellOutPresentationForms(String.fromCodePoint(...g.codePoints))))
  return { clusters, chars }
}

/**
 * Shapes one run of text (logical order) with an explicit direction; glyphs come back in visual
 * order. `typed` is the run before RTL mirroring, when `text` has it applied.
 */
export function shapeText(font: FkFont, text: string, direction: Direction, typed = text): ShapedText {
  const clean = composingPointsFirst(paintableText(text))
  if (!clean) return { glyphs: [], positions: [], clusters: [], chars: [], typed: [], advance: 0 }
  matchBacktrackNearestFirst(font)
  const run = (font.layout as unknown as LayoutFn).call(font, clean, SHAPING_FEATURES, undefined, undefined, direction)
  let advance = 0
  for (const p of run.positions) advance += p.xAdvance
  // Mirroring swaps single characters and points only move within their cluster, so the typed
  // text lines up with the shaped one, cluster by cluster.
  const shown = paintableText(typed)
  const sources = glyphSources(clean, typed === text ? clean : composingPointsFirst(shown), run.glyphs, direction)
  return { glyphs: run.glyphs, positions: run.positions, ...sources, typed: graphemes(spellOutPresentationForms(shown)), advance }
}

/**
 * Bidi-reorders and shapes a line. A bracket drawn mirrored in right-to-left text copies as the
 * bracket typed, as in Word's PDFs: right in Acrobat and Edge, pdf.js (Firefox) and poppler,
 * which only reverse right-to-left text, but reversed in Chrome's viewer and xpdf, which also
 * mirror it back. No mapping suits both; `r.text` as the typed run would suit the latter.
 */
export function shapeLine(font: FkFont, line: string, base?: Direction): ShapedRun[] {
  return visualRuns(line, base).map((r) => ({ ...r, ...shapeText(font, r.text, r.rtl ? 'rtl' : 'ltr', line.slice(r.start, r.end)) }))
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
