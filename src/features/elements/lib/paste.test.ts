import { describe, expect, it } from 'vitest'
import { nextPasteIndex, pasteDelta } from './paste'

const page = { width: 600, height: 800 }
const bounds = { x: 100, y: 200, width: 50, height: 20 }

describe('pasteDelta', () => {
  it('pastes in place on the same page, then cascades', () => {
    expect(pasteDelta(bounds, { samePage: true, index: 0, center: null, page })).toEqual({ x: 0, y: 0 })
    expect(pasteDelta(bounds, { samePage: true, index: 1, center: null, page })).toEqual({ x: 12, y: 12 })
    expect(pasteDelta(bounds, { samePage: true, index: 3, center: null, page })).toEqual({ x: 36, y: 36 })
  })

  it('centers on another page, then cascades', () => {
    const center = { x: 300, y: 400 }
    expect(pasteDelta(bounds, { samePage: false, index: 0, center, page })).toEqual({ x: 175, y: 190 })
    expect(pasteDelta(bounds, { samePage: false, index: 1, center, page })).toEqual({ x: 187, y: 202 })
  })

  it('keeps the group inside the page', () => {
    const nearEdge = { x: 560, y: 790, width: 30, height: 10 }
    expect(pasteDelta(nearEdge, { samePage: true, index: 2, center: null, page })).toEqual({ x: 10, y: 0 })
    const center = { x: 5, y: 5 }
    expect(pasteDelta(bounds, { samePage: false, index: 0, center, page: { width: 600, height: 800 } })).toEqual({ x: -100, y: -200 })
  })

  it('uses a smaller page’s size', () => {
    expect(pasteDelta(bounds, { samePage: false, index: 0, center: { x: 300, y: 400 }, page: { width: 120, height: 100 } })).toEqual({ x: -30, y: -120 })
  })
})

describe('nextPasteIndex', () => {
  it('cascades on the same page and restarts elsewhere', () => {
    expect(nextPasteIndex(null, 2)).toBe(0)
    expect(nextPasteIndex({ page: 2, index: 0 }, 2)).toBe(1)
    expect(nextPasteIndex({ page: 2, index: 4 }, 3)).toBe(0)
  })
})
