import { describe, expect, it } from 'vitest'
import type { Element, ShapeElement, TextElement } from '../../../model/types'
import type { TextMeasurer } from '../../../lib/text/layout'
import {
  clampDelta,
  elementsInMarquee,
  handlePoint,
  lineEndpoints,
  lineFromEndpoints,
  moveBounds,
  resizeRect,
  resizeTextElement,
  snapAngle45,
  topmostAt,
} from './geometry'

const page = { width: 600, height: 800 }
const box = { x: 100, y: 100, width: 200, height: 100 }

describe('resizeRect (free)', () => {
  it('moves only the dragged edges', () => {
    expect(resizeRect(box, 'se', { x: 20, y: 10 }, { keepAspect: false, min: 4, page })).toEqual({ x: 100, y: 100, width: 220, height: 110 })
    expect(resizeRect(box, 'nw', { x: 20, y: 10 }, { keepAspect: false, min: 4, page })).toEqual({ x: 120, y: 110, width: 180, height: 90 })
    expect(resizeRect(box, 'e', { x: -50, y: 999 }, { keepAspect: false, min: 4, page })).toEqual({ x: 100, y: 100, width: 150, height: 100 })
    expect(resizeRect(box, 'n', { x: 999, y: -30 }, { keepAspect: false, min: 4, page })).toEqual({ x: 100, y: 70, width: 200, height: 130 })
  })

  it('enforces the minimum size without flipping', () => {
    const r = resizeRect(box, 'w', { x: 500, y: 0 }, { keepAspect: false, min: 4, page })
    expect(r).toEqual({ x: 296, y: 100, width: 4, height: 100 })
    const s = resizeRect(box, 'se', { x: -999, y: -999 }, { keepAspect: false, min: 4, page })
    expect(s).toEqual({ x: 100, y: 100, width: 4, height: 4 })
  })

  it('stays inside the page', () => {
    expect(resizeRect(box, 'se', { x: 1000, y: 1000 }, { keepAspect: false, min: 4, page })).toEqual({ x: 100, y: 100, width: 500, height: 700 })
    expect(resizeRect(box, 'nw', { x: -1000, y: -1000 }, { keepAspect: false, min: 4, page })).toEqual({ x: 0, y: 0, width: 300, height: 200 })
  })
})

describe('resizeRect (aspect)', () => {
  it('anchors the opposite corner and keeps the ratio', () => {
    const r = resizeRect(box, 'se', { x: 100, y: 50 }, { keepAspect: true, min: 4, page })
    expect(r.x).toBe(100)
    expect(r.y).toBe(100)
    expect(r.width).toBeCloseTo(300)
    expect(r.height).toBeCloseTo(150)

    const nw = resizeRect(box, 'nw', { x: 100, y: 50 }, { keepAspect: true, min: 4, page })
    expect(nw.x + nw.width).toBeCloseTo(300)
    expect(nw.y + nw.height).toBeCloseTo(200)
    expect(nw.width / nw.height).toBeCloseTo(2)
    expect(nw.width).toBeCloseTo(100)
  })

  it('projects off-diagonal drags onto the diagonal', () => {
    // Pure horizontal drag of 100pt on a 2:1 box: projection = (100*200) / (200² + 100²) = 0.4.
    const r = resizeRect(box, 'ne', { x: 100, y: 0 }, { keepAspect: true, min: 4, page })
    expect(r.width).toBeCloseTo(280)
    expect(r.height).toBeCloseTo(140)
    // The bottom-left corner is the anchor.
    expect(r.x).toBe(100)
    expect(r.y + r.height).toBeCloseTo(200)
  })

  it('respects page bounds and the factor limits', () => {
    const r = resizeRect(box, 'se', { x: 2000, y: 2000 }, { keepAspect: true, min: 4, page })
    // Width can grow to 500 (page edge), height to 700 → width limits: factor 2.5.
    expect(r.width).toBeCloseTo(500)
    expect(r.height).toBeCloseTo(250)
    const capped = resizeRect(box, 'se', { x: 2000, y: 2000 }, { keepAspect: true, min: 4, page, maxFactor: 1.5 })
    expect(capped.width).toBeCloseTo(300)
    const floored = resizeRect(box, 'se', { x: -2000, y: -2000 }, { keepAspect: true, min: 4, page, minFactor: 0.5 })
    expect(floored.width).toBeCloseTo(100)
    expect(floored.height).toBeCloseTo(50)
  })

  it('scales from a side handle with the other axis centered', () => {
    const r = resizeRect(box, 'e', { x: 100, y: 0 }, { keepAspect: true, min: 4, page })
    expect(r.x).toBe(100)
    expect(r.width).toBeCloseTo(300)
    expect(r.height).toBeCloseTo(150)
    expect(r.y + r.height / 2).toBeCloseTo(150)
  })
})

