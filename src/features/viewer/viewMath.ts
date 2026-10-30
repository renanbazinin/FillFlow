/**
 * Pure geometry used by the viewer (no DOM access), so it can be unit-tested.
 * "Client" coordinates are CSS pixels relative to the browser viewport (like `getBoundingClientRect`).
 */

export interface Span {
  start: number
  end: number
}

export interface ClientRect {
  left: number
  top: number
  right: number
  bottom: number
}

/** A point on a page (view space, points) that should appear at a given client position. */
export interface PageAnchor {
  page: number
  x: number
  y: number
  clientX: number
  clientY: number
}

/**
 * Scroll delta that moves page point (a.x, a.y) under (a.clientX, a.clientY), given where the page
 * frame's top-left corner currently is on screen and the current scale (CSS px per point).
 * Add the result to scrollLeft/scrollTop.
 */
export function anchorScrollDelta(frameLeft: number, frameTop: number, scale: number, a: PageAnchor): { dx: number; dy: number } {
  return {
    dx: frameLeft + a.x * scale - a.clientX,
    dy: frameTop + a.y * scale - a.clientY,
  }
}

/**
 * Index of the span nearest to `y` among `count` spans sorted top-to-bottom and non-overlapping
 * (binary search, O(log n) calls to `span`). Returns -1 when there are none.
 */
export function nearestSpanIndex(count: number, span: (index: number) => Span, y: number): number {
  if (count <= 0) return -1
  if (y <= span(0).start) return 0
  // Last span whose start is <= y.
  let lo = 0
  let hi = count - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (span(mid).start <= y) lo = mid
    else hi = mid - 1
  }
  const s = span(lo)
  if (y <= s.end || lo === count - 1) return lo
  const next = span(lo + 1)
  return y - s.end <= next.start - y ? lo : lo + 1
}

/** Index of the span that contains `y`, or -1. */
export function spanIndexAt(count: number, span: (index: number) => Span, y: number): number {
  const i = nearestSpanIndex(count, span, y)
  if (i < 0) return -1
  const s = span(i)
  return y >= s.start && y <= s.end ? i : -1
}

/**
 * Minimal scroll along one axis so [start, end] is inside [viewStart + margin, viewEnd - margin].
 * When the target is bigger than the room available, its start is aligned instead.
 */
export function revealDelta(start: number, end: number, viewStart: number, viewEnd: number, margin: number): number {
  const lo = viewStart + margin
  const hi = viewEnd - margin
  if (end - start > hi - lo) return start - lo
  if (start < lo) return start - lo
  if (end > hi) return end - hi
  return 0
}

/** Distance between a rect and a viewport (0 when they intersect). Used to prioritize rendering. */
export function distanceToViewport(r: ClientRect, view: ClientRect): number {
  const dy = r.bottom < view.top ? view.top - r.bottom : r.top > view.bottom ? r.top - view.bottom : 0
  const dx = r.right < view.left ? view.left - r.right : r.left > view.right ? r.left - view.right : 0
  return dx + dy
}

export function clampPoint(p: { x: number; y: number }, width: number, height: number): { x: number; y: number } {
  return { x: Math.min(Math.max(p.x, 0), width), y: Math.min(Math.max(p.y, 0), height) }
}

// ---------------------------------------------------------------------------
// Canvas resolution.
// ---------------------------------------------------------------------------

/** iOS Safari refuses canvases above 16,777,216 pixels (4096²); stay at or under it everywhere. */
export const MAX_CANVAS_PIXELS = 16_777_216
/** Conservative per-side limit (Chrome/Firefox allow 32767, older mobile GPUs less). */
export const MAX_CANVAS_SIDE = 16_384

/**
 * Device-pixel ratio to render a `cssWidth` × `cssHeight` box at: the screen's ratio, reduced so
 * the bitmap never exceeds `maxPixels` in area or `maxSide` per side.
 */
