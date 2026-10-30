import { describe, expect, it } from 'vitest'
import {
  computeBackgroundMap,
  estimateWhitePoint,
  findContentBounds,
  fitWithin,
  hasTransparency,
  MAX_WHITE_POINT,
  padBox,
  padBoxPx,
  rasterOutputSize,
  removeBackground,
  smoothstep,
  vectorOutputSize,
  type PixelBuffer,
} from './imageUtils'

type RGBA = [number, number, number, number]

function image(width: number, height: number, fill: (x: number, y: number) => RGBA): PixelBuffer {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data.set(fill(x, y), (y * width + x) * 4)
  }
  return { data, width, height }
}

function px(img: PixelBuffer, x: number, y: number): RGBA {
  const i = (y * img.width + x) * 4
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]]
}

const CLEAR: RGBA = [0, 0, 0, 0]
const WHITE: RGBA = [255, 255, 255, 255]
const BLACK: RGBA = [0, 0, 0, 255]

/** Inside the rectangle [x1, x2) × [y1, y2)? */
const inRect = (x: number, y: number, x1: number, y1: number, x2: number, y2: number) => x >= x1 && x < x2 && y >= y1 && y < y2

describe('findContentBounds', () => {
  it('returns null for an empty image', () => {
    expect(findContentBounds(image(10, 6, () => CLEAR))).toBeNull()
  })

  it('finds a single pixel', () => {
    const img = image(10, 6, (x, y) => (x === 7 && y === 2 ? BLACK : CLEAR))
    expect(findContentBounds(img)).toEqual({ x: 7, y: 2, width: 1, height: 1 })
  })

  it('spans scattered pixels', () => {
    const dots = new Set(['1,4', '8,1', '5,5', '3,0'])
    const img = image(12, 8, (x, y) => (dots.has(`${x},${y}`) ? BLACK : CLEAR))
    expect(findContentBounds(img)).toEqual({ x: 1, y: 0, width: 8, height: 6 })
  })

  it('ignores nearly transparent pixels below the alpha threshold', () => {
    const img = image(6, 6, (x, y) => (x === 1 && y === 1 ? [0, 0, 0, 5] : x === 4 && y === 3 ? [0, 0, 0, 200] : CLEAR))
    expect(findContentBounds(img)).toEqual({ x: 4, y: 3, width: 1, height: 1 })
    expect(findContentBounds(img, 0)).toEqual({ x: 1, y: 1, width: 4, height: 3 })
  })

  it('covers the full image when everything is opaque', () => {
    expect(findContentBounds(image(5, 3, () => WHITE))).toEqual({ x: 0, y: 0, width: 5, height: 3 })
  })
})

describe('padding and sizing', () => {
  it('pads by a ratio of the longer side on every side', () => {
    expect(padBox({ x: 10, y: 20, width: 100, height: 40 }, 0.04)).toEqual({ x: 6, y: 16, width: 108, height: 48 })
    expect(padBoxPx({ x: 10, y: 20, width: 101, height: 40 }, 0.04)).toEqual({ x: 5, y: 15, width: 111, height: 50 })
  })

  it('fitWithin only ever scales down', () => {
    expect(fitWithin(4000, 3000, 2000)).toEqual({ width: 2000, height: 1500, scale: 0.5 })
    expect(fitWithin(3000, 4000, 2000)).toEqual({ width: 1500, height: 2000, scale: 0.5 })
    expect(fitWithin(800, 600, 2000)).toEqual({ width: 800, height: 600, scale: 1 })
  })

  it('vector output targets a width but caps the long side', () => {
    // A wide signature hits the target width exactly.
    const wide = vectorOutputSize(500, 150, { targetWidth: 1000, maxLong: 1600 })
    expect(wide).toEqual({ width: 1000, height: 300, scale: 2 })
    // A tall drawing would exceed the long-side cap, so the height wins.
    const tall = vectorOutputSize(100, 400, { targetWidth: 480, maxLong: 1600 })
    expect(tall.height).toBe(1600)
    expect(tall.width).toBe(400)
  })

  it('signature output is at least 4× its default physical size', () => {
    // 150 pt default width → at least 600 px; initials 60 pt → 240 px.
    expect(vectorOutputSize(37, 12, { targetWidth: 1000, maxLong: 1600 }).width).toBeGreaterThanOrEqual(600)
    expect(vectorOutputSize(20, 15, { targetWidth: 480, maxLong: 1600 }).width).toBeGreaterThanOrEqual(240)
  })

  it('raster output keeps native size, upscales small sources and caps large ones', () => {
    expect(rasterOutputSize(900, 300, { minWidth: 600, maxLong: 1600 })).toEqual({ width: 900, height: 300, scale: 1 })
    expect(rasterOutputSize(300, 100, { minWidth: 600, maxLong: 1600 })).toEqual({ width: 600, height: 200, scale: 2 })
    expect(rasterOutputSize(2400, 800, { minWidth: 600, maxLong: 1600 })).toMatchObject({ width: 1600, height: 533 })
    // Upscaling never breaks the long-side cap.
    expect(rasterOutputSize(100, 1000, { minWidth: 600, maxLong: 1600 })).toMatchObject({ width: 160, height: 1600 })
  })

  it('never returns a zero size', () => {
    expect(fitWithin(1, 1, 0.1)).toMatchObject({ width: 1, height: 1 })
    expect(vectorOutputSize(0, 0, { targetWidth: 100, maxLong: 100 })).toMatchObject({ width: 1, height: 1 })
  })
})

