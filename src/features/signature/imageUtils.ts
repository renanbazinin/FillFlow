/**
 * Pixel helpers for signatures and inserted images. Everything here is a pure function over
 * RGBA buffers laid out like `ImageData` (so it runs in Node tests as well as the browser).
 */

/** Anything shaped like `ImageData`. */
export interface PixelBuffer {
  data: Uint8ClampedArray
  width: number
  height: number
}

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

export interface Size {
  width: number
  height: number
  /** Factor applied to the source size. */
  scale: number
}

/** Rec. 601 luma (0..255). */
export function luminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

// ---------------------------------------------------------------------------
// Content bounds, padding and output sizing.
// ---------------------------------------------------------------------------

/** Tight bounding box of the pixels whose alpha is above `alphaMin`; null when nothing is visible. */
export function findContentBounds(img: PixelBuffer, alphaMin = 8): Box | null {
  const { data, width, height } = img
  const visible = (x: number, y: number) => data[(y * width + x) * 4 + 3] > alphaMin

  let top = -1
  for (let y = 0; y < height && top < 0; y++) {
    for (let x = 0; x < width; x++) {
      if (visible(x, y)) {
        top = y
        break
      }
    }
  }
  if (top < 0) return null

  let bottom = top
  for (let y = height - 1; y > top; y--) {
    let hit = false
    for (let x = 0; x < width; x++) {
      if (visible(x, y)) {
        hit = true
        break
      }
    }
    if (hit) {
      bottom = y
      break
    }
  }

  // Each row only needs scanning up to the extremes found so far.
  let left = width
  let right = -1
  for (let y = top; y <= bottom; y++) {
    for (let x = 0; x < left; x++) {
      if (visible(x, y)) {
        left = x
        break
      }
    }
    for (let x = width - 1; x > right; x--) {
      if (visible(x, y)) {
        right = x
        break
      }
    }
  }
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 }
}

/** Grows a box on every side by `ratio` × its longer side. */
export function padBox(box: Box, ratio: number): Box {
  const p = Math.max(box.width, box.height) * ratio
  return { x: box.x - p, y: box.y - p, width: box.width + 2 * p, height: box.height + 2 * p }
}

/** Integer version of `padBox` for raster crops (the padding is rounded up). */
export function padBoxPx(box: Box, ratio: number): Box {
  const p = Math.ceil(Math.max(box.width, box.height) * ratio)
  return { x: box.x - p, y: box.y - p, width: box.width + 2 * p, height: box.height + 2 * p }
}

function sized(w: number, h: number, scale: number): Size {
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)), scale }
}

/** Downscale-only fit of `w × h` so its long side is at most `maxLong`. */
export function fitWithin(w: number, h: number, maxLong: number): Size {
  return sized(w, h, Math.min(1, maxLong / Math.max(w, h, 1)))
}

/**
 * Size for rendering vector content (strokes, text) of `w × h` units: `targetWidth` pixels
 * wide, unless that would make the long side exceed `maxLong`.
 */
export function vectorOutputSize(w: number, h: number, opts: { targetWidth: number; maxLong: number }): Size {
  let scale = opts.targetWidth / Math.max(w, 1e-6)
  if (Math.max(w, h) * scale > opts.maxLong) scale = opts.maxLong / Math.max(w, h)
  return sized(w, h, scale)
}

/**
 * Size for raster content (photos, scans): keep the native resolution, but upscale to at least
 * `minWidth` and never exceed `maxLong` on the long side.
 */
export function rasterOutputSize(w: number, h: number, opts: { minWidth: number; maxLong: number }): Size {
  let scale = w < opts.minWidth ? opts.minWidth / Math.max(w, 1) : 1
  if (Math.max(w, h) * scale > opts.maxLong) scale = opts.maxLong / Math.max(w, h)
  return sized(w, h, scale)
}

/** True when any pixel is not fully opaque. */
export function hasTransparency(img: PixelBuffer): boolean {
  const { data } = img
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true
  return false
}

