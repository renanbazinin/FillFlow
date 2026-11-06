import { describe, expect, it } from 'vitest'
import type { ImageElement, InkElement, MarkElement, ShapeElement } from '../../../model/types'
import { resizeElementPatch, sizeReadout } from './resize'

const page = { width: 600, height: 800 }
const line: ShapeElement = {
  id: 'l',
  kind: 'shape',
  page: 0,
  x: 100,
  y: 100,
  width: 100,
  height: 0,
  shape: 'line',
  strokeColor: '#000000',
  fillColor: null,
  strokeWidth: 2,
  opacity: 1,
  flip: false,
}
const rect: ShapeElement = { ...line, id: 'r', shape: 'rect', width: 100, height: 50, flip: undefined }
const mark: MarkElement = { id: 'm', kind: 'mark', page: 0, x: 100, y: 100, width: 14, height: 14, shape: 'check', color: '#000000' }
const image: ImageElement = { id: 'i', kind: 'image', page: 0, x: 100, y: 100, width: 150, height: 50, role: 'signature', assetId: 'a', opacity: 1 }

describe('resizeElementPatch', () => {
  it('moves one line endpoint and recomputes box + flip', () => {
    // Drag the end (200,100) up to (200,40): the line now rises → flip.
    expect(resizeElementPatch(line, 'p1', { x: 0, y: -60 }, false, page)).toEqual({ x: 100, y: 40, width: 100, height: 60, flip: true })
    // Drag the start past the end: still a valid (descending) line.
    expect(resizeElementPatch(line, 'p0', { x: 150, y: 20 }, false, page)).toEqual({ x: 200, y: 100, width: 50, height: 20, flip: false })
  })

  it('snaps line endpoints to 45° with Shift and keeps them on the page', () => {
    expect(resizeElementPatch(line, 'p1', { x: 10, y: 8 }, true, page)).toEqual({ x: 100, y: 100, width: 110, height: 0, flip: false })
    const diag = resizeElementPatch(line, 'p1', { x: 0, y: 95 }, true, page)
    expect(diag.width).toBeCloseTo(diag.height!)
    const off = resizeElementPatch(line, 'p0', { x: -500, y: 0 }, false, page)
    expect(off.x).toBe(0)
  })

  it('keeps marks square and images at their aspect ratio', () => {
    const m = resizeElementPatch(mark, 'se', { x: 20, y: 2 }, false, page)
    expect(m.width).toBeCloseTo(m.height!)
    const i = resizeElementPatch(image, 'nw', { x: -30, y: 0 }, false, page)
    expect(i.width! / i.height!).toBeCloseTo(3)
    expect(i.x! + i.width!).toBeCloseTo(250)
    expect(i.y! + i.height!).toBeCloseTo(150)
  })

  it('resizes free shapes per axis, or proportionally with Shift', () => {
    expect(resizeElementPatch(rect, 'e', { x: 40, y: 0 }, false, page)).toEqual({ x: 100, y: 100, width: 140, height: 50 })
    const r = resizeElementPatch(rect, 'se', { x: 100, y: 0 }, true, page)
    expect(r.width! / r.height!).toBeCloseTo(2)
  })
})

describe('sizeReadout', () => {
  it('describes sizes, font sizes and lines', () => {
    expect(sizeReadout(rect)).toBe('100 × 50 pt')
    expect(sizeReadout({ ...line, width: 30, height: 40, flip: true })).toBe('50 pt · 53°')
    expect(sizeReadout(line)).toBe('100 pt · 0°')
    const ink: InkElement = { id: 'k', kind: 'ink', page: 0, x: 0, y: 0, width: 12.4, height: 8.6, strokes: [], color: '#000', strokeWidth: 2 }
    expect(sizeReadout(ink)).toBe('12 × 9 pt')
  })
})
