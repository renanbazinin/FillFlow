import { createInkElement } from '../../../model/elements'
import type { InkElement, Point } from '../../../model/types'

/**
 * Freehand stroke processing. Points are simplified/smoothed once, when a stroke ends, so the
 * screen and the export draw exactly the same polylines (see InkElement in model/types.ts).
 */

/** Ramer–Douglas–Peucker simplification (iterative). Keeps the first and last points. */
export function simplifyRDP(points: readonly Point[], epsilon: number): Point[] {
  const n = points.length
  if (n <= 2) return points.map((p) => ({ ...p }))
  const keep = new Uint8Array(n)
  keep[0] = 1
  keep[n - 1] = 1
  const stack: [number, number][] = [[0, n - 1]]
  while (stack.length) {
    const [first, last] = stack.pop()!
    const a = points[first]
    const b = points[last]
    const vx = b.x - a.x
    const vy = b.y - a.y
    const len = Math.hypot(vx, vy)
    let maxDist = -1
    let index = -1
    for (let i = first + 1; i < last; i++) {
      const p = points[i]
      const d = len === 0 ? Math.hypot(p.x - a.x, p.y - a.y) : Math.abs(vy * p.x - vx * p.y + b.x * a.y - b.y * a.x) / len
      if (d > maxDist) {
        maxDist = d
        index = i
      }
    }
    if (index !== -1 && maxDist > epsilon) {
      keep[index] = 1
      stack.push([first, index], [index, last])
    }
  }
  const out: Point[] = []
  for (let i = 0; i < n; i++) if (keep[i]) out.push({ x: points[i].x, y: points[i].y })
  return out
}

/** Drops consecutive points closer than `minDistance`; the stroke still ends at its last sample unless it never left the first one. */
export function dedupePoints(points: readonly Point[], minDistance: number): Point[] {
  if (points.length <= 1) return points.map((p) => ({ ...p }))
  const out: Point[] = [{ ...points[0] }]
  for (let i = 1; i < points.length - 1; i++) {
    const prev = out[out.length - 1]
    if (Math.hypot(points[i].x - prev.x, points[i].y - prev.y) >= minDistance) out.push({ ...points[i] })
  }
  const last = points[points.length - 1]
  const prev = out[out.length - 1]
  if (Math.hypot(last.x - prev.x, last.y - prev.y) >= minDistance) out.push({ ...last })
  else if (out.length > 1) out[out.length - 1] = { ...last }
  return out
}

/** Light smoothing: a [¼ ½ ¼] kernel over interior points; endpoints stay put. */
export function smoothPoints(points: readonly Point[], passes = 1): Point[] {
  let cur = points.map((p) => ({ ...p }))
  for (let k = 0; k < passes; k++) {
    if (cur.length < 3) break
    const next = cur.map((p) => ({ ...p }))
    for (let i = 1; i < cur.length - 1; i++) {
      next[i] = {
        x: cur[i - 1].x * 0.25 + cur[i].x * 0.5 + cur[i + 1].x * 0.25,
        y: cur[i - 1].y * 0.25 + cur[i].y * 0.5 + cur[i + 1].y * 0.25,
      }
    }
    cur = next
  }
  return cur
}

/**
 * Turns raw pointer samples (view-space points) into the stroke that gets stored.
 * `scale` (CSS px per point) keeps the tolerance below what's visible at the current zoom.
 */
export function finalizeStroke(raw: readonly Point[], scale: number): Point[] {
  if (!raw.length) return []
  const pxToPt = 1 / Math.max(scale, 0.01)
  const deduped = dedupePoints(raw, 0.6 * pxToPt)
  if (deduped.length === 1) return deduped
  const smoothed = smoothPoints(deduped, 1)
  const epsilon = Math.min(0.4, 0.5 * pxToPt)
  const simple = simplifyRDP(smoothed, epsilon)
  // Curves through the kept points so the stroke stays round when zoomed in; straight runs
  // collapse back to their endpoints.
  const curved = simplifyRDP(catmullRom(simple, 1.5), 0.02)
  return curved.map((p) => ({ x: round3(p.x), y: round3(p.y) }))
}

/**
 * Densifies a polyline along a centripetal Catmull–Rom spline through its points (no
 * overshoot or cusps on uneven spacing). Segments longer than `maxStep` get extra points.
 */
