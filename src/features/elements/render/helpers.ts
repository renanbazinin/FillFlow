import { HIGHLIGHT_COLOR } from '../../../model/elements'
import type { Element, InkElement, Point } from '../../../model/types'

/** The highlight preset is painted with a multiply blend (see ShapeElement in model/types.ts). */
export function isHighlight(el: Element): boolean {
  return el.kind === 'shape' && el.fillColor === HIGHLIGHT_COLOR && el.strokeColor === null
}

export function isLine(el: Element): boolean {
  return el.kind === 'shape' && el.shape === 'line'
}

/** Strokes of an ink element in CSS px relative to its box. */
export function inkPixelStrokes(el: Pick<InkElement, 'strokes' | 'width' | 'height'>, scale: number): Point[][] {
  const w = el.width * scale
  const h = el.height * scale
  return el.strokes.map((s) => {
    const pts: Point[] = []
    for (let i = 0; i + 1 < s.length; i += 2) pts.push({ x: s[i] * w, y: s[i + 1] * h })
    return pts
  })
}
