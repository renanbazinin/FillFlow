import { describe, expect, it } from 'vitest'
import { createInkElement } from '../../../model/elements'
import type { Point } from '../../../model/types'
import { appendInkStroke, catmullRom, dedupePoints, finalizeStroke, inkStrokesToView, restyleInkWidth, simplifyRDP, smoothPoints, strokesToPath } from './ink'

describe('simplifyRDP', () => {
  it('removes collinear points and keeps corners', () => {
    const pts: Point[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0.1 },
      { x: 2, y: -0.1 },
      { x: 3, y: 0 },
      { x: 3, y: 1 },
      { x: 3.05, y: 2 },
      { x: 3, y: 3 },
    ]
    expect(simplifyRDP(pts, 0.4)).toEqual([
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 3 },
    ])
  })

  it('keeps detail above the tolerance', () => {
    const zigzag: Point[] = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 0 },
      { x: 3, y: 1 },
    ]
    expect(simplifyRDP(zigzag, 0.4)).toHaveLength(4)
  })

  it('handles tiny inputs and closed loops', () => {
    expect(simplifyRDP([{ x: 1, y: 1 }], 1)).toEqual([{ x: 1, y: 1 }])
    const loop: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 0 },
    ]
    expect(simplifyRDP(loop, 0.5)).toEqual(loop)
  })

  it('handles long strokes without recursion limits', () => {
    const pts = Array.from({ length: 100000 }, (_, i) => ({ x: i, y: Math.sin(i / 50) * 20 }))
    const out = simplifyRDP(pts, 0.4)
    expect(out.length).toBeLessThan(pts.length / 10)
    expect(out[0]).toEqual(pts[0])
    expect(out[out.length - 1]).toEqual(pts[pts.length - 1])
  })
})

describe('stroke cleanup', () => {
  it('drops near-duplicate samples but keeps the last point', () => {
    const out = dedupePoints(
      [
        { x: 0, y: 0 },
        { x: 0.1, y: 0 },
        { x: 2, y: 0 },
        { x: 2.05, y: 0 },
      ],
      0.5,
    )
    expect(out).toEqual([
      { x: 0, y: 0 },
      { x: 2.05, y: 0 },
    ])
  })

  it('smooths interior points only', () => {
    const out = smoothPoints([
      { x: 0, y: 0 },
      { x: 1, y: 4 },
      { x: 2, y: 0 },
    ])
    expect(out).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 2 },
      { x: 2, y: 0 },
    ])
  })

  it('finalizes a tap into a single point and a drag into a short polyline', () => {
    expect(finalizeStroke([{ x: 5, y: 5 }], 1)).toEqual([{ x: 5, y: 5 }])
    expect(
      finalizeStroke(
        [
          { x: 5, y: 5 },
          { x: 5.1, y: 5 },
        ],
        1,
      ),
    ).toHaveLength(1)
    const line = Array.from({ length: 50 }, (_, i) => ({ x: i, y: 10 }))
    expect(finalizeStroke(line, 1)).toEqual([
      { x: 0, y: 10 },
      { x: 49, y: 10 },
    ])
  })
})

describe('catmullRom', () => {
  it('passes through every input point and adds points on long segments', () => {
    const pts: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 0 },
      { x: 30, y: 10 },
    ]
    const out = catmullRom(pts, 1.5)
    for (const p of pts) expect(out).toContainEqual(p)
    expect(out.length).toBeGreaterThan(pts.length * 5)
    // Stays close to the polygon (no wild overshoot).
    for (const p of out) {
      expect(p.y).toBeGreaterThan(-3)
      expect(p.y).toBeLessThan(13)
    }
  })

  it('leaves short or two-point strokes alone', () => {
    expect(
      catmullRom(
        [
          { x: 0, y: 0 },
          { x: 50, y: 0 },
        ],
        1.5,
      ),
    ).toHaveLength(2)
  })

  it('rounds a corner without collapsing it, and keeps straight strokes minimal', () => {
    const corner = finalizeStroke(
      [
        ...Array.from({ length: 20 }, (_, i) => ({ x: i, y: 0 })),
        ...Array.from({ length: 20 }, (_, i) => ({ x: 20, y: i + 1 })),
      ],
      1,
    )
    expect(corner.length).toBeGreaterThan(3)
    expect(corner[0]).toEqual({ x: 0, y: 0 })
    expect(corner[corner.length - 1]).toEqual({ x: 20, y: 20 })
    const straight = finalizeStroke(
      Array.from({ length: 50 }, (_, i) => ({ x: i, y: 2 * i })),
      1,
    )
    expect(straight).toHaveLength(2)
  })
})

describe('ink elements', () => {
  const style = { color: '#1d4ed8', strokeWidth: 2 }
  const first = createInkElement(
    0,
    [
      [
        { x: 10, y: 10 },
        { x: 30, y: 20 },
      ],
    ],
    style,
  )!

  it('round-trips strokes through the normalized form', () => {
    const [s] = inkStrokesToView(first)
    expect(s[0].x).toBeCloseTo(10)
    expect(s[0].y).toBeCloseTo(10)
    expect(s[1].x).toBeCloseTo(30)
    expect(s[1].y).toBeCloseTo(20)
  })

  it('appends a stroke and grows the box around everything', () => {
    const g = appendInkStroke(first, [
      { x: 50, y: 5 },
      { x: 60, y: 40 },
    ])
    expect(g.strokes).toHaveLength(2)
    expect(g.x).toBeCloseTo(9)
    expect(g.y).toBeCloseTo(4)
    expect(g.width).toBeCloseTo(52)
    expect(g.height).toBeCloseTo(37)
    const back = inkStrokesToView({ ...first, ...g })
    expect(back[0][1].x).toBeCloseTo(30)
    expect(back[1][1].y).toBeCloseTo(40)
  })

  it('re-pads the box when the pen width changes', () => {
    const g = restyleInkWidth(first, 6)
    expect(g.strokeWidth).toBe(6)
    expect(g.x).toBeCloseTo(7)
    expect(g.width).toBeCloseTo(26)
    const [s] = inkStrokesToView({ ...first, ...g })
    expect(s[0].x).toBeCloseTo(10)
    expect(s[1].y).toBeCloseTo(20)
  })

  it('builds SVG path data, with dots for single points', () => {
    expect(
      strokesToPath([
        [
          { x: 1, y: 2 },
          { x: 3.456, y: 4 },
        ],
        [{ x: 7, y: 8 }],
      ]),
    ).toBe('M1 2L3.46 4M7 8l0 0')
  })
})