// ---------------------------------------------------------------------------
// Background removal ("make the paper transparent").
//
// 1. A coarse per-channel *background map* (a high percentile of each grid cell, dilated so cells
//    dominated by ink take their neighbours' paper level) models uneven lighting and color casts.
// 2. Each pixel is divided by its local background (flat-field + white balance), so paper becomes
//    ~255 everywhere.
// 3. "Color to alpha" against a white point: coverage = how much darker than the white point the
//    darkest channel is; the ink color is un-blended from the paper, and coverage is mapped to
//    alpha with a smooth ramp (faint paper texture → 0, real ink → fully opaque).
// ---------------------------------------------------------------------------

export interface BackgroundMap {
  cols: number
  rows: number
  /** Per cell r, g, b background levels (0..255), row-major. */
  values: Float32Array
}

const BINS = 64
const BIN_SIZE = 256 / BINS

/** Composite channel over white (transparent pixels count as paper). */
function overWhite(c: number, a: number): number {
  return a === 255 ? c : (c * a + 255 * (255 - a)) / 255
}

export function computeBackgroundMap(img: PixelBuffer, cells = 16, percentile = 0.9): BackgroundMap {
  const { data, width, height } = img
  const long = Math.max(width, height, 1)
  const cols = Math.max(1, Math.round((cells * width) / long))
  const rows = Math.max(1, Math.round((cells * height) / long))
  const n = cols * rows
  const hist = new Uint32Array(n * 3 * BINS)
  const counts = new Uint32Array(n)

  for (let y = 0; y < height; y++) {
    const cy = Math.min(rows - 1, Math.floor((y * rows) / height))
    for (let x = 0; x < width; x++) {
      const cx = Math.min(cols - 1, Math.floor((x * cols) / width))
      const cell = cy * cols + cx
      const i = (y * width + x) * 4
      const a = data[i + 3]
      const base = cell * 3 * BINS
      hist[base + Math.min(BINS - 1, Math.floor(overWhite(data[i], a) / BIN_SIZE))]++
      hist[base + BINS + Math.min(BINS - 1, Math.floor(overWhite(data[i + 1], a) / BIN_SIZE))]++
      hist[base + 2 * BINS + Math.min(BINS - 1, Math.floor(overWhite(data[i + 2], a) / BIN_SIZE))]++
      counts[cell]++
    }
  }

  const raw = new Float32Array(n * 3)
  for (let cell = 0; cell < n; cell++) {
    for (let ch = 0; ch < 3; ch++) {
      const base = (cell * 3 + ch) * BINS
      const target = counts[cell] * percentile
      let acc = 0
      let bin = 0
      for (; bin < BINS - 1; bin++) {
        acc += hist[base + bin]
        if (acc >= target) break
      }
      raw[cell * 3 + ch] = counts[cell] ? (bin + 0.5) * BIN_SIZE : 255
    }
  }

  // Dilate (3×3 max): a cell covered by a thick stroke takes the paper level of its neighbours.
  const values = new Float32Array(n * 3)
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      for (let ch = 0; ch < 3; ch++) {
        let m = 0
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const x = cx + dx
            const y = cy + dy
            if (x < 0 || y < 0 || x >= cols || y >= rows) continue
            m = Math.max(m, raw[(y * cols + x) * 3 + ch])
          }
        }
        // Never divide by a near-black "background" (very dark photos).
        values[(cy * cols + cx) * 3 + ch] = Math.max(48, m)
      }
    }
  }
  return { cols, rows, values }
}

/** Precomputed bilinear interpolation weights along one axis (between cell centers). */
function axisWeights(size: number, cells: number) {
  const i0 = new Int32Array(size)
  const i1 = new Int32Array(size)
  const f = new Float32Array(size)
  for (let p = 0; p < size; p++) {
    const u = ((p + 0.5) / size) * cells - 0.5
    const a = Math.max(0, Math.min(cells - 1, Math.floor(u)))
    const b = Math.min(cells - 1, a + 1)
    i0[p] = a
    i1[p] = b
    f[p] = b === a ? 0 : Math.max(0, Math.min(1, u - a))
  }
  return { i0, i1, f }
}

/**
 * Calls `visit(i, r, g, b)` for every pixel with its channels normalized by the local background
 * (paper ≈ 255) and composited over white. Pixels that are fully transparent are skipped.
 */
