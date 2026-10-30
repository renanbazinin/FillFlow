import { describe, expect, it } from 'vitest'
import { MAX_SCALE, MIN_SCALE, PT_TO_PX } from '../../store/editor'
import {
  FIT_WIDTH_MAX_SCALE,
  ZOOM_STEPS,
  canZoomIn,
  canZoomOut,
  clampScale,
  computeFitScale,
  percentToScale,
  pinchScale,
  scaleToPercent,
  stepZoom,
  wheelDeltaPx,
  wheelZoomLog,
} from './zoom'

const pct = (scale: number) => Math.round(scaleToPercent(scale) * 100) / 100

describe('stepZoom', () => {
  it('walks every step up and down', () => {
    let s = MIN_SCALE
    const up: number[] = [pct(s)]
    while (canZoomIn(s)) {
      s = stepZoom(s, 1)
      up.push(pct(s))
    }
    expect(up).toEqual([...ZOOM_STEPS])
    const down: number[] = [pct(s)]
    while (canZoomOut(s)) {
      s = stepZoom(s, -1)
      down.push(pct(s))
    }
    expect(down).toEqual([...ZOOM_STEPS].reverse())
  })

  it('snaps an in-between zoom to the neighbouring steps', () => {
    expect(pct(stepZoom(percentToScale(118), 1))).toBe(125)
    expect(pct(stepZoom(percentToScale(118), -1))).toBe(110)
    expect(pct(stepZoom(percentToScale(87.3), 1))).toBe(90)
    expect(pct(stepZoom(percentToScale(87.3), -1))).toBe(75)
  })

  it('treats a level within half a percent of a step as that step', () => {
    expect(pct(stepZoom(percentToScale(124.8), 1))).toBe(150)
    expect(pct(stepZoom(percentToScale(125.3), -1))).toBe(110)
  })

  it('stays at the limits', () => {
    expect(stepZoom(MAX_SCALE, 1)).toBe(MAX_SCALE)
    expect(stepZoom(MIN_SCALE, -1)).toBe(MIN_SCALE)
    expect(canZoomIn(MAX_SCALE)).toBe(false)
    expect(canZoomOut(MIN_SCALE)).toBe(false)
  })
})

describe('clampScale', () => {
  it('clamps and survives garbage', () => {
    expect(clampScale(100)).toBe(MAX_SCALE)
    expect(clampScale(0)).toBe(MIN_SCALE)
    expect(clampScale(Number.NaN)).toBe(PT_TO_PX)
  })
})

describe('computeFitScale', () => {
  const a4 = { width: 595, height: 842 }
  const landscape = { width: 842, height: 595 }
  const base = { viewportWidth: 1000, viewportHeight: 800, padX: 24, padTop: 24, padBottom: 120 }

  it('fits the widest page into the width minus padding', () => {
    const s = computeFitScale({ ...base, mode: 'width', pages: [a4, landscape, a4] })
    expect(s).toBeCloseTo((1000 - 48) / 842)
  })

  it('caps fit-width at 150% on very wide containers', () => {
    const s = computeFitScale({ ...base, viewportWidth: 4000, mode: 'width', pages: [a4] })
    expect(s).toBe(FIT_WIDTH_MAX_SCALE)
    expect(pct(s)).toBe(150)
  })

  it('fit page is limited by the tallest page height', () => {
    const s = computeFitScale({ ...base, mode: 'page', pages: [landscape, a4] })
    expect(s).toBeCloseTo((800 - 24 - 120) / 842)
  })

  it('fit page is limited by width when the container is narrow', () => {
    const s = computeFitScale({ ...base, viewportWidth: 300, viewportHeight: 2000, padX: 12, mode: 'page', pages: [a4] })
    expect(s).toBeCloseTo(Math.max((300 - 24) / 595, MIN_SCALE))
  })

  it('fit page may exceed the fit-width cap (it shows the whole page)', () => {
    const s = computeFitScale({ ...base, viewportWidth: 4000, viewportHeight: 3000, mode: 'page', pages: [a4] })
    expect(s).toBeGreaterThan(FIT_WIDTH_MAX_SCALE)
  })

  it('clamps to the zoom limits', () => {
    expect(computeFitScale({ ...base, viewportWidth: 60, mode: 'width', pages: [a4] })).toBe(MIN_SCALE)
    expect(computeFitScale({ ...base, viewportWidth: 1e5, viewportHeight: 1e5, mode: 'page', pages: [{ width: 10, height: 10 }] })).toBe(MAX_SCALE)
  })

  it('falls back to 100% without pages or size', () => {
    expect(computeFitScale({ ...base, mode: 'width', pages: [] })).toBe(PT_TO_PX)
    expect(computeFitScale({ ...base, viewportWidth: 0, mode: 'width', pages: [a4] })).toBe(PT_TO_PX)
  })
})

describe('wheel & pinch', () => {
  it('normalizes delta modes to pixels', () => {
    expect(wheelDeltaPx({ deltaY: 100, deltaMode: 0 })).toBe(100)
    expect(wheelDeltaPx({ deltaY: 3, deltaMode: 1 })).toBe(99)
    expect(wheelDeltaPx({ deltaY: 1, deltaMode: 2 }, 700)).toBe(700)
  })

  it('one wheel notch zooms by roughly 25%, symmetrically', () => {
    const zin = Math.exp(wheelZoomLog(-100, false))
    const zout = Math.exp(wheelZoomLog(100, false))
    expect(zin).toBeGreaterThan(1.2)
    expect(zin).toBeLessThan(1.3)
    expect(zin * zout).toBeCloseTo(1)
  })

  it('is exponential: two half-steps equal one full step', () => {
    const one = Math.exp(wheelZoomLog(-80, true))
    const two = Math.exp(wheelZoomLog(-40, true)) ** 2
    expect(two).toBeCloseTo(one)
  })

  it('clamps huge deltas', () => {
    expect(wheelZoomLog(-10_000, false)).toBe(wheelZoomLog(-120, false))
  })

  it('pinch scale follows the finger distance ratio', () => {
    expect(pinchScale(2, 100, 150)).toBeCloseTo(3)
    expect(pinchScale(2, 0, 150)).toBe(2)
  })
})
