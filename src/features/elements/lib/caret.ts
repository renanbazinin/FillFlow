import { charCount, graphemes, layoutTextBlock, measureTextCanvas, type TextMeasurer, type TextStyle } from '../../../lib/text/layout'
import type { Point, TextAlign } from '../../../model/types'
import { textCss } from '../render/textStyle'

const RTL = /[֐-ࣿיִ-﷿ﹰ-ﻼ]/
/** Where (CSS px from the viewport's left edge) a line is hit-tested by `caretInBidiLine`. */
const HIT_X = 8

type CaretDocument = Document & {
  caretPositionFromPoint?(x: number, y: number): { offsetNode: Node; offset: number } | null
}

/**
 * Caret offset in one line holding right-to-left text, from the browser's own bidi layout (the
 * same one that shows it on the page): the line is laid out, invisibly, in the element's text
 * style at scale 1 and hit-tested `x` points from its left edge. Null without a DOM.
 */
function caretInBidiLine(line: string, style: TextStyle, x: number): number | null {
  if (typeof document === 'undefined' || !document.body) return null
  const doc = document as CaretDocument
  if (!doc.caretPositionFromPoint && !doc.caretRangeFromPoint) return null
  const probe = document.createElement('div')
  probe.dir = 'auto'
  Object.assign(probe.style, textCss({ ...style, color: '#000' }, 1), {
    position: 'fixed',
    left: '0px',
    top: '0px',
    margin: '0px',
    padding: '0px',
    border: '0px',
    // On top of everything so the hit test lands on it; laid out and removed before any paint.
    zIndex: '2147483647',
    opacity: '0',
    pointerEvents: 'auto',
  })
  probe.textContent = line
  document.body.append(probe)
  try {
    // The browser finds no caret outside the viewport: the probe moves left so that the point
    // `x` points into it is near the viewport's left edge, however long the line is.
    const into = Math.min(Math.max(x, 0.5), probe.getBoundingClientRect().width - 0.5)
    probe.style.left = `${HIT_X - into}px`
    const box = probe.getBoundingClientRect()
    const px = box.left + into
    const py = box.top + box.height / 2
    let node: Node | null = null
    let offset = 0
    if (doc.caretPositionFromPoint) {
      const hit = doc.caretPositionFromPoint(px, py)
      if (hit) ({ offsetNode: node, offset } = hit)
    } else {
      const hit = doc.caretRangeFromPoint(px, py)
      if (hit) ({ startContainer: node, startOffset: offset } = hit)
    }
    if (!node || node !== probe.firstChild) return null
    // Never between a letter and its marks (niqqud…): to the nearer edge of its cluster.
    let at = 0
    for (const g of graphemes(line)) {
      if (offset < at + g.length) return offset - at <= g.length / 2 ? at : at + g.length
      at += g.length
    }
    return line.length
  } finally {
    probe.remove()
  }
}

/**
 * Caret offset (UTF-16 index into `text`) closest to a point given in points relative to the
 * text block's top-left. Lines holding right-to-left characters are hit-tested by the browser
 * (their visual order differs from the logical order); without a DOM their caret goes to the
 * end of the line.
 */
export function caretIndexAt(
  text: string,
  style: TextStyle,
  align: TextAlign,
  local: Point,
  measure: TextMeasurer = measureTextCanvas,
): number {
  const layout = layoutTextBlock(text, style, align, measure)
  const lines = text.split('\n')
  const row = Math.max(0, Math.min(lines.length - 1, Math.floor(local.y / layout.lineHeightPt)))
  let offset = 0
  for (let i = 0; i < row; i++) offset += lines[i].length + 1
  const line = lines[row]
  if (!line) return offset
  const x = local.x - layout.lines[row].x
  if (RTL.test(line)) return offset + (caretInBidiLine(line, style, x) ?? line.length)
  if (x <= 0) return offset
  let prevWidth = 0
  let consumed = 0
  let chars = 0
  // By grapheme cluster: the caret never lands between a letter and its marks.
  for (const ch of graphemes(line)) {
    chars += charCount(ch)
    const next = consumed + ch.length
    const width = measure(line.slice(0, next), style.fontId, style.bold, style.fontSize) + style.letterSpacing * chars
    if (x < (prevWidth + width) / 2) return offset + consumed
    prevWidth = width
    consumed = next
  }
  return offset + line.length
}