function forEachNormalized(
  img: PixelBuffer,
  map: BackgroundMap | null,
  visit: (i: number, r: number, g: number, b: number) => void,
) {
  const { data, width, height } = img
  const xs = map ? axisWeights(width, map.cols) : null
  const ys = map ? axisWeights(height, map.rows) : null
  const bg = [255, 255, 255]
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const a = data[i + 3]
      if (a === 0) continue
      if (map && xs && ys) {
        const { cols, values } = map
        const fx = xs.f[x]
        const fy = ys.f[y]
        const c00 = (ys.i0[y] * cols + xs.i0[x]) * 3
        const c10 = (ys.i0[y] * cols + xs.i1[x]) * 3
        const c01 = (ys.i1[y] * cols + xs.i0[x]) * 3
        const c11 = (ys.i1[y] * cols + xs.i1[x]) * 3
        for (let ch = 0; ch < 3; ch++) {
          const top = values[c00 + ch] + (values[c10 + ch] - values[c00 + ch]) * fx
          const bottom = values[c01 + ch] + (values[c11 + ch] - values[c01 + ch]) * fx
          bg[ch] = top + (bottom - top) * fy
        }
      }
      visit(
        i,
        Math.min(255, (overWhite(data[i], a) * 255) / bg[0]),
        Math.min(255, (overWhite(data[i + 1], a) * 255) / bg[1]),
        Math.min(255, (overWhite(data[i + 2], a) * 255) / bg[2]),
      )
    }
  }
}

export const MIN_WHITE_POINT = 140
export const MAX_WHITE_POINT = 245

/**
 * Suggests a white point for `removeBackground`: just below the paper's brightness, past its
 * noise (mode of the normalized luminance histogram minus three standard deviations).
 */
export function estimateWhitePoint(img: PixelBuffer, map: BackgroundMap | null): number {
  const hist = new Float64Array(256)
  let total = 0
  forEachNormalized(img, map, (_i, r, g, b) => {
    hist[Math.min(255, Math.round(luminance(r, g, b)))]++
    total++
  })
  if (!total) return MAX_WHITE_POINT
  let mode = 255
  for (let v = 128; v < 256; v++) if (hist[v] > hist[mode]) mode = v
  let n = 0
  let sum = 0
  for (let v = Math.max(0, mode - 48); v <= Math.min(255, mode + 48); v++) {
    n += hist[v]
    sum += hist[v] * (v - mode) * (v - mode)
  }
  const sigma = n ? Math.sqrt(sum / n) : 0
  return Math.round(Math.min(MAX_WHITE_POINT, Math.max(MIN_WHITE_POINT, mode - 3 * sigma - 8)))
}

export interface RemoveBackgroundOptions {
  /** Normalized brightness (0..255) at or above which a pixel is paper. */
  whitePoint: number
  /** Lighting/color model from `computeBackgroundMap`; null treats the paper as pure white. */
  map?: BackgroundMap | null
  /** Coverage below this is fully transparent (paper texture). */
  low?: number
  /** Coverage above this is fully opaque (solid ink). */
  high?: number
}

/** Makes the paper transparent, in place. See the section comment above. */
export function removeBackground(img: PixelBuffer, opts: RemoveBackgroundOptions): void {
  const { data } = img
  const w = Math.max(1, opts.whitePoint)
  const low = opts.low ?? 0.08
  const high = opts.high ?? 0.45
  forEachNormalized(img, opts.map ?? null, (i, r, g, b) => {
    const dr = (w - r) / w
    const dg = (w - g) / w
    const db = (w - b) / w
    const d = Math.max(dr, dg, db)
    if (d <= low) {
      data[i] = 255
      data[i + 1] = 255
      data[i + 2] = 255
      data[i + 3] = 0
      return
    }
    // Un-blend the ink from the paper: c = d·ink + (1 − d)·w  ⇒  ink = w − w·dc/d.
    data[i] = Math.max(0, Math.min(255, Math.round(w - (w * dr) / d)))
    data[i + 1] = Math.max(0, Math.min(255, Math.round(w - (w * dg) / d)))
    data[i + 2] = Math.max(0, Math.min(255, Math.round(w - (w * db) / d)))
    data[i + 3] = Math.round(smoothstep(low, high, d) * data[i + 3])
  })
}
