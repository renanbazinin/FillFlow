import { FONTS } from '../../../model/fonts'
import type { TextAlign } from '../../../model/types'
import type { Direction } from './bidi'

/**
 * Layout rules for text inside AcroForm widgets, shared by the on-page editor (measured with the
 * canvas) and the exported appearance streams (measured with the embedded PDF font). Arimo — the
 * on-screen font — is metric-compatible with Helvetica, so both sides agree on font sizes, line
 * breaks and positions. All values are in PDF points, in the widget's upright (view) frame.
 */

/** Horizontal inset of text from the widget edge (and top inset for multi-line fields). */
export const FIELD_PADDING = 2
/** Line spacing of multi-line fields and list boxes, as a multiple of the font size. */
export const FIELD_LINE_HEIGHT = 1.15
/** Auto-sized single-line text: min(height × ratio, max), then shrunk to fit the width. */
export const AUTO_FONT_MAX = 12
export const AUTO_FONT_HEIGHT_RATIO = 0.68
/** Auto-sized multi-line text starts here and shrinks until it fits the box. */
export const AUTO_FONT_MULTILINE = 10
export const MIN_FONT_SIZE = 4
/** Advance of every glyph in the monospaced comb font (Cousine ≙ Courier), in em. */
export const MONO_ADVANCE = 1229 / 2048

const SANS = FONTS.sans
/** Arimo ascent / descent in em (pinned on screen via FontFace metric overrides). */
export const ASCENT = SANS.ascent / SANS.unitsPerEm
export const DESCENT = SANS.descent / SANS.unitsPerEm

/** Text inset from the widget edge for a given (drawn) border width — same on screen and in the PDF. */
export function textPadding(borderWidth: number): number {
  return FIELD_PADDING + Math.max(0, borderWidth - 1)
}

/** Advance width in points of `text` at `fontSize`, without kerning. */
export type Measure = (text: string, fontSize: number) => number

const round = (n: number) => Math.floor(n * 100) / 100

/** Drops C0 control characters (and DEL) except those listed in `keep`. */
function stripControls(text: string, keep = ''): string {
  let out = ''
  for (const ch of text) {
    const c = ch.charCodeAt(0)
    if ((c < 0x20 || c === 0x7f) && !keep.includes(ch)) continue
    out += ch
  }
  return out
}

/** Collapses a value into one line the way a single-line field shows it. */
export function singleLineText(text: string): string {
  return stripControls(text.replace(/\r\n?|\n|\t/g, ' '))
}

/** Normalizes line breaks and strips control characters (except newlines). */
export function multiLineText(text: string): string {
  return stripControls(text.replace(/\r\n?/g, '\n').replace(/\t/g, ' '), '\n')
}

/** Largest font size whose glyph box (ascent + descent) fits in `height`. */
function maxForHeight(height: number): number {
  return Math.max(MIN_FONT_SIZE, height / (ASCENT + DESCENT))
}

/** Font size for a single-line field (`fontSize` 0/undefined = auto). */
export function singleLineFontSize(
  text: string,
  box: { width: number; height: number; fontSize?: number; padding?: number },
  measure: Measure,
): number {
  if (box.fontSize && box.fontSize > 0) return round(Math.min(box.fontSize, maxForHeight(box.height)))
  let size = Math.max(MIN_FONT_SIZE, Math.min(box.height * AUTO_FONT_HEIGHT_RATIO, AUTO_FONT_MAX))
  const available = box.width - (box.padding ?? FIELD_PADDING) * 2
  const line = singleLineText(text)
  if (line && available > 0) {
    const w = measure(line, size)
    if (w > available) size = Math.max(MIN_FONT_SIZE, (size * available) / w)
  }
  return round(size)
}

/** Distance from the widget's top edge to the baseline of a vertically centered line. */
export function singleLineBaseline(height: number, fontSize: number): number {
  return (height - (ASCENT + DESCENT) * fontSize) / 2 + ASCENT * fontSize
}

/** Distance from the widget's top edge to the baseline of line `index` of a multi-line field. */
export function multiLineBaseline(index: number, fontSize: number, padding = FIELD_PADDING): number {
  const box = FIELD_LINE_HEIGHT * fontSize
  return padding + index * box + (box - (ASCENT + DESCENT) * fontSize) / 2 + ASCENT * fontSize
}

/** Physical alignment: a field's "left" (the PDF default) means "start", so RTL text hugs the right. */
export function resolveAlign(align: TextAlign | undefined, direction: Direction): 'left' | 'center' | 'right' {
  if (align === 'center' || align === 'right') return align
  return direction === 'rtl' ? 'right' : 'left'
}

