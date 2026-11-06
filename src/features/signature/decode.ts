import type { Asset } from '../../model/types'
import { fitWithin, hasTransparency, vectorOutputSize } from './imageUtils'
import { context2d, createCanvas } from './render'

export class UnsupportedImageError extends Error {
  constructor() {
    super("This image format isn't supported.")
    this.name = 'UnsupportedImageError'
  }
}

interface Decoded {
  source: CanvasImageSource
  width: number
  height: number
  /** SVG: sharp at any size, so it is drawn at the size needed rather than its nominal one. */
  vector: boolean
  dispose(): void
}

/** Width and height of the root viewBox of an SVG document; null when it has no usable one. */
export function svgViewBox(svg: string): { width: number; height: number } | null {
  const attr = /<svg\b[^>]*?\sviewBox\s*=\s*(["'])(.*?)\1/s.exec(svg)?.[2]
  const [, , width, height] = attr?.trim().split(/[\s,]+/).map(Number) ?? []
  return width > 0 && height > 0 ? { width, height } : null
}

async function decode(blob: Blob): Promise<Decoded> {
  const vector = blob.type === 'image/svg+xml'
  // SVG goes to <img> (createImageBitmap can't decode it, or would freeze it at its nominal size).
  if (!vector && typeof createImageBitmap === 'function') {
    try {
      // 'from-image' applies EXIF orientation (phone photos), so pixels match what the user saw.
      const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' })
      return { source: bmp, width: bmp.width, height: bmp.height, vector: false, dispose: () => bmp.close() }
    } catch {
      /* fall back to <img> */
    }
  }
  const url = URL.createObjectURL(blob)
  try {
    const img = new Image()
    img.decoding = 'async'
    img.src = url
    await img.decode()
    // SVGs without an intrinsic size report 0: take their shape from the viewBox.
    const intrinsic = img.naturalWidth > 0 && img.naturalHeight > 0
    const box = vector && !intrinsic ? svgViewBox(await blob.text()) : null
    const width = box?.width ?? (img.naturalWidth || 1000)
    const height = box?.height ?? (img.naturalHeight || 1000)
    return { source: img, width, height, vector, dispose: () => URL.revokeObjectURL(url) }
  } catch {
    URL.revokeObjectURL(url)
    throw new UnsupportedImageError()
  }
}

/**
 * Decodes an image file into a canvas whose long side is at most `maxSide`. Photos are only ever
 * downscaled; SVGs are drawn with their long side at `maxSide`, however small they claim to be.
 */
export async function imageFileToCanvas(blob: Blob, maxSide: number): Promise<HTMLCanvasElement> {
  const decoded = await decode(blob)
  try {
    const size = decoded.vector
      ? vectorOutputSize(decoded.width, decoded.height, { targetWidth: maxSide, maxLong: maxSide })
      : fitWithin(decoded.width, decoded.height, maxSide)
    const canvas = createCanvas(size.width, size.height)
    const ctx = context2d(canvas, true)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(decoded.source, 0, 0, size.width, size.height)
    return canvas
  } finally {
    decoded.dispose()
  }
}

/** Long-side limit for pictures inserted with the image tool. */
export const IMAGE_MAX_SIDE = 2000

/**
 * Prepares a picture for the image tool: decoded (EXIF-rotated), at most 2000 px on the long
 * side, PNG when it has transparency, otherwise JPEG at 0.9.
 */
export async function importImageAsset(file: Blob): Promise<Omit<Asset, 'id'>> {
  const canvas = await imageFileToCanvas(file, IMAGE_MAX_SIDE)
  const transparent =
    file.type !== 'image/jpeg' && hasTransparency(context2d(canvas, true).getImageData(0, 0, canvas.width, canvas.height))
  const mime = transparent ? 'image/png' : 'image/jpeg'
  return { mime, dataUrl: canvas.toDataURL(mime, 0.9), width: canvas.width, height: canvas.height }
}

/** First image file in a drop / paste payload. */
export function firstImageFile(list: FileList | DataTransferItemList | null | undefined): File | null {
  if (!list) return null
  for (const entry of Array.from(list as ArrayLike<File | DataTransferItem>)) {
    const file = entry instanceof File ? entry : entry.kind === 'file' ? entry.getAsFile() : null
    if (file && file.type.startsWith('image/')) return file
  }
  return null
}