describe('hasTransparency', () => {
  it('detects any non-opaque pixel', () => {
    expect(hasTransparency(image(4, 4, () => WHITE))).toBe(false)
    expect(hasTransparency(image(4, 4, (x, y) => (x === 3 && y === 3 ? [255, 255, 255, 254] : WHITE)))).toBe(true)
  })
})

describe('smoothstep', () => {
  it('clamps and eases', () => {
    expect(smoothstep(0, 1, -1)).toBe(0)
    expect(smoothstep(0, 1, 2)).toBe(1)
    expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5)
    expect(smoothstep(0.1, 0.5, 0.2)).toBeLessThan(0.25)
  })
})

describe('removeBackground', () => {
  it('turns white paper transparent and keeps black ink opaque black', () => {
    const img = image(20, 10, (x, y) => (inRect(x, y, 5, 3, 15, 7) ? BLACK : WHITE))
    removeBackground(img, { whitePoint: 230 })
    expect(px(img, 0, 0)[3]).toBe(0)
    expect(px(img, 19, 9)[3]).toBe(0)
    expect(px(img, 10, 5)).toEqual(BLACK)
    expect(findContentBounds(img)).toEqual({ x: 5, y: 3, width: 10, height: 4 })
  })

  it('keeps the hue of colored ink', () => {
    const img = image(4, 4, (x) => (x < 2 ? [40, 60, 170, 255] : WHITE))
    removeBackground(img, { whitePoint: 230 })
    const [r, g, b, a] = px(img, 0, 0)
    expect(a).toBe(255)
    expect(b).toBeGreaterThan(r + 80)
    expect(b).toBeGreaterThan(g + 80)
    expect(px(img, 3, 0)[3]).toBe(0)
  })

  it('gives anti-aliased edges partial alpha', () => {
    const img = image(3, 1, (x) => (x === 0 ? BLACK : x === 1 ? [200, 200, 200, 255] : WHITE))
    removeBackground(img, { whitePoint: 240 })
    const edge = px(img, 1, 0)[3]
    expect(edge).toBeGreaterThan(0)
    expect(edge).toBeLessThan(255)
  })

  it('preserves existing transparency', () => {
    const img = image(2, 1, (x) => (x === 0 ? CLEAR : [0, 0, 0, 128]))
    removeBackground(img, { whitePoint: 230 })
    expect(px(img, 0, 0)[3]).toBe(0)
    expect(px(img, 1, 0)[3]).toBe(128)
  })

  it('a lower white point removes more (faint marks disappear)', () => {
    const faint: RGBA = [170, 170, 170, 255]
    const a = image(2, 1, (x) => (x === 0 ? faint : WHITE))
    const b = image(2, 1, (x) => (x === 0 ? faint : WHITE))
    removeBackground(a, { whitePoint: 240 })
    removeBackground(b, { whitePoint: 175 })
    expect(px(a, 0, 0)[3]).toBeGreaterThan(px(b, 0, 0)[3])
    expect(px(b, 0, 0)[3]).toBe(0)
  })

  it('handles unevenly lit grey paper with a background map', () => {
    // Paper brightness falls from 235 (left) to 150 (right): a photo with a shadow.
    const W = 96
    const H = 48
    const paper = (x: number) => Math.round(235 - (85 * x) / (W - 1))
    const isInk = (x: number, y: number) => y >= 22 && y < 26 && x >= 10 && x < 86
    const img = image(W, H, (x, y) => {
      if (isInk(x, y)) {
        const v = Math.round(paper(x) * 0.25)
        return [v, v, v, 255]
      }
      const p = paper(x)
      return [p, p, p, 255]
    })
    const map = computeBackgroundMap(img, 12)
    const whitePoint = estimateWhitePoint(img, map)
    removeBackground(img, { whitePoint, map })
    let paperLeft = 0
    let inkLost = 0
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const alpha = px(img, x, y)[3]
        if (isInk(x, y)) {
          if (alpha < 250) inkLost++
        } else if (alpha > 10) {
          paperLeft++
        }
      }
    }
    expect(paperLeft).toBe(0)
    expect(inkLost).toBe(0)
    expect(findContentBounds(img)).toEqual({ x: 10, y: 22, width: 76, height: 4 })
  })

  it('without a map, the same shadow would survive (sanity check of the map)', () => {
    const img = image(40, 10, (x) => {
      const p = Math.round(235 - (85 * x) / 39)
      return [p, p, p, 255]
    })
    removeBackground(img, { whitePoint: 225 })
    expect(px(img, 39, 5)[3]).toBeGreaterThan(0)
  })

  it('white-balances a color cast (yellowish paper becomes transparent)', () => {
    const img = image(32, 16, (x, y) => (inRect(x, y, 8, 6, 24, 9) ? [30, 40, 120, 255] : [250, 238, 196, 255]))
    const map = computeBackgroundMap(img, 8)
    removeBackground(img, { whitePoint: estimateWhitePoint(img, map), map })
    expect(px(img, 1, 1)[3]).toBe(0)
    expect(px(img, 30, 14)[3]).toBe(0)
    const [r, , b, a] = px(img, 16, 7)
    expect(a).toBe(255)
    expect(b).toBeGreaterThan(r)
  })
})

