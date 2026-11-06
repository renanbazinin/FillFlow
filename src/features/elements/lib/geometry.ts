import { MAX_FONT_SIZE, MIN_ELEMENT_SIZE, MIN_FONT_SIZE } from '../../../model/elements'
import type { Element, Point, Rect, TextElement } from '../../../model/types'
import { layoutTextBlock, type TextMeasurer } from '../../../lib/text/layout'
import { clamp } from '../../../lib/utils/misc'

/**
 * Pure geometry used by the element interactions (all in view-space points).
 */

export interface Size {
  width: number
  height: number
}

// ---------------------------------------------------------------------------
// Resize handles.
// ---------------------------------------------------------------------------

export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

export const CORNER_HANDLES: readonly HandleId[] = ['nw', 'ne', 'se', 'sw']
export const ALL_HANDLES: readonly HandleId[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

type Dir = -1 | 0 | 1

const DIRS: Record<HandleId, readonly [Dir, Dir]> = {
  nw: [-1, -1],
  n: [0, -1],
  ne: [1, -1],
  e: [1, 0],
  se: [1, 1],
  s: [0, 1],
  sw: [-1, 1],
  w: [-1, 0],
}

/** -1 = left/top edge, 1 = right/bottom edge, 0 = middle. */
export function handleDir(h: HandleId): { x: Dir; y: Dir } {
  const [x, y] = DIRS[h]
  return { x, y }
}

export function isCornerHandle(h: HandleId): boolean {
  const [x, y] = DIRS[h]
  return x !== 0 && y !== 0
}

/** Where a handle sits on a rect. */
export function handlePoint(r: Rect, h: HandleId): Point {
  const [x, y] = DIRS[h]
  return { x: r.x + ((x + 1) / 2) * r.width, y: r.y + ((y + 1) / 2) * r.height }
}

export function handleCursor(h: HandleId): string {
  if (h === 'n' || h === 's') return 'ns-resize'
  if (h === 'e' || h === 'w') return 'ew-resize'
  return h === 'nw' || h === 'se' ? 'nwse-resize' : 'nesw-resize'
}

/** Which handles an element gets ('line' elements use endpoint handles instead). */
export function handlesFor(el: Element): readonly HandleId[] | 'line' {
  if (el.kind === 'shape' && el.shape === 'line') return 'line'
  if (el.kind === 'shape' || el.kind === 'ink') return ALL_HANDLES
  return CORNER_HANDLES
}

/** Whether resizing keeps the aspect ratio without Shift. */
export function locksAspect(el: Element): boolean {
  return el.kind === 'text' || el.kind === 'mark' || el.kind === 'image'
}

export interface ResizeOptions {
  /** Keep the start rect's aspect ratio (corner: anchored at the opposite corner; edge: centered). */
  keepAspect: boolean
  /** Minimum width/height in points (never forces an already-smaller box to grow). */
  min: number
  /** The box must stay inside the page (unless it already sticks out). */
  page: Size
  /** Extra bounds on the uniform scale factor in aspect mode (e.g. from font-size limits). */
  minFactor?: number
  maxFactor?: number
}

/**
 * New box after dragging handle `h` of `start` by `delta` (points). The edge or corner
 * opposite to the handle stays fixed.
 */
export function resizeRect(start: Rect, h: HandleId, delta: Point, o: ResizeOptions): Rect {
  const [dx, dy] = DIRS[h]
  if (o.keepAspect) return resizeKeepingAspect(start, dx, dy, delta, o)
  const left0 = start.x
  const top0 = start.y
  const right0 = start.x + start.width
  const bottom0 = start.y + start.height
  const minW = Math.min(o.min, start.width)
  const minH = Math.min(o.min, start.height)
  let left = left0
  let right = right0
  let top = top0
  let bottom = bottom0
  if (dx < 0) left = clamp(left0 + delta.x, Math.min(0, left0), right0 - minW)
  if (dx > 0) right = clamp(right0 + delta.x, left0 + minW, Math.max(o.page.width, right0))
  if (dy < 0) top = clamp(top0 + delta.y, Math.min(0, top0), bottom0 - minH)
  if (dy > 0) bottom = clamp(bottom0 + delta.y, top0 + minH, Math.max(o.page.height, bottom0))
  return { x: left, y: top, width: right - left, height: bottom - top }
}

function resizeKeepingAspect(start: Rect, dx: Dir, dy: Dir, delta: Point, o: ResizeOptions): Rect {
  const w = start.width
  const h = start.height
  if (w <= 0 || h <= 0) return { ...start }
  const left0 = start.x
  const top0 = start.y
  const right0 = left0 + w
  const bottom0 = top0 + h
  const pageW = Math.max(o.page.width, right0)
  const pageH = Math.max(o.page.height, bottom0)
  const minF = Math.max(Math.min(o.min, w) / w, Math.min(o.min, h) / h, o.minFactor ?? 0)
  let maxF = o.maxFactor ?? Infinity

  if (dx !== 0 && dy !== 0) {
    // Corner: the opposite corner is the anchor; project the dragged corner onto the diagonal.
    const ax = dx > 0 ? left0 : right0
    const ay = dy > 0 ? top0 : bottom0
    const cx = (dx > 0 ? right0 : left0) + delta.x
    const cy = (dy > 0 ? bottom0 : top0) + delta.y
    const vx = (cx - ax) * dx
    const vy = (cy - ay) * dy
    const raw = (vx * w + vy * h) / (w * w + h * h)
    maxF = Math.min(maxF, (dx > 0 ? pageW - ax : ax - Math.min(0, left0)) / w, (dy > 0 ? pageH - ay : ay - Math.min(0, top0)) / h)
    const f = clamp(raw, minF, Math.max(minF, maxF))
    const nw = w * f
    const nh = h * f
    return { x: dx > 0 ? ax : ax - nw, y: dy > 0 ? ay : ay - nh, width: nw, height: nh }
  }

  if (dx !== 0) {
    // Side handle: the opposite side is the anchor, the other axis stays centered.
    const ax = dx > 0 ? left0 : right0
    const raw = (dx > 0 ? right0 + delta.x - ax : ax - (left0 + delta.x)) / w
    const cy = top0 + h / 2
    maxF = Math.min(
      maxF,
      (dx > 0 ? pageW - ax : ax - Math.min(0, left0)) / w,
      (2 * Math.min(cy - Math.min(0, top0), pageH - cy)) / h,
    )
    const f = clamp(raw, minF, Math.max(minF, maxF))
    const nw = w * f
    const nh = h * f
    return { x: dx > 0 ? ax : ax - nw, y: cy - nh / 2, width: nw, height: nh }
  }

  const ay = dy > 0 ? top0 : bottom0
  const raw = (dy > 0 ? bottom0 + delta.y - ay : ay - (top0 + delta.y)) / h
  const cx = left0 + w / 2
  maxF = Math.min(
    maxF,
    (dy > 0 ? pageH - ay : ay - Math.min(0, top0)) / h,
    (2 * Math.min(cx - Math.min(0, left0), pageW - cx)) / w,
  )
  const f = clamp(raw, minF, Math.max(minF, maxF))
  const nw = w * f
  const nh = h * f
  return { x: cx - nw / 2, y: dy > 0 ? ay : ay - nh, width: nw, height: nh }
}

const round2 = (n: number) => Math.round(n * 100) / 100

export interface TextResizePatch {
  fontSize: number
  letterSpacing: number
  x: number
  y: number
  width: number
  height: number
}

/**
 * Resizing a text block scales its font size (and letter spacing) proportionally. The box is
 * re-measured at the new size and anchored at the corner opposite to the dragged handle.
 */
export function resizeTextElement(
  el: TextElement,
  h: HandleId,
  delta: Point,
  page: Size,
  measure?: TextMeasurer,
): TextResizePatch {
  const r = resizeRect(el, h, delta, {
    keepAspect: true,
    min: MIN_ELEMENT_SIZE,
    page,
    minFactor: MIN_FONT_SIZE / el.fontSize,
    maxFactor: MAX_FONT_SIZE / el.fontSize,
  })
  const factor = el.width > 0 ? r.width / el.width : 1
  const fontSize = clamp(round2(el.fontSize * factor), MIN_FONT_SIZE, MAX_FONT_SIZE)
  const k = fontSize / el.fontSize
  const letterSpacing = round2(el.letterSpacing * k)
  const layout = layoutTextBlock(el.text, { ...el, fontSize, letterSpacing }, el.align, measure)
  const [dx, dy] = DIRS[h]
  const ax = dx >= 0 ? el.x : el.x + el.width
  const ay = dy >= 0 ? el.y : el.y + el.height
  return {
    fontSize,
    letterSpacing,
    width: layout.width,
    height: layout.height,
    x: dx >= 0 ? ax : ax - layout.width,
    y: dy >= 0 ? ay : ay - layout.height,
  }
}

// ---------------------------------------------------------------------------
// Lines.
// ---------------------------------------------------------------------------

export interface LineBox extends Rect {
  flip: boolean
}

/** The two endpoints of a line element (see the convention in model/types.ts). */
export function lineEndpoints(el: Rect & { flip?: boolean }): [Point, Point] {
  return el.flip
    ? [
        { x: el.x, y: el.y + el.height },
        { x: el.x + el.width, y: el.y },
      ]
    : [
        { x: el.x, y: el.y },
        { x: el.x + el.width, y: el.y + el.height },
      ]
}

/** Box + flip for a line from `a` to `b`. */
export function lineFromEndpoints(a: Point, b: Point): LineBox {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
    flip: (b.x - a.x) * (b.y - a.y) < 0,
  }
}

