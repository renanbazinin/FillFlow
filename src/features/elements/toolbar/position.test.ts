import { describe, expect, it } from 'vitest'
import { fitsAboveOrBelow, intersectBoxes, placeToolbar, popoverSide } from './position'

const bounds = { left: 0, top: 100, right: 1000, bottom: 800 }
const bar = { width: 300, height: 40 }

describe('placeToolbar', () => {
  it('centers above the selection', () => {
    expect(placeToolbar({ left: 400, top: 400, right: 500, bottom: 450 }, bar, bounds)).toEqual({ x: 300, y: 350, side: 'top' })
  })

  it('flips below when there is no room above', () => {
    expect(placeToolbar({ left: 400, top: 120, right: 500, bottom: 150 }, bar, bounds)).toEqual({ x: 300, y: 160, side: 'bottom' })
  })

  it('stays inside the visible area when neither side fits', () => {
    const p = placeToolbar({ left: 400, top: 90, right: 500, bottom: 790 }, bar, bounds)
    expect(p?.side).toBe('inside')
    expect(p?.y).toBe(108)
  })

  it('clamps horizontally and hides when scrolled away', () => {
    expect(placeToolbar({ left: 0, top: 400, right: 20, bottom: 420 }, bar, bounds)?.x).toBe(8)
    expect(placeToolbar({ left: 980, top: 400, right: 1000, bottom: 420 }, bar, bounds)?.x).toBe(692)
    expect(placeToolbar({ left: 400, top: 820, right: 500, bottom: 900 }, bar, bounds)).toBeNull()
    expect(placeToolbar({ left: 400, top: 0, right: 500, bottom: 90 }, bar, bounds)).toBeNull()
  })

  it('opens popovers away from the selection', () => {
    const above = placeToolbar({ left: 400, top: 400, right: 500, bottom: 450 }, bar, bounds)!
    expect(popoverSide(above, bar.height, bounds)).toBe('top')
    const below = placeToolbar({ left: 400, top: 120, right: 500, bottom: 150 }, bar, bounds)!
    expect(popoverSide(below, bar.height, bounds)).toBe('bottom')
    // Pinned over a selection that fills the view: toward the roomier side.
    expect(popoverSide({ x: 0, y: 108, side: 'inside' }, bar.height, bounds)).toBe('bottom')
    expect(popoverSide({ x: 0, y: 700, side: 'inside' }, bar.height, bounds)).toBe('top')
  })

  it('tells whether a popover fits past the selection (else it opens by its button)', () => {
    const screen = { top: 8, bottom: 382 }
    // A phone held sideways: a 3-line text under its toolbar leaves 177px neither above nor below.
    expect(fitsAboveOrBelow({ top: 126, bottom: 253 }, 177 + 8, screen)).toBe(false)
    expect(fitsAboveOrBelow({ top: 126, bottom: 253 }, 75 + 8, screen)).toBe(true)
    // Room on one side is enough; exactly to the edge still fits.
    expect(fitsAboveOrBelow({ top: 300, bottom: 360 }, 292, screen)).toBe(true)
    expect(fitsAboveOrBelow({ top: 20, bottom: 197 }, 185, screen)).toBe(true)
    expect(fitsAboveOrBelow({ top: 20, bottom: 198 }, 185, screen)).toBe(false)
  })

  it('intersects boxes', () => {
    expect(intersectBoxes(bounds, { left: 50, top: 0, right: 2000, bottom: 600 })).toEqual({ left: 50, top: 100, right: 1000, bottom: 600 })
  })
})
