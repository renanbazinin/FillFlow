import type { Point, Rect } from '../../../model/types'
import type { Size } from './geometry'

/** Offset between repeated pastes, in points. */
export const PASTE_CASCADE = 12

export interface PastePlacement {
  /** Pasting onto the page the items were copied from. */
  samePage: boolean
  /** 0 for the first paste onto this page since the copy, 1 for the next, … */
  index: number
  /** Where to center the items when pasting onto another page (usually the visible center). */
  center: Point | null
  page: Size
  step?: number
}

/**
 * Translation to apply to copied items (whose union is `bounds`) when pasting:
 * same page → original position, then cascading by +step; another page → centered on
 * `center`, cascading the same way. The result always keeps the group inside the page.
 */
export function pasteDelta(bounds: Rect, o: PastePlacement): Point {
  const step = (o.step ?? PASTE_CASCADE) * o.index
  let x: number
  let y: number
  if (o.samePage || !o.center) {
    x = bounds.x + step
    y = bounds.y + step
  } else {
    x = o.center.x - bounds.width / 2 + step
    y = o.center.y - bounds.height / 2 + step
  }
  x = Math.max(0, Math.min(x, o.page.width - bounds.width))
  y = Math.max(0, Math.min(y, o.page.height - bounds.height))
  return { x: x - bounds.x, y: y - bounds.y }
}

/** Tracks consecutive pastes so they cascade: same target page → next index, else restart. */
export function nextPasteIndex(prev: { page: number; index: number } | null, page: number): number {
  return prev && prev.page === page ? prev.index + 1 : 0
}