/**
 * Snaps `p` so the segment anchor→p is a multiple of 45°. Diagonals keep both legs equal; with
 * `bounds`, the result is kept inside [0, width] × [0, height] without breaking the angle.
 */
export function snapAngle45(anchor: Point, p: Point, bounds?: Size): Point {
  const dx = p.x - anchor.x
  const dy = p.y - anchor.y
  if (dx === 0 && dy === 0) return { ...p }
  const octant = (((Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) % 8) + 8) % 8) as number
  let out: Point
  if (octant === 0 || octant === 4) out = { x: p.x, y: anchor.y }
  else if (octant === 2 || octant === 6) out = { x: anchor.x, y: p.y }
  else {
    const sx = Math.sign(dx) || 1
    const sy = Math.sign(dy) || 1
    let d = (Math.abs(dx) + Math.abs(dy)) / 2
    if (bounds) {
      d = Math.min(d, sx > 0 ? bounds.width - anchor.x : anchor.x, sy > 0 ? bounds.height - anchor.y : anchor.y)
      d = Math.max(d, 0)
    }
    return { x: anchor.x + sx * d, y: anchor.y + sy * d }
  }
  return bounds ? clampPoint(out, bounds) : out
}

export function clampPoint(p: Point, bounds: Size): Point {
  return { x: clamp(p.x, 0, bounds.width), y: clamp(p.y, 0, bounds.height) }
}

