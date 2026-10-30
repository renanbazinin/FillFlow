import { getStroke, type StrokeOptions } from 'perfect-freehand'
import type { Box } from './imageUtils'

/**
 * Freehand signature strokes. Points are stored in *pad units*: the pad is always `PAD_UNITS`
 * wide (y uses the same unit), so a drawing survives resizes and renders at any resolution.
 */
export const PAD_UNITS = 1000

export type PenWidth = 'fine' | 'medium' | 'bold'

/** Nominal stroke diameter (pad units) per pen width. */
export const PEN_SIZES: Record<PenWidth, number> = { fine: 5, medium: 8, bold: 12.5 }

export const PEN_WIDTHS: PenWidth[] = ['fine', 'medium', 'bold']

export interface Stroke {
  /** `[x, y, pressure]` in pad units; pressure 0..1. */
  points: [number, number, number][]
  /** Mouse/touch strokes simulate pressure from speed; pen strokes use the real pressure. */
  simulate: boolean
}

const easeOutSine = (t: number) => Math.sin((t * Math.PI) / 2)

/** perfect-freehand options tuned for handwriting (fast = thinner, gentle taper at the end). */
export function strokeOptions(size: number, simulate: boolean, last: boolean): StrokeOptions {
  return {
    size,
    thinning: simulate ? 0.62 : 0.68,
    smoothing: 0.62,
    streamline: simulate ? 0.48 : 0.32,
    simulatePressure: simulate,
    easing: easeOutSine,
    start: { taper: 0, cap: true },
    end: { taper: simulate ? size * 2.5 : 0, cap: true },
    last,
  }
}

function pathLength(points: Stroke['points']): number {
  let len = 0
  for (let i = 1; i < points.length; i++) len += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1])
  return len
}

/** Outline polygon of a stroke (closed, in pad units). */
export function strokeOutline(stroke: Stroke, size: number, last = true): number[][] {
  // A tap or tiny flick is a dot (an i or a period): tapers and speed-based thinning would
  // shrink it to nothing, so draw it round at a steady pressure.
  if (pathLength(stroke.points) < size * 1.5) {
    const pressure = stroke.simulate ? 0.6 : Math.max(0.45, stroke.points[0]?.[2] ?? 0.6)
    return getStroke(
      stroke.points.map(([x, y]) => [x, y, pressure]),
      { ...strokeOptions(size, false, last), start: { cap: true, taper: 0 }, end: { cap: true, taper: 0 } },
    )
  }
  return getStroke(stroke.points, strokeOptions(size, stroke.simulate, last))
}

/**
 * Traces a closed outline into a path, smoothing with quadratic curves through the midpoints
 * of consecutive vertices. Works with `Path2D` and canvas contexts.
 */
export function traceOutline(path: Pick<CanvasPath, 'moveTo' | 'quadraticCurveTo' | 'closePath'>, pts: number[][]): void {
  const n = pts.length
  if (n < 2) return
  const mid = (a: number[], b: number[]) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  const start = mid(pts[0], pts[1])
  path.moveTo(start[0], start[1])
  for (let i = 1; i <= n; i++) {
    const p = pts[i % n]
    const m = mid(p, pts[(i + 1) % n])
    path.quadraticCurveTo(p[0], p[1], m[0], m[1])
  }
  path.closePath()
}

/** Bounds of a set of outlines (the smoothed curves stay inside their vertices' hull). */
export function outlinesBounds(outlines: number[][][]): Box | null {
  let x1 = Infinity
  let y1 = Infinity
  let x2 = -Infinity
  let y2 = -Infinity
  for (const outline of outlines) {
    for (const [x, y] of outline) {
      if (x < x1) x1 = x
      if (y < y1) y1 = y
      if (x > x2) x2 = x
      if (y > y2) y2 = y
    }
  }
  if (x1 === Infinity) return null
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 }
}