/** A wrapped line: code-unit range [start, end) inside paragraph `paragraph`. */
export interface WrappedLine {
  paragraph: number
  start: number
  end: number
}

/**
 * Greedy word wrap (like a <textarea>): breaks after spaces, keeps trailing spaces on the line
 * (they don't count toward its width), and breaks words that are longer than a whole line.
 */
export function wrapParagraph(text: string, maxWidth: number, fontSize: number, measure: Measure): [number, number][] {
  if (!text) return [[0, 0]]
  const out: [number, number][] = []
  // Tokens: a run of non-spaces followed by its spaces.
  const tokens: [number, number, number][] = [] // [start, endOfWord, endWithSpaces]
  const re = /(\S*)(\s*)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) && m[0]) {
    tokens.push([m.index, m.index + m[1].length, m.index + m[0].length])
  }
  let lineStart = 0
  let lineEnd = 0
  let width = 0
  const widthOf = (s: number, e: number) => measure(text.slice(s, e), fontSize)
  for (const [s, wordEnd, end] of tokens) {
    const wordWidth = widthOf(s, wordEnd)
    if (lineEnd > lineStart && width + wordWidth > maxWidth) {
      out.push([lineStart, lineEnd])
      lineStart = s
      width = 0
    }
    if (wordWidth > maxWidth && maxWidth > 0) {
      // Break the long word by characters.
      let cut = s
      for (const ch of text.slice(s, wordEnd)) {
        const w = measure(ch, fontSize)
        if (width + w > maxWidth && cut > lineStart) {
          out.push([lineStart, cut])
          lineStart = cut
          width = 0
        }
        width += w
        cut += ch.length
      }
      width += widthOf(wordEnd, end)
      lineEnd = end
      continue
    }
    width += wordWidth + widthOf(wordEnd, end)
    lineEnd = end
  }
  out.push([lineStart, Math.max(lineEnd, lineStart)])
  return out
}

/** Wraps every paragraph of a multi-line value. */
export function wrapText(text: string, maxWidth: number, fontSize: number, measure: Measure): WrappedLine[] {
  const lines: WrappedLine[] = []
  text.split('\n').forEach((p, paragraph) => {
    for (const [start, end] of wrapParagraph(p, maxWidth, fontSize, measure)) lines.push({ paragraph, start, end })
  })
  return lines
}

export interface MultiLineLayout {
  fontSize: number
  lines: WrappedLine[]
}

/** Font size and wrapped lines of a multi-line field (`fontSize` 0/undefined = auto). */
export function multiLineLayout(
  text: string,
  box: { width: number; height: number; fontSize?: number; padding?: number },
  measure: Measure,
): MultiLineLayout {
  const value = multiLineText(text)
  const pad = box.padding ?? FIELD_PADDING
  const width = Math.max(1, box.width - pad * 2)
  const height = Math.max(1, box.height - pad * 2)
  if (box.fontSize && box.fontSize > 0) {
    return { fontSize: box.fontSize, lines: wrapText(value, width, box.fontSize, measure) }
  }
  let size = AUTO_FONT_MULTILINE
  // Never taller than one line would allow.
  size = Math.min(size, Math.max(MIN_FONT_SIZE, height / FIELD_LINE_HEIGHT))
  for (;;) {
    const lines = wrapText(value, width, size, measure)
    if (lines.length * size * FIELD_LINE_HEIGHT <= height + 0.01 || size <= MIN_FONT_SIZE) {
      return { fontSize: round(size), lines }
    }
    size = Math.max(MIN_FONT_SIZE, size - 0.5)
  }
}

/** Comb fields: one character centered per cell, using a monospaced face. */
export function combLayout(box: { width: number; height: number; fontSize?: number; maxLength: number }): {
  fontSize: number
  cellWidth: number
} {
  const cellWidth = box.width / Math.max(1, box.maxLength)
  const base = box.fontSize && box.fontSize > 0 ? box.fontSize : Math.min(box.height * AUTO_FONT_HEIGHT_RATIO, AUTO_FONT_MAX)
  const fit = Math.min(base, (cellWidth * 0.92) / MONO_ADVANCE, maxForHeight(box.height))
  return { fontSize: round(Math.max(MIN_FONT_SIZE, fit)), cellWidth }
}

/** Font size of list box rows (`fontSize` 0/undefined = auto). */
export function listFontSize(box: { height: number; fontSize?: number; padding?: number }): number {
  if (box.fontSize && box.fontSize > 0) return box.fontSize
  const pad = box.padding ?? FIELD_PADDING
  return round(Math.max(MIN_FONT_SIZE, Math.min(AUTO_FONT_MULTILINE, (box.height - pad * 2) / FIELD_LINE_HEIGHT)))
}
