import { fontDef } from '../../model/fonts'
import type { FontId, TextAlign } from '../../model/types'

/**
 * Shared text layout used by BOTH the on-screen text renderer and the PDF exporter, so the
 * two can never disagree about line breaks, line positions or block size.
 *
 * Model: lines break only at '\n'; the block is as wide as its widest line and
 * `lines * fontSize * lineHeight` tall. Baselines follow CSS line-box rules using the font's
 * ascent/descent (which `model/fonts.ts` pins via FontFace metric overrides).
 */

export interface TextStyle {
  fontId: FontId
  bold: boolean
  /** Points. */
  fontSize: number
  /** Multiple of fontSize. */
  lineHeight: number
  /** Points added after every character (grapheme cluster, see `charCount`). */
  letterSpacing: number
}

export interface LaidOutLine {
  text: string
  /** Advance width of the line in points (including letter spacing). */
  width: number
  /** Offset of the line's left edge inside the block, honoring alignment. */
  x: number
  /** Distance from the top of the block to this line's baseline, in points. */
  baseline: number
}

export interface TextBlockLayout {
  lines: LaidOutLine[]
  /** Block size in points. */
  width: number
  height: number
  /** Line box height in points (fontSize * lineHeight). */
  lineHeightPt: number
}

/** Measures the advance width (points) of a single line of text, *without* letter spacing. */
export type TextMeasurer = (text: string, fontId: FontId, bold: boolean, fontSize: number) => number

/** Width given to an empty block so the caret / selection frame stays visible. */
export const EMPTY_TEXT_WIDTH_EM = 0.6

/** Distance from the top of a line box to its baseline, in points. */
export function baselineOffset(fontId: FontId, fontSize: number, lineHeight: number): number {
  const f = fontDef(fontId)
  const ascent = (f.ascent / f.unitsPerEm) * fontSize
  const descent = (f.descent / f.unitsPerEm) * fontSize
  const lineBox = fontSize * lineHeight
  return (lineBox - (ascent + descent)) / 2 + ascent
}

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

const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null

/** Grapheme clusters of `text`: user-perceived characters, e.g. a letter with its niqqud or accents. */
export function graphemes(text: string): string[] {
  if (segmenter) return Array.from(segmenter.segment(text), (s) => s.segment)
  return text.match(/\P{M}\p{M}*|\p{M}+/gu) ?? []
}

/**
 * Number of characters that take letter spacing: grapheme clusters, except those made only of
 * invisible characters (bidi marks, ZWJ…). This is how Chrome applies CSS `letter-spacing`
 * (once after each cluster, so marks stay on their letter) and how the exporter spaces glyphs.
 */
export function charCount(text: string): number {
  let n = 0
  for (const cluster of graphemes(text)) if ([...cluster].some((ch) => !isIgnorable(ch.codePointAt(0)!))) n++
  return n
}

export function layoutTextBlock(
  text: string,
  style: TextStyle,
  align: TextAlign = 'left',
  measure: TextMeasurer = measureTextCanvas,
): TextBlockLayout {
  const lineHeightPt = style.fontSize * style.lineHeight
  const base = baselineOffset(style.fontId, style.fontSize, style.lineHeight)
  const rawLines = text.split('\n')
  const widths = rawLines.map(
    (line) => measure(line, style.fontId, style.bold, style.fontSize) + style.letterSpacing * charCount(line),
  )
  const width = Math.max(EMPTY_TEXT_WIDTH_EM * style.fontSize, ...widths)
  const lines = rawLines.map((line, i) => {
    const w = widths[i]
    const x = align === 'center' ? (width - w) / 2 : align === 'right' ? width - w : 0
    return { text: line, width: w, x, baseline: i * lineHeightPt + base }
  })
  return { lines, width, height: rawLines.length * lineHeightPt, lineHeightPt }
}

// ---------------------------------------------------------------------------
// Canvas measurer (browser). Fonts must be loaded via `loadFont` for exact results.
// ---------------------------------------------------------------------------

const MEASURE_PX = 100
let ctx: CanvasRenderingContext2D | null = null
const cache = new Map<string, number>()

function getContext(): CanvasRenderingContext2D {
  if (!ctx) {
    const canvas = document.createElement('canvas')
    const c = canvas.getContext('2d')
    if (!c) throw new Error('Canvas 2D context unavailable')
    ctx = c
  }
  return ctx
}

/** Measures with the registered FontFace at 100px, disabling kerning to match PDF output. */
export function measureTextCanvas(text: string, fontId: FontId, bold: boolean, fontSize: number): number {
  if (!text) return 0
  const key = `${fontId}|${bold ? 1 : 0}|${text}`
  let w100 = cache.get(key)
  if (w100 === undefined) {
    const c = getContext()
    c.font = `${bold ? 700 : 400} ${MEASURE_PX}px "${fontDef(fontId).cssFamily}"`
    c.fontKerning = 'none'
    w100 = c.measureText(text).width
    if (cache.size > 5000) cache.clear()
    cache.set(key, w100)
  }
  return (w100 / MEASURE_PX) * fontSize
}

/** Drop cached widths (call after a font finishes loading, since fallback widths were cached). */
export function clearMeasureCache(): void {
  cache.clear()
}
