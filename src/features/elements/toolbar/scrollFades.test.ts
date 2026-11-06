import { describe, expect, it } from 'vitest'
import { fadeMask, scrollEdges } from './scrollFades'

// A strip 200px wide showing 500px of controls.
const WIDTH = 200
const CONTENT = 500

describe('the toolbar strip’s edge fades', () => {
  it('show where it scrolls further, left to right', () => {
    expect(scrollEdges(0, WIDTH, CONTENT)).toEqual({ start: false, end: true })
    expect(scrollEdges(150, WIDTH, CONTENT)).toEqual({ start: true, end: true })
    expect(scrollEdges(300, WIDTH, CONTENT)).toEqual({ start: true, end: false })
    expect(scrollEdges(0, WIDTH, WIDTH)).toEqual({ start: false, end: false })
  })

  it('right to left, go by how far it is from its start (scrollLeft is 0 there, negative toward the end)', () => {
    expect(scrollEdges(-0, WIDTH, CONTENT)).toEqual({ start: false, end: true })
    expect(scrollEdges(-150, WIDTH, CONTENT)).toEqual({ start: true, end: true })
    expect(scrollEdges(-300, WIDTH, CONTENT)).toEqual({ start: true, end: false })
  })

  it('fade the start at the left, or at the right in a right-to-left interface', () => {
    const atStart = { start: false, end: true }
    expect(fadeMask(atStart, 'ltr')).toBe('linear-gradient(to right, #000 0, #000 calc(100% - 40px), transparent 100%)')
    // Right to left the end is on the left: the gradient runs from the right.
    expect(fadeMask(atStart, 'rtl')).toBe('linear-gradient(to left, #000 0, #000 calc(100% - 40px), transparent 100%)')
    expect(fadeMask({ start: true, end: false }, 'rtl')).toBe('linear-gradient(to left, transparent 0, #000 40px, #000 100%)')
    expect(fadeMask({ start: false, end: false }, 'rtl')).toBeUndefined()
  })
})
