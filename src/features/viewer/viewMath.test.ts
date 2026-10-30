import { describe, expect, it } from 'vitest'
import {
  MAX_CANVAS_PIXELS,
  MAX_CANVAS_SIDE,
  anchorScrollDelta,
  bitmapSize,
  bitmapTransform,
  capPixelRatio,
  clampPoint,
  containsFraction,
  distanceToViewport,
  expandFraction,
  fractionToCss,
  frameSize,
  visibleFraction,
  nearestSpanIndex,
  revealDelta,
  spanIndexAt,
  type PageAnchor,
} from './viewMath'

/** Simulates the viewer layout: pages stacked with fixed gaps, horizontally centered. */
function layout(pages: { width: number; height: number }[], scale: number, containerWidth: number) {
  const pad = 24
  const gap = 40
  let y = pad
  return pages.map((p) => {
    const w = p.width * scale
    const h = p.height * scale
    const contentWidth = Math.max(containerWidth, Math.max(...pages.map((q) => q.width * scale)) + 2 * pad)
    const frame = { left: (contentWidth - w) / 2, top: y, width: w, height: h }
    y += h + gap
    return frame
  })
}

describe('anchorScrollDelta', () => {
  it('keeps the anchored page point under the cursor across a zoom', () => {
    const pages = [{ width: 600, height: 800 }, { width: 600, height: 800 }]
    const containerWidth = 1000
    let scrollLeft = 0
    let scrollTop = 900
    const before = layout(pages, 1, containerWidth)
    // Cursor at client (700, 300); container client origin at (0, 0).
    const cursor = { x: 700, y: 300 }
    const contentY = scrollTop + cursor.y
    const page = contentY > before[1].top ? 1 : 0
    const frame = before[page]
    const anchor: PageAnchor = {
      page,
      x: (scrollLeft + cursor.x - frame.left) / 1,
      y: (contentY - frame.top) / 1,
      clientX: cursor.x,
      clientY: cursor.y,
    }

    const after = layout(pages, 2.5, containerWidth)
    const f = after[page]
    const { dx, dy } = anchorScrollDelta(f.left - scrollLeft, f.top - scrollTop, 2.5, anchor)
    scrollLeft += dx
    scrollTop += dy
    // The same page point is now at the same client position.
    expect(f.left - scrollLeft + anchor.x * 2.5).toBeCloseTo(cursor.x)
    expect(f.top - scrollTop + anchor.y * 2.5).toBeCloseTo(cursor.y)
  })

  it('is zero when nothing moved', () => {
    const a: PageAnchor = { page: 0, x: 10, y: 20, clientX: 110, clientY: 220 }
    expect(anchorScrollDelta(100, 200, 1, a)).toEqual({ dx: 0, dy: 0 })
  })
})

