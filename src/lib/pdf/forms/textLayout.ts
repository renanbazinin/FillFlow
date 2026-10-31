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

/** Spaces a line can break after (not the no-break ones: U+00A0, U+2007, U+202F, U+FEFF). */
const BREAKING_SPACE = /[ \t\u1680\u2000-\u2006\u2008-\u200b\u205f\u3000]/
const LETTER = /\p{L}/u
const DIGIT = /\p{Nd}/u
const HEBREW = /\p{Script=Hebrew}/u
const MARK = /\p{M}/u
const OPENING = /[([{"]/u
/** Hyphens and dashes a line can break after (UAX #14 class BA), unlike U+2011 or U+2212. */
const BREAK_AFTER_DASH = /[\u2010\u2012\u2013\u05be\u058a]/

/** The code point starting at `i`. */
function charAt(text: string, i: number): string {
  return String.fromCodePoint(text.codePointAt(i) ?? 0)
}

/** Index of the last character before `i` that isn't a combining mark (-1 if none). */
function baseBefore(text: string, i: number): number {
  let j = i - 1
  while (j >= 0 && MARK.test(text[j])) j--
  return j
}

/**
 * Whether a line may break between text[i - 1] and text[i] inside a word: after hyphens and
 * dashes, around em dashes, after "?" and "…". These are the browser's (UAX #14) line-break
 * opportunities that form values meet, as Chrome applies them to a <textarea>.
 */
function breaksBefore(text: string, i: number): boolean {
  const next = charAt(text, i)
  if (MARK.test(next)) return false
  const at = baseBefore(text, i)
  const c = text[at] ?? ''
  const prev = text[baseBefore(text, at)] ?? ''
  if (next === '\u2014') return c !== '\u2014'
  const word = LETTER.test(next) || OPENING.test(next)
  switch (c) {
    case '-':
      // "ab-12" and "2026-10" break, but not a sign ("-5", "$-5") or "ב-2020".
      if (DIGIT.test(next)) return (LETTER.test(prev) && !HEBREW.test(prev)) || DIGIT.test(prev)
      return word || next === '-'
    case '\u2014':
      return next !== '-' && (word || DIGIT.test(next))
    case '?':
    case '\u2026':
      return word || DIGIT.test(next) || next === '-'
    default:
      if (!BREAK_AFTER_DASH.test(c) || (HEBREW.test(prev) && !HEBREW.test(next))) return false
      return word || DIGIT.test(next)
  }
}

/** Segments a line can end after: [start, end of the visible part, end including spaces]. */
function segments(text: string): [number, number, number][] {
  const out: [number, number, number][] = []
  let start = 0
  while (start < text.length) {
    let end = start
    while (end < text.length && !BREAKING_SPACE.test(text[end])) {
      end += charAt(text, end).length
      if (end < text.length && !BREAKING_SPACE.test(text[end]) && breaksBefore(text, end)) break
    }
    let spaces = end
    while (spaces < text.length && BREAKING_SPACE.test(text[spaces])) spaces++
    out.push([start, end, spaces])
    start = spaces
  }
  return out
}

/**
 * Greedy word wrap like a <textarea> (white-space: pre-wrap; overflow-wrap: break-word): breaks
 * after spaces and at the other break opportunities the browser uses (see breaksBefore), keeps
 * trailing spaces on the line (they don't count toward its width), and breaks words that are
 * longer than a whole line.
 */
export function wrapParagraph(text: string, maxWidth: number, fontSize: number, measure: Measure): [number, number][] {
  if (!text) return [[0, 0]]
  const out: [number, number][] = []
  const tokens = segments(text) // [start, endOfWord, endWithSpaces]
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
