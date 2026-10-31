import {
  PDFHexString,
  PDFOperator,
  PDFOperatorNames,
  beginText,
  concatTransformationMatrix,
  drawObject,
  endText,
  popGraphicsState,
  pushGraphicsState,
  setFillingRgbColor,
  setFontAndSize,
  setGraphicsState,
  setTextMatrix,
  setTextRise,
  showText,
  type PDFDocument,
} from 'pdf-lib'
import type { TextElement } from '../../model/types'
import { charCount, layoutTextBlock, type TextMeasurer } from '../text/layout'
import { parseColor } from './color'
import type { DrawContext } from './drawContext'
import { r } from './num'
import { firstStrongDirection, hasMissingGlyphs, paintableText, shapeLine, type Direction, type ShapedText } from './shaping'
import type { SubsetFont } from './subsetFont'

/**
 * How the paragraph direction of a multi-line block is chosen:
 *  - 'line':  every line resolves its own direction from its first strong character
 *             (CSS `unicode-bidi: plaintext`, or `dir="auto"` on each line),
 *  - 'block': the whole block takes the direction of its first strong character
 *             (`dir="auto"` on the block element).
 */
export const BIDI_PARAGRAPHS: 'line' | 'block' = 'line'

function paragraphDirection(text: string): Direction | undefined {
  return BIDI_PARAGRAPHS === 'block' ? (firstStrongDirection(text) ?? 'ltr') : undefined
}

/**
 * Text elements. Lines come from the shared `layoutTextBlock` (same measurer as the editor),
 * so line breaks, alignment offsets and baselines are identical to the screen. Each line is
 * split into bidi runs placed at their measured offsets; glyphs are emitted with exact GPOS
 * positioning. Elements with characters the fonts lack are rasterized instead.
 */
export async function textOperators(el: TextElement, ctx: DrawContext): Promise<PDFOperator[]> {
  if (!paintableText(el.text).trim()) return []
  const layout = layoutTextBlock(el.text, el, el.align, ctx.measure)
  const { font: face } = await ctx.fonts.face(el.fontId, el.bold)

  if (ctx.rasterizeText && hasMissingGlyphs(face, el.text)) {
    const raster = await ctx.rasterizeText(el, layout)
    if (raster) {
      const image = await ctx.images.embedPng(raster.png)
      const bottom = ctx.pageHeight - raster.y - raster.height
      return [
        pushGraphicsState(),
        concatTransformationMatrix(r(raster.width), 0, 0, r(raster.height), r(raster.x), r(bottom)),
        drawObject(ctx.res.xObject(image.ref)),
        popGraphicsState(),
      ]
    }
  }

  const font = await ctx.fonts.subset(el.fontId, el.bold)
  const color = parseColor(el.color)
  const ops: PDFOperator[] = []
  const gs = color.a < 1 ? ctx.res.graphicsState({ fill: color.a }) : null
  if (gs) ops.push(pushGraphicsState(), setGraphicsState(gs))
  ops.push(beginText(), setFontAndSize(ctx.res.font(font.ref), r(el.fontSize)), setFillingRgbColor(color.r, color.g, color.b))

  const base = paragraphDirection(el.text)
  for (const line of layout.lines) {
    if (!paintableText(line.text).trim()) continue
    const baseline = ctx.pageHeight - (el.y + line.baseline)
    let x = el.x + line.x
    for (const run of shapeLine(face, line.text, base)) {
      if (run.glyphs.length) {
        ops.push(setTextMatrix(1, 0, 0, 1, r(x), r(baseline)))
        ops.push(...glyphOperators(ctx.doc, font, run, el.fontSize, el.letterSpacing))
      }
      x += runWidth(line.text.slice(run.start, run.end), el, ctx.measure)
    }
  }
  ops.push(endText())
  if (gs) ops.push(popGraphicsState())
  return ops
}

/** Width of a run as the editor lays it out (measurer + letter spacing after every character). */
function runWidth(text: string, el: TextElement, measure: TextMeasurer): number {
  return measure(text, el.fontId, el.bold, el.fontSize) + el.letterSpacing * charCount(text)
}

/**
 * Emits glyphs with exact positions. A glyph's displacement in the PDF comes from the font's
 * widths; TJ adjustments correct it to the shaper's advance and x offset and add the letter
 * spacing after each grapheme cluster, as CSS does (character spacing, Tc, would also space out
 * zero-width marks, and it outlives the text object). Text rise (Ts) applies y offsets (Hebrew
 * points, combining accents…).
 */
export function glyphOperators(
  doc: PDFDocument,
  font: SubsetFont,
  run: Pick<ShapedText, 'glyphs' | 'positions' | 'clusters'>,
  size: number,
  letterSpacing = 0,
): PDFOperator[] {
  const { glyphs, positions, clusters } = run
  const ops: PDFOperator[] = []
  const k = font.scale
  const unit = size / font.font.unitsPerEm
  const spacing = (letterSpacing * 1000) / size
  let items: (PDFHexString | number)[] = []
  let hex = ''
  let rise = 0
  // TJ adjustment (thousandths of an em, positive = move left) owed before the next glyph.
  let pending = 0

  const flushHex = () => {
    if (hex) items.push(PDFHexString.of(hex))
    hex = ''
  }
  const flushText = () => {
    flushHex()
    if (items.length === 1 && items[0] instanceof PDFHexString) ops.push(showText(items[0]))
    else if (items.length) ops.push(PDFOperator.of(PDFOperatorNames.ShowTextAdjusted, [doc.context.obj(items)]))
    items = []
  }

  for (let i = 0; i < glyphs.length; i++) {
    const g = glyphs[i]
    const p = positions[i]
    const y = r(p.yOffset * unit)
    if (y !== rise) {
      flushText()
      ops.push(setTextRise(y))
      rise = y
    }
    pending -= p.xOffset * k
    const adjust = Math.round(pending * 1000) / 1000
    if (adjust !== 0) {
      flushHex()
      items.push(adjust)
    }
    hex += font.cid(g).toString(16).padStart(4, '0')
    pending = -(p.xAdvance - p.xOffset - g.advanceWidth) * k
    if (clusters[i + 1] !== clusters[i]) pending -= spacing
  }
  flushText()
  if (rise !== 0) ops.push(setTextRise(0))
  return ops
}