describe('resizeTextElement', () => {
  // Every character is half an em wide.
  const measure: TextMeasurer = (text, _f, _b, size) => text.length * size * 0.5
  const text: TextElement = {
    id: 't',
    kind: 'text',
    page: 0,
    x: 100,
    y: 100,
    width: 60,
    height: 12 * 1.2,
    text: 'abcdefghij',
    fontId: 'sans',
    bold: false,
    fontSize: 12,
    color: '#000000',
    align: 'left',
    lineHeight: 1.2,
    letterSpacing: 0,
  }

  it('scales the font size proportionally and anchors the opposite corner', () => {
    const p = resizeTextElement(text, 'se', { x: 60, y: 14.4 }, page, measure)
    expect(p.fontSize).toBeCloseTo(24)
    expect(p.width).toBeCloseTo(120)
    expect(p.height).toBeCloseTo(28.8)
    expect(p.x).toBe(100)
    expect(p.y).toBe(100)

    const nw = resizeTextElement(text, 'nw', { x: 30, y: 7.2 }, page, measure)
    expect(nw.fontSize).toBeCloseTo(6)
    expect(nw.x + nw.width).toBeCloseTo(160)
    expect(nw.y + nw.height).toBeCloseTo(100 + 14.4)
  })

  it('clamps to the font size limits', () => {
    const tiny = resizeTextElement(text, 'se', { x: -1000, y: -1000 }, page, measure)
    expect(tiny.fontSize).toBe(4)
    const big = resizeTextElement({ ...text, x: 0, y: 0 }, 'se', { x: 100000, y: 100000 }, { width: 100000, height: 100000 }, measure)
    expect(big.fontSize).toBe(144)
  })

  it('scales letter spacing with the font', () => {
    const spaced = { ...text, letterSpacing: 2, width: 80 }
    const p = resizeTextElement(spaced, 'se', { x: 80, y: 14.4 }, page, measure)
    expect(p.fontSize).toBeCloseTo(24)
    expect(p.letterSpacing).toBeCloseTo(4)
  })
})

