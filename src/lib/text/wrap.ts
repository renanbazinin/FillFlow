import { charCount, graphemes, measureTextCanvas, type TextMeasurer, type TextStyle } from './layout'

/**
 * Breaks the lines of `text` that are wider than `maxWidth` (points, measured as
 * `layoutTextBlock` measures them) between words, the way a page of text wraps; a word wider
 * than that on its own breaks between characters. A break replaces the spaces where it falls.
 * Lines that fit stay as they are. Breaks go in reading (logical) order, so right-to-left and
 * mixed lines wrap as they are read.
 */
export function wrapText(text: string, style: TextStyle, maxWidth: number, measure: TextMeasurer = measureTextCanvas): string {
  const width = (s: string) => measure(s, style.fontId, style.bold, style.fontSize) + style.letterSpacing * charCount(s)
  return text
    .split('\n')
    .map((line) => (width(line) <= maxWidth ? line : wrapLine(line, width, maxWidth).join('\n')))
    .join('\n')
}

function wrapLine(line: string, width: (s: string) => number, maxWidth: number): string[] {
  const lines: string[] = []
  let current = ''
  // Each word with the spaces before it.
  for (const word of line.match(/ *[^ ]+/g) ?? []) {
    if (current && width(current + word) <= maxWidth) {
      current += word
      continue
    }
    if (current) {
      lines.push(current)
      current = word.trimStart()
    } else current = word
    while (width(current) > maxWidth) {
      const fit = longestFit(current, width, maxWidth)
      if (fit.length === current.length) break
      lines.push(fit)
      current = current.slice(fit.length)
    }
  }
  lines.push(current)
  return lines
}

/** The longest start of `text` that fits, by whole characters (at least one). */
function longestFit(text: string, width: (s: string) => number, maxWidth: number): string {
  let fit = ''
  for (const g of graphemes(text)) {
    if (fit && width(fit + g) > maxWidth) break
    fit += g
  }
  return fit
}