describe('computeBackgroundMap', () => {
  it('ignores a cell dominated by ink thanks to dilation', () => {
    // 4×4 cells of 8 px; the cell at (1, 1) is entirely black.
    const img = image(32, 32, (x, y) => (inRect(x, y, 8, 8, 16, 16) ? BLACK : [220, 220, 220, 255]))
    const map = computeBackgroundMap(img, 4)
    expect(map.cols).toBe(4)
    expect(map.rows).toBe(4)
    const cell = (1 * map.cols + 1) * 3
    expect(map.values[cell]).toBeGreaterThan(200)
  })

  it('follows the image aspect ratio', () => {
    const map = computeBackgroundMap(image(64, 16, () => WHITE), 16)
    expect(map.cols).toBe(16)
    expect(map.rows).toBe(4)
  })
})

describe('estimateWhitePoint', () => {
  it('is near the top for clean white paper', () => {
    const img = image(20, 20, (x, y) => (inRect(x, y, 5, 8, 15, 11) ? BLACK : WHITE))
    expect(estimateWhitePoint(img, null)).toBe(MAX_WHITE_POINT)
  })

  it('stays below noisy paper', () => {
    // Deterministic "noise": paper values 225..245.
    const img = image(50, 50, (x, y) => {
      const v = 225 + ((x * 7 + y * 13) % 21)
      return [v, v, v, 255]
    })
    const map = computeBackgroundMap(img, 5)
    const wp = estimateWhitePoint(img, map)
    removeBackground(img, { whitePoint: wp, map })
    expect(findContentBounds(img)).toBeNull()
  })

  it('ignores fully transparent pixels', () => {
    expect(estimateWhitePoint(image(4, 4, () => CLEAR), null)).toBe(MAX_WHITE_POINT)
  })
})
