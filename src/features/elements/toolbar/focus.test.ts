import { describe, expect, it } from 'vitest'
import { toolbarFocusIndex } from './focus'

describe('the selection toolbar’s arrow keys', () => {
  it('go along the row the way it reads, round from one end to the other', () => {
    expect(toolbarFocusIndex('ArrowRight', 0, 4, 'ltr')).toBe(1)
    expect(toolbarFocusIndex('ArrowLeft', 0, 4, 'ltr')).toBe(3)
    expect(toolbarFocusIndex('ArrowRight', 3, 4, 'ltr')).toBe(0)
  })

  it('right to left, take ArrowLeft to the next control: the one on its left', () => {
    expect(toolbarFocusIndex('ArrowLeft', 0, 4, 'rtl')).toBe(1)
    expect(toolbarFocusIndex('ArrowLeft', 3, 4, 'rtl')).toBe(0)
    expect(toolbarFocusIndex('ArrowRight', 1, 4, 'rtl')).toBe(0)
    expect(toolbarFocusIndex('ArrowRight', 0, 4, 'rtl')).toBe(3)
  })

  it('go to the first and the last control with Home and End, either way', () => {
    for (const dir of ['ltr', 'rtl'] as const) {
      expect(toolbarFocusIndex('Home', 2, 4, dir)).toBe(0)
      expect(toolbarFocusIndex('End', 1, 4, dir)).toBe(3)
    }
  })
})