export function catmullRom(points: readonly Point[], maxStep: number, maxPerSegment = 12): Point[] {
  const n = points.length
  if (n < 3) return points.map((p) => ({ ...p }))
  const at = (i: number): Point => {
    if (i < 0) return { x: 2 * points[0].x - points[1].x, y: 2 * points[0].y - points[1].y }
    if (i >= n) return { x: 2 * points[n - 1].x - points[n - 2].x, y: 2 * points[n - 1].y - points[n - 2].y }
    return points[i]
  }
  const out: Point[] = [{ ...points[0] }]
  for (let i = 0; i < n - 1; i++) {
    const p0 = at(i - 1)
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = at(i + 2)
    const len = Math.hypot(p2.x - p1.x, p2.y - p1.y)
    const steps = Math.min(maxPerSegment, Math.ceil(len / maxStep))
    for (let k = 1; k < steps; k++) out.push(centripetal(p0, p1, p2, p3, k / steps))
    out.push({ ...p2 })
  }
  return out
}

function knot(a: Point, b: Point, t: number): number {
  return t + Math.max(Math.sqrt(Math.hypot(b.x - a.x, b.y - a.y)), 1e-4)
}

/** Point at fraction `u` of the p1→p2 span (Barry–Goldman pyramid, alpha = 0.5). */
function centripetal(p0: Point, p1: Point, p2: Point, p3: Point, u: number): Point {
  const t0 = 0
  const t1 = knot(p0, p1, t0)
  const t2 = knot(p1, p2, t1)
  const t3 = knot(p2, p3, t2)
  const t = t1 + (t2 - t1) * u
  const lerp = (a: Point, b: Point, ta: number, tb: number): Point => {
    const w = (t - ta) / (tb - ta)
    return { x: a.x + (b.x - a.x) * w, y: a.y + (b.y - a.y) * w }
  }
  const a1 = lerp(p0, p1, t0, t1)
  const a2 = lerp(p1, p2, t1, t2)
  const a3 = lerp(p2, p3, t2, t3)
  const b1 = lerp(a1, a2, t0, t2)
  const b2 = lerp(a2, a3, t1, t3)
  return lerp(b1, b2, t1, t2)
}

const round3 = (n: number) => Math.round(n * 1000) / 1000

/** The element's strokes in view-space points. */
export function inkStrokesToView(el: Pick<InkElement, 'x' | 'y' | 'width' | 'height' | 'strokes'>): Point[][] {
  return el.strokes.map((s) => {
    const pts: Point[] = []
    for (let i = 0; i + 1 < s.length; i += 2) pts.push({ x: el.x + s[i] * el.width, y: el.y + s[i + 1] * el.height })
    return pts
  })
}

export type InkGeometry = Pick<InkElement, 'x' | 'y' | 'width' | 'height' | 'strokes' | 'strokeWidth'>

/** Geometry for `el` with one more stroke (view-space points). */
export function appendInkStroke(el: InkElement, stroke: Point[]): InkGeometry {
  const rebuilt = createInkElement(el.page, [...inkStrokesToView(el), stroke], { color: el.color, strokeWidth: el.strokeWidth })!
  return pickGeometry(rebuilt)
}

/** Geometry for `el` drawn with a different pen width (the box is re-padded around the strokes). */
export function restyleInkWidth(el: InkElement, strokeWidth: number): InkGeometry {
  const rebuilt = createInkElement(el.page, inkStrokesToView(el), { color: el.color, strokeWidth })!
  return pickGeometry(rebuilt)
}

function pickGeometry(el: InkElement): InkGeometry {
  return { x: el.x, y: el.y, width: el.width, height: el.height, strokes: el.strokes, strokeWidth: el.strokeWidth }
}

/** SVG path data for strokes given in CSS pixels. Single-point strokes become a zero-length segment (a dot with round caps). */
export function strokesToPath(strokes: readonly (readonly Point[])[]): string {
  let d = ''
  for (const s of strokes) {
    if (!s.length) continue
    d += `M${fmt(s[0].x)} ${fmt(s[0].y)}`
    if (s.length === 1) d += `l0 0`
    for (let i = 1; i < s.length; i++) d += `L${fmt(s[i].x)} ${fmt(s[i].y)}`
  }
  return d
}

const fmt = (n: number) => (Math.round(n * 100) / 100).toString()