export function capPixelRatio(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
  maxPixels = MAX_CANVAS_PIXELS,
  maxSide = MAX_CANVAS_SIDE,
): number {
  const dpr = devicePixelRatio > 0 && Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1
  if (cssWidth <= 0 || cssHeight <= 0) return dpr
  return Math.min(dpr, Math.sqrt(maxPixels / (cssWidth * cssHeight)), maxSide / cssWidth, maxSide / cssHeight)
}

/** Integer bitmap size for a CSS box at a pixel ratio, never exceeding the limits used by `capPixelRatio`. */
export function bitmapSize(cssWidth: number, cssHeight: number, ratio: number): { width: number; height: number } {
  return {
    width: Math.max(1, Math.floor(cssWidth * ratio + 1e-6)),
    height: Math.max(1, Math.floor(cssHeight * ratio + 1e-6)),
  }
}

/** On-screen size of a page frame: rounded to whole CSS pixels so the bitmap maps 1:1 onto device pixels. */
export function frameSize(page: { width: number; height: number }, scale: number): { width: number; height: number } {
  return { width: Math.max(1, Math.round(page.width * scale)), height: Math.max(1, Math.round(page.height * scale)) }
}

export interface CssRect {
  x: number
  y: number
  width: number
  height: number
}

export type Matrix6 = [number, number, number, number, number, number]

/**
 * pdf.js `transform` that makes a render fill a `bitmapWidth × bitmapHeight` canvas showing `region`
 * of the page frame (CSS px; default the whole frame). pdf.js maps the page onto `viewportWidth ×
 * viewportHeight` pixels (= the frame at `ratio`); this matrix rescales that onto the integer bitmap
 * (absorbing sub-pixel rounding) and shifts the region's top-left corner to the canvas origin.
 */
export function bitmapTransform(
  viewportWidth: number,
  viewportHeight: number,
  cssWidth: number,
  cssHeight: number,
  bitmapWidth: number,
  bitmapHeight: number,
  region: CssRect = { x: 0, y: 0, width: cssWidth, height: cssHeight },
): Matrix6 {
  const vx = viewportWidth / cssWidth
  const vy = viewportHeight / cssHeight
  const sx = bitmapWidth / region.width
  const sy = bitmapHeight / region.height
  return [sx / vx, 0, 0, sy / vy, -region.x * sx, -region.y * sy]
}

/** A sub-rectangle of a page frame as fractions (0..1) of its width/height — independent of the zoom. */
export interface FrameFraction {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** The part of `frame` inside `view`, as fractions of the frame; null when they don't overlap. */
export function visibleFraction(frame: ClientRect, view: ClientRect): FrameFraction | null {
  const w = frame.right - frame.left
  const h = frame.bottom - frame.top
  if (w <= 0 || h <= 0) return null
  const f = {
    x0: Math.max(0, (view.left - frame.left) / w),
    y0: Math.max(0, (view.top - frame.top) / h),
    x1: Math.min(1, (view.right - frame.left) / w),
    y1: Math.min(1, (view.bottom - frame.top) / h),
  }
  return f.x1 > f.x0 && f.y1 > f.y0 ? f : null
}

export function expandFraction(f: FrameFraction, dx: number, dy: number): FrameFraction {
  return { x0: Math.max(0, f.x0 - dx), y0: Math.max(0, f.y0 - dy), x1: Math.min(1, f.x1 + dx), y1: Math.min(1, f.y1 + dy) }
}

export function containsFraction(outer: FrameFraction, inner: FrameFraction, epsilon = 1e-6): boolean {
  return (
    inner.x0 >= outer.x0 - epsilon && inner.y0 >= outer.y0 - epsilon && inner.x1 <= outer.x1 + epsilon && inner.y1 <= outer.y1 + epsilon
  )
}

export function fractionToCss(f: FrameFraction, cssWidth: number, cssHeight: number): CssRect {
  return { x: f.x0 * cssWidth, y: f.y0 * cssHeight, width: (f.x1 - f.x0) * cssWidth, height: (f.y1 - f.y0) * cssHeight }
}
