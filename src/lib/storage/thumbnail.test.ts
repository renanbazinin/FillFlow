import { describe, expect, it } from 'vitest'
import { THUMBNAIL_WIDTH, thumbnailSize, thumbnailWidth } from './thumbnail'

describe('thumbnailWidth', () => {
  it('is sharper on HiDPI screens, within limits', () => {
    expect(thumbnailWidth(1)).toBe(THUMBNAIL_WIDTH)
    expect(thumbnailWidth(0.5)).toBe(THUMBNAIL_WIDTH)
    expect(thumbnailWidth(1.25)).toBe(350)
    expect(thumbnailWidth(2)).toBe(420)
    expect(thumbnailWidth(3)).toBe(420)
    expect(thumbnailWidth(Number.NaN)).toBe(THUMBNAIL_WIDTH)
  })
})

describe('thumbnailSize', () => {
  it('fits the width of portrait and landscape pages', () => {
    expect(thumbnailSize(595.28, 841.89)).toMatchObject({ width: 280, height: 396 })
    expect(thumbnailSize(841.89, 595.28)).toMatchObject({ width: 280, height: 198 })
    expect(thumbnailSize(612, 792, 420)).toMatchObject({ width: 420, height: 544 })
  })

  it('caps very tall pages', () => {
    const s = thumbnailSize(200, 4000)
    expect(s.height).toBe(560)
    expect(s.width).toBe(28)
    expect(s.scale).toBeCloseTo(0.14)
  })

  it('never returns an empty canvas', () => {
    expect(thumbnailSize(10_000, 1)).toMatchObject({ width: 280, height: 1 })
  })
})