// ---------------------------------------------------------------------------
// Moving.
// ---------------------------------------------------------------------------

/**
 * The range of a common (dx, dy) that keeps every rect inside its page. Rects that already
 * stick out are allowed to stay where they are.
 */
export function moveBounds(items: { rect: Rect; page: Size }[]): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = -Infinity
  let maxX = Infinity
  let minY = -Infinity
  let maxY = Infinity
  for (const { rect: r, page } of items) {
    minX = Math.max(minX, Math.min(0, -r.x))
    maxX = Math.min(maxX, Math.max(0, page.width - r.x - r.width))
    minY = Math.max(minY, Math.min(0, -r.y))
    maxY = Math.min(maxY, Math.max(0, page.height - r.y - r.height))
  }
  return { minX, maxX, minY, maxY }
}

export function clampDelta(d: Point, b: ReturnType<typeof moveBounds>): Point {
  return { x: clamp(d.x, b.minX, Math.max(b.minX, b.maxX)), y: clamp(d.y, b.minY, Math.max(b.minY, b.maxY)) }
}

/** Places a rect of the given size so it fits the page (top-left wins when it can't). */
export function fitRectInPage(r: Rect, page: Size): Rect {
  const x = Math.max(0, Math.min(r.x, page.width - r.width))
  const y = Math.max(0, Math.min(r.y, page.height - r.height))
  return { ...r, x, y }
}

// ---------------------------------------------------------------------------
// Hit testing.
// ---------------------------------------------------------------------------

/** Element bounds for hit testing; zero-thickness lines get half their stroke width around them. */
export function hitBounds(el: Element): Rect {
  if (el.kind === 'shape' && el.shape === 'line') {
    const pad = Math.max(el.strokeWidth / 2, 0.5)
    return { x: el.x - pad, y: el.y - pad, width: el.width + pad * 2, height: el.height + pad * 2 }
  }
  return { x: el.x, y: el.y, width: el.width, height: el.height }
}

function rectsTouch(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height
}

/** Distance from p to segment ab. */
export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const vx = b.x - a.x
  const vy = b.y - a.y
  const len2 = vx * vx + vy * vy
  const t = len2 ? clamp(((p.x - a.x) * vx + (p.y - a.y) * vy) / len2, 0, 1) : 0
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy))
}

function segmentIntersectsRect(a: Point, b: Point, r: Rect): boolean {
  // Liang–Barsky clipping.
  let t0 = 0
  let t1 = 1
  const dx = b.x - a.x
  const dy = b.y - a.y
  const checks: [number, number][] = [
    [-dx, a.x - r.x],
    [dx, r.x + r.width - a.x],
    [-dy, a.y - r.y],
    [dy, r.y + r.height - a.y],
  ]
  for (const [p, q] of checks) {
    if (p === 0) {
      if (q < 0) return false
    } else {
      const t = q / p
      if (p < 0) {
        if (t > t1) return false
        if (t > t0) t0 = t
      } else {
        if (t < t0) return false
        if (t < t1) t1 = t
      }
    }
  }
  return true
}

/** Ids of the elements a marquee rect touches (lines: the segment itself must touch it). */
export function elementsInMarquee(elements: readonly Element[], marquee: Rect): string[] {
  const out: string[] = []
  for (const el of elements) {
    if (el.kind === 'shape' && el.shape === 'line') {
      const [a, b] = lineEndpoints(el)
      if (segmentIntersectsRect(a, b, marquee)) out.push(el.id)
    } else if (rectsTouch(hitBounds(el), marquee)) out.push(el.id)
  }
  return out
}

/** Topmost element under `p` (paint order = array order), optionally filtered. */
export function topmostAt(elements: readonly Element[], p: Point, accept: (el: Element) => boolean = () => true, tolerance = 0): Element | null {
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i]
    if (!accept(el)) continue
    if (el.kind === 'shape' && el.shape === 'line') {
      const [a, b] = lineEndpoints(el)
      if (distanceToSegment(p, a, b) <= el.strokeWidth / 2 + tolerance) return el
      continue
    }
    const r = hitBounds(el)
    if (p.x >= r.x - tolerance && p.x <= r.x + r.width + tolerance && p.y >= r.y - tolerance && p.y <= r.y + r.height + tolerance) {
      return el
    }
  }
  return null
}
