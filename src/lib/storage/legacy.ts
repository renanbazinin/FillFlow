import type { Asset } from '../../model/types'

/**
 * FillFlow v1 kept a single drawn signature in localStorage: a PNG data URL of a transparent
 * 600×300 canvas. It is imported into the signature library once, cropped to its ink, so people
 * coming from v1 still find their signature. (v1's annotations were keyed by file name in a
 * different model and are not migrated.)
 */
export const LEGACY_SIGNATURE_KEY = 'saved-signature'
export const LEGACY_IMPORTED_FLAG = 'fillflow:v1-signature-imported'
export const LEGACY_SIGNATURE_ID = 'v1-signature'

export interface InkBox {
  x: number
  y: number
  width: number
  height: number
}

/** Bounding box of the pixels more opaque than `threshold` in RGBA data, or null when blank. */
export function inkBounds(data: Uint8ClampedArray, width: number, height: number, threshold = 8): InkBox | null {
  let x1 = width
  let y1 = height
  let x2 = -1
  let y2 = -1
  for (let y = 0; y < height; y++) {
    const row = y * width * 4
    for (let x = 0; x < width; x++) {
      if (data[row + x * 4 + 3] <= threshold) continue
      if (x < x1) x1 = x
      if (x > x2) x2 = x
      if (y < y1) y1 = y
      if (y > y2) y2 = y
    }
  }
  return x2 < 0 ? null : { x: x1, y: y1, width: x2 - x1 + 1, height: y2 - y1 + 1 }
}

/** Grows a box by `pad` on every side, clamped to the image. */
export function padBox(box: InkBox, pad: number, width: number, height: number): InkBox {
  const x = Math.max(0, box.x - pad)
  const y = Math.max(0, box.y - pad)
  return { x, y, width: Math.min(width, box.x + box.width + pad) - x, height: Math.min(height, box.y + box.height + pad) - y }
}

/** Decodes a PNG data URL and crops it to its ink. Browser only. */
async function cropToInk(dataUrl: string): Promise<Omit<Asset, 'id' | 'mime'> | null> {
  const img = new Image()
  img.src = dataUrl
  await img.decode()
  const src = document.createElement('canvas')
  src.width = img.naturalWidth
  src.height = img.naturalHeight
  const ctx = src.getContext('2d', { willReadFrequently: true })
  if (!ctx || !src.width || !src.height) return null
  ctx.drawImage(img, 0, 0)
  const ink = inkBounds(ctx.getImageData(0, 0, src.width, src.height).data, src.width, src.height)
  if (!ink) return null
  const box = padBox(ink, 6, src.width, src.height)
  const out = document.createElement('canvas')
  out.width = box.width
  out.height = box.height
  out.getContext('2d')?.drawImage(src, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height)
  return { dataUrl: out.toDataURL('image/png'), width: box.width, height: box.height }
}

/**
 * Imports v1's saved signature (once per browser) through `save`. Resolves with whether a
 * signature was imported; never rejects.
 */
export async function importLegacySignature(
  save: (sig: { id: string; role: 'signature'; asset: Asset; createdAt: number }) => Promise<void>,
): Promise<boolean> {
  if (typeof document === 'undefined' || typeof localStorage === 'undefined') return false
  try {
    if (localStorage.getItem(LEGACY_IMPORTED_FLAG)) return false
    const raw = localStorage.getItem(LEGACY_SIGNATURE_KEY)
    // Unreadable images are skipped for good; a failed save is retried on the next visit.
    const cropped = raw?.startsWith('data:image/png') ? await cropToInk(raw).catch(() => null) : null
    if (cropped) {
      const asset: Asset = { id: LEGACY_SIGNATURE_ID, mime: 'image/png', ...cropped }
      await save({ id: LEGACY_SIGNATURE_ID, role: 'signature', asset, createdAt: Date.now() })
    }
    localStorage.setItem(LEGACY_IMPORTED_FLAG, '1')
    return cropped !== null
  } catch (err) {
    console.warn('[storage] could not import the v1 signature', err)
    return false
  }
}