describe('lines', () => {
  it('converts between endpoints and box + flip', () => {
    expect(lineFromEndpoints({ x: 10, y: 10 }, { x: 50, y: 30 })).toEqual({ x: 10, y: 10, width: 40, height: 20, flip: false })
    expect(lineFromEndpoints({ x: 50, y: 30 }, { x: 10, y: 10 })).toEqual({ x: 10, y: 10, width: 40, height: 20, flip: false })
    expect(lineFromEndpoints({ x: 10, y: 30 }, { x: 50, y: 10 })).toEqual({ x: 10, y: 10, width: 40, height: 20, flip: true })
    expect(lineFromEndpoints({ x: 50, y: 10 }, { x: 10, y: 30 })).toEqual({ x: 10, y: 10, width: 40, height: 20, flip: true })
    const flipped = { x: 10, y: 10, width: 40, height: 20, flip: true }
    expect(lineEndpoints(flipped)).toEqual([
      { x: 10, y: 30 },
      { x: 50, y: 10 },
    ])
    const [a, b] = lineEndpoints(flipped)
    expect(lineFromEndpoints(a, b)).toEqual(flipped)
  })

  it('treats horizontal and vertical lines as unflipped', () => {
    expect(lineFromEndpoints({ x: 50, y: 10 }, { x: 10, y: 10 })).toEqual({ x: 10, y: 10, width: 40, height: 0, flip: false })
    expect(lineFromEndpoints({ x: 5, y: 40 }, { x: 5, y: 0 })).toEqual({ x: 5, y: 0, width: 0, height: 40, flip: false })
  })

  it('snaps to 45° steps', () => {
    const o = { x: 100, y: 100 }
    expect(snapAngle45(o, { x: 200, y: 110 })).toEqual({ x: 200, y: 100 })
    expect(snapAngle45(o, { x: 95, y: 20 })).toEqual({ x: 100, y: 20 })
    expect(snapAngle45(o, { x: 150, y: 160 })).toEqual({ x: 155, y: 155 })
    expect(snapAngle45(o, { x: 40, y: 150 })).toEqual({ x: 45, y: 155 })
    expect(snapAngle45(o, { x: 10, y: 95 })).toEqual({ x: 10, y: 100 })
  })

  it('keeps snapped diagonals inside the bounds', () => {
    const p = snapAngle45({ x: 100, y: 100 }, { x: 300, y: 290 }, { width: 150, height: 1000 })
    expect(p).toEqual({ x: 150, y: 150 })
  })
})

describe('moving', () => {
  it('limits a group delta so every item stays inside its page', () => {
    const b = moveBounds([
      { rect: { x: 10, y: 20, width: 50, height: 50 }, page },
      { rect: { x: 500, y: 700, width: 50, height: 50 }, page },
    ])
    expect(b).toEqual({ minX: -10, maxX: 50, minY: -20, maxY: 50 })
    expect(clampDelta({ x: -100, y: 100 }, b)).toEqual({ x: -10, y: 50 })
  })

  it('lets items that already stick out stay put', () => {
    const b = moveBounds([{ rect: { x: 580, y: 10, width: 50, height: 20 }, page }])
    expect(b.maxX).toBe(0)
    expect(clampDelta({ x: 30, y: 0 }, b)).toEqual({ x: 0, y: 0 })
  })
})

describe('hit testing', () => {
  const line: ShapeElement = {
    id: 'line',
    kind: 'shape',
    page: 0,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    shape: 'line',
    strokeColor: '#000',
    fillColor: null,
    strokeWidth: 2,
    opacity: 1,
    flip: false,
  }
  const mark: Element = { id: 'mark', kind: 'mark', page: 0, x: 200, y: 200, width: 14, height: 14, shape: 'check', color: '#000' }

  it('selects elements a marquee touches; lines need their segment inside', () => {
    expect(elementsInMarquee([line, mark], { x: 190, y: 190, width: 15, height: 15 })).toEqual(['mark'])
    // Corner of the line's box, away from the diagonal.
    expect(elementsInMarquee([line], { x: 70, y: 0, width: 30, height: 20 })).toEqual([])
    expect(elementsInMarquee([line], { x: 40, y: 40, width: 10, height: 10 })).toEqual(['line'])
  })

  it('finds the topmost element under a point', () => {
    const under: Element = { ...mark, id: 'under' }
    expect(topmostAt([under, mark], { x: 205, y: 205 })?.id).toBe('mark')
    expect(topmostAt([under, mark], { x: 205, y: 205 }, (e) => e.id !== 'mark')?.id).toBe('under')
    expect(topmostAt([line], { x: 50, y: 51 })?.id).toBe('line')
    expect(topmostAt([line], { x: 80, y: 20 })).toBeNull()
  })

  it('places handles on the box', () => {
    expect(handlePoint(box, 'nw')).toEqual({ x: 100, y: 100 })
    expect(handlePoint(box, 'e')).toEqual({ x: 300, y: 150 })
    expect(handlePoint(box, 's')).toEqual({ x: 200, y: 200 })
  })
})
