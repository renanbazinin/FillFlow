import { describe, expect, it } from 'vitest'
import { defaultBoxRect, defaultLine, dragBox, dragLine, imageRect, markRect, textOrigin } from './placement'

const page = { width: 600, height: 800 }

describe('placement', () => {
  it('centers the first text line on the click and keeps the box on the page', () => {
    expect(textOrigin({ x: 100, y: 100 }, 10, 6, page)).toEqual({ x: 100, y: 94 })
    expect(textOrigin({ x: 598, y: 2 }, 10, 6, page)).toEqual({ x: 594, y: 0 })
  })

  it('centers marks and images on the click', () => {
    expect(markRect({ x: 50, y: 60 }, 14, page)).toEqual({ x: 43, y: 53, width: 14, height: 14 })
    expect(markRect({ x: 2, y: 799 }, 14, page)).toEqual({ x: 0, y: 786, width: 14, height: 14 })
    const sig = imageRect({ x: 300, y: 400 }, 'signature', 3, page)
    expect(sig).toEqual({ x: 225, y: 375, width: 150, height: 50 })
  })

  it('caps the default height of tall or narrow signatures, initials and images', () => {
    const a4 = { width: 595.28, height: 841.89 }
    // Typed initials "J" (tall glyph) and a short signature ("Jo").
    expect(imageRect({ x: 300, y: 400 }, 'initials', 0.5, a4)).toMatchObject({ width: 20, height: 40 })
    expect(imageRect({ x: 300, y: 400 }, 'signature', 1.2, a4)).toMatchObject({ width: 72, height: 60 })
    expect(imageRect({ x: 300, y: 400 }, 'image', 0.5, a4)).toMatchObject({ width: 120, height: 240 })
    // Wide content keeps the default width.
    expect(imageRect({ x: 300, y: 400 }, 'initials', 2, a4)).toMatchObject({ width: 60, height: 30 })
    // A single vertical stroke stays grabbable.
    const stroke = imageRect({ x: 300, y: 400 }, 'initials', 0.05, a4)
    expect(stroke.width).toBe(4)
    expect(stroke.height).toBeCloseTo(80)
  })

  it('shrinks images that would not fit a small page', () => {
    const r = imageRect({ x: 50, y: 50 }, 'image', 1, { width: 100, height: 100 })
    expect(r.width).toBeCloseTo(90)
    expect(r.height).toBeCloseTo(90)
    const tall = imageRect({ x: 50, y: 50 }, 'image', 0.25, { width: 600, height: 100 })
    expect(tall.height).toBeCloseTo(90)
    expect(tall.width).toBeCloseTo(22.5)
  })

  it('makes default shapes for plain clicks', () => {
    expect(defaultBoxRect('rect', { x: 300, y: 300 }, page)).toEqual({ x: 240, y: 270, width: 120, height: 60 })
    expect(defaultBoxRect('highlight', { x: 10, y: 10 }, page)).toEqual({ x: 0, y: 2, width: 160, height: 16 })
    expect(defaultBoxRect('whiteout', { x: 300, y: 300 }, page)).toEqual({ x: 240, y: 288, width: 120, height: 24 })
    expect(defaultLine({ x: 300, y: 50 }, page)).toEqual([
      { x: 240, y: 50 },
      { x: 360, y: 50 },
    ])
    expect(defaultLine({ x: 10, y: 50 }, page)[0]).toEqual({ x: 0, y: 50 })
  })

  it('draws boxes from drags (any direction, Shift = square)', () => {
    expect(dragBox('rect', { x: 100, y: 100 }, { x: 50, y: 160 }, false, page)).toEqual({ x: 50, y: 100, width: 50, height: 60 })
    expect(dragBox('ellipse', { x: 100, y: 100 }, { x: 150, y: 120 }, true, page)).toEqual({ x: 100, y: 100, width: 50, height: 50 })
    expect(dragBox('rect', { x: 100, y: 100 }, { x: 900, y: 120 }, false, page)).toEqual({ x: 100, y: 100, width: 500, height: 20 })
    // Square limited by the page edge.
    expect(dragBox('rect', { x: 580, y: 100 }, { x: 640, y: 200 }, true, page)).toEqual({ x: 580, y: 100, width: 20, height: 20 })
  })

  it('gives flat highlight drags a readable height and enforces a minimum size', () => {
    expect(dragBox('highlight', { x: 100, y: 200 }, { x: 260, y: 202 }, false, page)).toEqual({ x: 100, y: 193, width: 160, height: 16 })
    const tiny = dragBox('rect', { x: 100, y: 100 }, { x: 101, y: 160 }, false, page)
    expect(tiny.width).toBe(4)
    expect(tiny.x).toBeCloseTo(98.5)
  })

  it('draws lines with optional 45° snapping', () => {
    expect(dragLine({ x: 10, y: 10 }, { x: 100, y: 15 }, true, page)).toEqual([
      { x: 10, y: 10 },
      { x: 100, y: 10 },
    ])
    expect(dragLine({ x: 10, y: 10 }, { x: 700, y: 15 }, false, page)[1]).toEqual({ x: 600, y: 15 })
  })
})
