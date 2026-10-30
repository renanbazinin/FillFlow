import { layoutTextBlock, measureTextCanvas, type TextMeasurer, type TextStyle } from '../../../lib/text/layout'
import type { Point, TextAlign } from '../../../model/types'

const RTL = /[֐-ࣿיִ-﷿ﹰ-ﻼ]/

/**
 * Caret offset (UTF-16 index into `text`) closest to a point given in points relative to the
 * text block's top-left. Lines containing right-to-left characters put the caret at the end of
 * the line (their visual order differs from the logical order).
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
  if (!line || RTL.test(line)) return offset + line.length
  const x = local.x - layout.lines[row].x
  if (x <= 0) return offset
  let prevWidth = 0
  let consumed = 0
  let chars = 0
  for (const ch of line) {
    chars++
    const next = consumed + ch.length
    const width = measure(line.slice(0, next), style.fontId, style.bold, style.fontSize) + style.letterSpacing * chars
    if (x < (prevWidth + width) / 2) return offset + consumed
    prevWidth = width
    consumed = next
  }
  return offset + line.length
}
