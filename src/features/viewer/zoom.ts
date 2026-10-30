import { MAX_SCALE, MIN_SCALE, PT_TO_PX } from '../../store/editor'
import type { PageInfo } from '../../model/types'
import { clamp } from '../../lib/utils/misc'

/** Zoom levels (percent of actual size) visited by zoom in / zoom out. */
export const ZOOM_STEPS = [25, 33, 50, 67, 75, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400, 500] as const

/** Levels offered in the zoom menu. */
export const ZOOM_PRESETS = [50, 75, 100, 125, 150, 200, 300] as const

/** Fit-width never goes beyond 150% so text stays a comfortable size on very wide screens. */
export const FIT_WIDTH_MAX_SCALE = 1.5 * PT_TO_PX

/** Tolerance (in percent) when comparing a zoom level against a step. */
const STEP_EPSILON = 0.5

export const percentToScale = (percent: number) => (percent / 100) * PT_TO_PX
export const scaleToPercent = (scale: number) => (scale / PT_TO_PX) * 100

export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return PT_TO_PX
  return clamp(scale, MIN_SCALE, MAX_SCALE)
}

export const canZoomIn = (scale: number) => scale < MAX_SCALE - 1e-6
export const canZoomOut = (scale: number) => scale > MIN_SCALE + 1e-6

/** The next zoom step strictly above (`1`) or below (`-1`) the current scale, clamped to the limits. */
export function stepZoom(scale: number, direction: 1 | -1): number {
  const percent = scaleToPercent(scale)
  if (direction > 0) {
    const next = ZOOM_STEPS.find((step) => step > percent + STEP_EPSILON)
    return next === undefined ? MAX_SCALE : clampScale(percentToScale(next))
  }
  for (let i = ZOOM_STEPS.length - 1; i >= 0; i--) {
    if (ZOOM_STEPS[i] < percent - STEP_EPSILON) return clampScale(percentToScale(ZOOM_STEPS[i]))
  }
  return MIN_SCALE
}

export interface FitInput {
  mode: 'width' | 'page'
  /** Inner size of the scroll container (scrollbars excluded). */
  viewportWidth: number
  viewportHeight: number
  pages: readonly Pick<PageInfo, 'width' | 'height'>[]
  padX: number
  padTop: number
  padBottom: number
}

/**
 * Fit width: the widest page fills the available width (capped at 150%).
 * Fit page: additionally the tallest page fits the available height.
 */
export function computeFitScale({ mode, viewportWidth, viewportHeight, pages, padX, padTop, padBottom }: FitInput): number {
  if (!pages.length || viewportWidth <= 0) return PT_TO_PX
  let maxWidth = 0
  let maxHeight = 0
  for (const p of pages) {
    if (p.width > maxWidth) maxWidth = p.width
    if (p.height > maxHeight) maxHeight = p.height
  }
  if (maxWidth <= 0 || maxHeight <= 0) return PT_TO_PX
  const byWidth = Math.max(1, viewportWidth - 2 * padX) / maxWidth
  if (mode === 'width') return clampScale(Math.min(byWidth, FIT_WIDTH_MAX_SCALE))
  const byHeight = Math.max(1, viewportHeight - padTop - padBottom) / maxHeight
  return clampScale(Math.min(byWidth, byHeight))
}

// ---------------------------------------------------------------------------
// Wheel / pinch zoom.
// ---------------------------------------------------------------------------

const LINE_HEIGHT_PX = 33
/** Per-pixel exponent for a Ctrl/⌘ + mouse wheel: one 100px notch ≈ 25%. */
const WHEEL_ZOOM_RATE = 0.0022
/** Trackpad pinch (synthesized ctrl+wheel) maps 1:1 like the browser's own pinch-zoom. */
const PINCH_ZOOM_RATE = 0.01
const MAX_WHEEL_DELTA = 120

/** Wheel delta in pixels regardless of `deltaMode`. */
export function wheelDeltaPx(e: Pick<WheelEvent, 'deltaY' | 'deltaMode'>, pageHeight = 800): number {
  if (e.deltaMode === 1) return e.deltaY * LINE_HEIGHT_PX
  if (e.deltaMode === 2) return e.deltaY * pageHeight
  return e.deltaY
}

/**
 * Natural-log zoom change for one wheel event (positive = zoom in). Summing these and applying
 * `exp(sum)` makes zooming exponential: equal wheel travel always multiplies the zoom by the same factor.
 */
export function wheelZoomLog(deltaPx: number, pinch: boolean): number {
  const d = clamp(deltaPx, -MAX_WHEEL_DELTA, MAX_WHEEL_DELTA)
  return -d * (pinch ? PINCH_ZOOM_RATE : WHEEL_ZOOM_RATE)
}

/** Zoom factor of a two-finger pinch: ratio of finger distances (guarded against degenerate spans). */
export function pinchScale(startScale: number, startDistance: number, distance: number): number {
  if (startDistance < 1 || distance < 1) return startScale
  return startScale * (distance / startDistance)
}
