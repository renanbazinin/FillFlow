import { describe, expect, it } from 'vitest'
import { outlinesBounds, PEN_SIZES, strokeOutline, traceOutline, type Stroke } from './strokes'

function line(x1: number, y1: number, x2: number, y2: number, steps = 24): Stroke {
  const points: Stroke['points'] = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    points.push([x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, 0.5])
  }
  return { points, simulate: true }
}

describe('strokeOutline', () => {
  it('surrounds the input points', () => {
    const outline = strokeOutline(line(100, 200, 500, 200), PEN_SIZES.medium)
    const b = outlinesBounds([outline])!
    expect(b.x).toBeLessThanOrEqual(100)
    expect(b.x + b.width).toBeGreaterThanOrEqual(499)
    expect(b.y).toBeLessThan(200)
    expect(b.y + b.height).toBeGreaterThan(200)
    // Never much thicker than the pen.
    expect(b.height).toBeLessThanOrEqual(PEN_SIZES.medium * 1.6)
  })

  it('turns a single tap into a clearly visible round dot', () => {
    for (const size of [PEN_SIZES.fine, PEN_SIZES.bold]) {
      const outline = strokeOutline({ points: [[300, 120, 0.5]], simulate: true }, size)
      expect(outline.length).toBeGreaterThan(4)
      const b = outlinesBounds([outline])!
      // About as wide as the pen, and round.
      expect(b.width).toBeGreaterThan(size * 0.8)
      expect(b.height).toBeGreaterThan(size * 0.8)
      expect(Math.abs(b.width - b.height)).toBeLessThan(size * 0.4)
      expect(Math.abs(b.x + b.width / 2 - 300)).toBeLessThan(size)
    }
  })

  it('keeps a tiny flick as thick as a dot', () => {
    const flick: Stroke = { points: [[100, 100, 0.5], [101, 100.5, 0.5], [102, 101, 0.5]], simulate: true }
    const b = outlinesBounds([strokeOutline(flick, PEN_SIZES.medium)])!
    expect(b.height).toBeGreaterThan(PEN_SIZES.medium * 0.8)
  })

  it('bolder pens make thicker strokes', () => {
    const s = line(0, 50, 400, 50)
    const thick = (size: number) => outlinesBounds([strokeOutline(s, size)])!.height
    expect(thick(PEN_SIZES.fine)).toBeLessThan(thick(PEN_SIZES.medium))
    expect(thick(PEN_SIZES.medium)).toBeLessThan(thick(PEN_SIZES.bold))
  })

  it('honours real pen pressure when not simulating', () => {
    const light: Stroke = { points: line(0, 50, 400, 50).points.map(([x, y]) => [x, y, 0.1]), simulate: false }
    const heavy: Stroke = { points: line(0, 50, 400, 50).points.map(([x, y]) => [x, y, 1]), simulate: false }
    const h = (s: Stroke) => outlinesBounds([strokeOutline(s, PEN_SIZES.medium)])!.height
    expect(h(light)).toBeLessThan(h(heavy))
  })
})

describe('outlinesBounds', () => {
  it('returns null without points and spans several outlines', () => {
    expect(outlinesBounds([])).toBeNull()
    expect(outlinesBounds([[], []])).toBeNull()
    expect(
      outlinesBounds([
        [
          [1, 2],
          [3, 4],
        ],
        [[-5, 10]],
      ]),
    ).toEqual({ x: -5, y: 2, width: 8, height: 8 })
  })
})

describe('traceOutline', () => {
  it('emits a closed quadratic path through midpoints', () => {
    const calls: string[] = []
    const rec = {
      moveTo: (x: number, y: number) => calls.push(`M${x},${y}`),
      quadraticCurveTo: (cx: number, cy: number, x: number, y: number) => calls.push(`Q${cx},${cy},${x},${y}`),
      closePath: () => calls.push('Z'),
    }
    traceOutline(rec, [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ])
    expect(calls).toEqual(['M5,0', 'Q10,0,10,5', 'Q10,10,5,10', 'Q0,10,0,5', 'Q0,0,5,0', 'Z'])
  })

  it('ignores degenerate outlines', () => {
    const calls: string[] = []
    traceOutline({ moveTo: () => calls.push('M'), quadraticCurveTo: () => calls.push('Q'), closePath: () => calls.push('Z') }, [[1, 1]])
    expect(calls).toEqual([])
  })
})
