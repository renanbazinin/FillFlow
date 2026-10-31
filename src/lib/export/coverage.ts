import type { Element, FormField, Rect } from '../../model/types'

/** Overlaps smaller than this (points) are edges touching, not an item over a field. */
const MIN_OVERLAP = 0.5

/** Where an item can paint, in view space: its box, plus half the stroke for lines and ink. */
export function itemPaintBox(el: Element): Rect {
  const pad = el.kind === 'ink' || (el.kind === 'shape' && el.shape === 'line') ? el.strokeWidth / 2 : 0
  return { x: el.x - pad, y: el.y - pad, width: el.width + 2 * pad, height: el.height + 2 * pad }
}

function overlaps(a: Rect, b: Rect): boolean {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return w > MIN_OVERLAP && h > MIN_OVERLAP
}

/**
 * Names of the form fields with a widget under an item the user placed (a signature put in its
 * signature field, a checkmark drawn over a field…). Viewers paint form fields over the page, so
 * unless they are flattened such fields would hide the items on them.
 */
export function fieldsUnderItems(fields: FormField[], elements: Element[]): string[] {
  if (!elements.length) return []
  const boxes = elements.map((el) => ({ page: el.page, box: itemPaintBox(el) }))
  return fields
    .filter((f) => f.widgets.some((w) => boxes.some((b) => b.page === w.page && overlaps(b.box, w.rect))))
    .map((f) => f.name)
}