describe('nearestSpanIndex / spanIndexAt', () => {
  const spans = [
    { start: 0, end: 100 },
    { start: 140, end: 240 },
    { start: 280, end: 300 },
    { start: 340, end: 1000 },
  ]
  const span = (i: number) => spans[i]

  it('finds the containing span', () => {
    expect(nearestSpanIndex(4, span, 50)).toBe(0)
    expect(nearestSpanIndex(4, span, 140)).toBe(1)
    expect(nearestSpanIndex(4, span, 299)).toBe(2)
    expect(nearestSpanIndex(4, span, 999)).toBe(3)
  })

  it('picks the closer neighbour inside a gap', () => {
    expect(nearestSpanIndex(4, span, 110)).toBe(0)
    expect(nearestSpanIndex(4, span, 130)).toBe(1)
    expect(nearestSpanIndex(4, span, 320)).toBe(2)
    expect(nearestSpanIndex(4, span, 321)).toBe(3)
  })

  it('clamps outside the range', () => {
    expect(nearestSpanIndex(4, span, -50)).toBe(0)
    expect(nearestSpanIndex(4, span, 5000)).toBe(3)
    expect(nearestSpanIndex(0, span, 10)).toBe(-1)
  })

  it('matches a linear scan on random layouts', () => {
    for (let trial = 0; trial < 50; trial++) {
      const list: { start: number; end: number }[] = []
      let y = Math.random() * 50
      const n = 1 + Math.floor(Math.random() * 30)
      for (let i = 0; i < n; i++) {
        const h = 10 + Math.random() * 400
        list.push({ start: y, end: y + h })
        y += h + 5 + Math.random() * 40
      }
      for (let k = 0; k < 40; k++) {
        const q = Math.random() * (y + 100) - 50
        let best = 0
        let bestD = Infinity
        list.forEach((s, i) => {
          const d = q < s.start ? s.start - q : q > s.end ? q - s.end : 0
          if (d < bestD) {
            bestD = d
            best = i
          }
        })
        const got = nearestSpanIndex(n, (i) => list[i], q)
        const gotD = q < list[got].start ? list[got].start - q : q > list[got].end ? q - list[got].end : 0
        expect(gotD).toBeCloseTo(bestD)
        expect(spanIndexAt(n, (i) => list[i], q)).toBe(bestD === 0 ? got : -1)
        void best
      }
    }
  })
})

describe('revealDelta', () => {
  it('does nothing when already visible with margin', () => {
    expect(revealDelta(200, 300, 0, 800, 48)).toBe(0)
  })
  it('scrolls up / down by the minimum amount', () => {
    expect(revealDelta(20, 100, 0, 800, 48)).toBe(-28)
    expect(revealDelta(700, 790, 0, 800, 48)).toBe(38)
  })
  it('aligns the start of an oversized target', () => {
    expect(revealDelta(100, 2000, 0, 800, 48)).toBe(52)
  })
})

describe('distanceToViewport', () => {
  const view = { left: 0, top: 0, right: 1000, bottom: 800 }
  it('is 0 for intersecting rects and the gap otherwise', () => {
    expect(distanceToViewport({ left: 10, top: 700, right: 500, bottom: 1500 }, view)).toBe(0)
    expect(distanceToViewport({ left: 10, top: 900, right: 500, bottom: 1500 }, view)).toBe(100)
    expect(distanceToViewport({ left: 10, top: -900, right: 500, bottom: -300 }, view)).toBe(300)
    expect(distanceToViewport({ left: 1200, top: 900, right: 1500, bottom: 1500 }, view)).toBe(300)
  })
})

describe('clampPoint', () => {
  it('clamps into the page', () => {
    expect(clampPoint({ x: -5, y: 900 }, 600, 800)).toEqual({ x: 0, y: 800 })
    expect(clampPoint({ x: 10, y: 20 }, 600, 800)).toEqual({ x: 10, y: 20 })
  })
})

describe('capPixelRatio', () => {
  it('keeps the device ratio for normal sizes', () => {
    expect(capPixelRatio(800, 1100, 2)).toBe(2)
    expect(capPixelRatio(800, 1100, 1)).toBe(1)
  })

  it('reduces the ratio so the bitmap stays under the iOS pixel limit', () => {
    // A4 at 500% is ~3967×5613 CSS px.
    const r = capPixelRatio(3967, 5613, 2)
    expect(r).toBeLessThan(1)
    const { width, height } = bitmapSize(3967, 5613, r)
    expect(width * height).toBeLessThanOrEqual(MAX_CANVAS_PIXELS)
    // ...while using (almost) all of it.
    expect(width * height).toBeGreaterThan(MAX_CANVAS_PIXELS * 0.99)
  })

  it('respects the per-side limit for very long pages', () => {
    const r = capPixelRatio(300, 30_000, 2)
    const { width, height } = bitmapSize(300, 30_000, r)
    expect(height).toBeLessThanOrEqual(MAX_CANVAS_SIDE)
    expect(width * height).toBeLessThanOrEqual(MAX_CANVAS_PIXELS)
  })

  it('handles odd inputs', () => {
    expect(capPixelRatio(0, 100, 2)).toBe(2)
    expect(capPixelRatio(100, 100, 0)).toBe(1)
    expect(capPixelRatio(100, 100, Number.NaN)).toBe(1)
  })

  it('never exceeds the limits on random sizes', () => {
    for (let i = 0; i < 500; i++) {
      const w = 1 + Math.random() * 9000
      const h = 1 + Math.random() * 30_000
      const dpr = 0.5 + Math.random() * 3
      const { width, height } = bitmapSize(w, h, capPixelRatio(w, h, dpr))
      expect(width * height).toBeLessThanOrEqual(MAX_CANVAS_PIXELS)
      expect(Math.max(width, height)).toBeLessThanOrEqual(MAX_CANVAS_SIDE)
    }
  })
})

