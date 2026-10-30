import { describe, expect, it } from 'vitest'
import { buildSnapTargets, snapMove } from './snap'

const page = { width: 600, height: 800 }

describe('snapMove', () => {
  const other = { x: 100, y: 100, width: 100, height: 50 }
  const targets = buildSnapTargets([other], page)

  it('snaps the left edge to another element’s left edge', () => {
    const r = snapMove({ x: 103, y: 450, width: 40, height: 20 }, targets, 5)
    expect(r.dx).toBeCloseTo(-3)
    expect(r.dy).toBe(0)
    expect(r.guides).toEqual([{ axis: 'x', pos: 100, from: 100, to: 470 }])
  })

  it('snaps centers to centers and to the page center', () => {
    // Center x = 152 → other's center (150).
    const c = snapMove({ x: 132, y: 400, width: 40, height: 20 }, targets, 5)
    expect(c.dx).toBeCloseTo(-2)
    // Page center: y center 398 → 400.
    const p = snapMove({ x: 400, y: 388, width: 40, height: 20 }, targets, 5)
    expect(p.dy).toBeCloseTo(2)
    expect(p.guides).toContainEqual({ axis: 'y', pos: 400, from: 0, to: 600 })
  })

  it('picks the closest candidate and ignores ones beyond the threshold', () => {
    // Right edge 196 is 4 away from 200; left edge 156 is 6 away from 150 (center) → right edge wins.
    const r = snapMove({ x: 156, y: 600, width: 40, height: 20 }, targets, 5)
    expect(r.dx).toBeCloseTo(4)
    const none = snapMove({ x: 20, y: 600, width: 40, height: 20 }, targets, 5)
    expect(none).toEqual({ dx: 0, dy: 0, guides: [] })
  })

  it('snaps both axes and reports a guide per aligned line', () => {
    const r = snapMove({ x: 201, y: 149, width: 30, height: 30 }, targets, 5)
    expect(r.dx).toBeCloseTo(-1)
    expect(r.dy).toBeCloseTo(1)
    expect(r.guides.map((g) => [g.axis, g.pos])).toEqual([
      ['x', 200],
      ['y', 150],
    ])
  })

  it('merges guides from several elements on the same line', () => {
    const t = buildSnapTargets(
      [
        { x: 50, y: 10, width: 20, height: 20 },
        { x: 50, y: 300, width: 20, height: 20 },
      ],
      page,
    )
    const r = snapMove({ x: 52, y: 100, width: 6, height: 6 }, t, 5)
    expect(r.dx).toBeCloseTo(-2)
    expect(r.guides).toEqual([{ axis: 'x', pos: 50, from: 10, to: 320 }])
  })
})