describe('bitmapTransform', () => {
  const apply = (m: number[], x: number, y: number) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]

  it('maps the whole frame onto the integer bitmap', () => {
    // Frame 794x1123 CSS px at ratio 2; pdf.js viewport is 1588 x 1122.5*2 (sub-pixel off).
    const m = bitmapTransform(1588, 2245.03, 794, 1123, 1588, 2246)
    const [x1, y1] = apply(m, 1588, 2245.03)
    expect(x1).toBeCloseTo(1588)
    expect(y1).toBeCloseTo(2246)
    expect(apply(m, 0, 0)).toEqual([0, 0])
  })

  it('maps a region of the frame onto a detail bitmap', () => {
    // Frame 4000x5600 CSS px rendered at ratio 2 (viewport 8000 x 11200); region at (1000, 2000) 800x600.
    const region = { x: 1000, y: 2000, width: 800, height: 600 }
    const m = bitmapTransform(8000, 11200, 4000, 5600, 1600, 1200, region)
    // Viewport pixel of the region's top-left corner -> bitmap origin; bottom-right -> bitmap size.
    expect(apply(m, 2000, 4000)).toEqual([0, 0])
    const [x, y] = apply(m, 3600, 5200)
    expect(x).toBeCloseTo(1600)
    expect(y).toBeCloseTo(1200)
  })
})

describe('frame fractions', () => {
  const frame = { left: 100, top: -500, right: 1100, bottom: 1500 }

  it('computes the visible part of a frame', () => {
    const f = visibleFraction(frame, { left: 0, top: 0, right: 600, bottom: 800 })!
    expect(f.x0).toBe(0)
    expect(f.x1).toBeCloseTo(0.5)
    expect(f.y0).toBeCloseTo(0.25)
    expect(f.y1).toBeCloseTo(0.65)
    expect(visibleFraction(frame, { left: 0, top: 1600, right: 600, bottom: 1900 })).toBeNull()
  })

  it('expands, contains and converts', () => {
    const f = { x0: 0.2, y0: 0.3, x1: 0.6, y1: 0.5 }
    const e = expandFraction(f, 0.3, 0.1)
    expect(e.x0).toBe(0)
    expect(e.y0).toBeCloseTo(0.2)
    expect(e.x1).toBeCloseTo(0.9)
    expect(containsFraction(e, f)).toBe(true)
    expect(containsFraction(f, e)).toBe(false)
    const css = fractionToCss(f, 1000, 2000)
    expect(css.x).toBeCloseTo(200)
    expect(css.y).toBeCloseTo(600)
    expect(css.width).toBeCloseTo(400)
    expect(css.height).toBeCloseTo(400)
  })
})

describe('frameSize', () => {
  it('rounds to whole pixels and never collapses', () => {
    expect(frameSize({ width: 595.28, height: 841.89 }, 4 / 3)).toEqual({ width: 794, height: 1123 })
    expect(frameSize({ width: 0.1, height: 0.1 }, 1)).toEqual({ width: 1, height: 1 })
  })
})
