import type { PDFDocument, PDFImage } from 'pdf-lib'
import type { Asset } from '../../model/types'
import type { Matrix } from '../pdf/geometry'

/** Decodes a `data:` URL (base64 or percent-encoded). */
export function decodeDataUrl(url: string): { bytes: Uint8Array; mime: string } {
  const comma = url.indexOf(',')
  if (!url.startsWith('data:') || comma < 0) throw new Error('Not a data URL')
  const meta = url.slice(5, comma)
  const mime = meta.split(';')[0] || 'application/octet-stream'
  const payload = url.slice(comma + 1)
  let bin: string
  if (/;base64$/i.test(meta)) bin = atob(payload.replace(/\s+/g, ''))
  else bin = Array.from(new TextEncoder().encode(decodeURIComponent(payload)), (b) => String.fromCharCode(b)).join('')
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return { bytes, mime }
}

export type ImageKind = 'png' | 'jpeg'

/** Identifies PNG/JPEG by magic bytes (the declared mime type is not trusted). */
export function sniffImage(bytes: Uint8Array): ImageKind | null {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png'
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg'
  return null
}

/**
 * EXIF orientation (1–8) of a JPEG; 1 when absent. Browsers apply it when displaying the
 * image (`image-orientation: from-image`), PDF viewers don't, so the exporter must.
 */
export function jpegOrientation(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 2
  while (offset + 4 <= bytes.length) {
    if (view.getUint8(offset) !== 0xff) return 1
    const marker = view.getUint8(offset + 1)
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      offset += 2
      continue
    }
    if (marker === 0xda || marker === 0xd9) return 1 // start of scan / end: no EXIF before image data
    const size = view.getUint16(offset + 2)
    if (marker === 0xe1 && size >= 8 && offset + 4 + size - 2 <= bytes.length) {
      const o = readExifOrientation(view, offset + 4, size - 2)
      if (o) return o
    }
    offset += 2 + size
  }
  return 1
}

function readExifOrientation(view: DataView, start: number, length: number): number | null {
  // "Exif\0\0" header
  if (length < 14 || view.getUint32(start) !== 0x45786966 || view.getUint16(start + 4) !== 0) return null
  const tiff = start + 6
  const order = view.getUint16(tiff)
  const little = order === 0x4949
  if (!little && order !== 0x4d4d) return null
  const end = start + length
  const u16 = (p: number) => view.getUint16(p, little)
  const u32 = (p: number) => view.getUint32(p, little)
  if (u16(tiff + 2) !== 42) return null
  const ifd = tiff + u32(tiff + 4)
  if (ifd + 2 > end) return null
  const count = u16(ifd)
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12
    if (entry + 12 > end) return null
    if (u16(entry) === 0x0112) {
      const value = u16(entry + 8)
      return value >= 1 && value <= 8 ? value : null
    }
  }
  return null
}

/**
 * `cm` matrix that paints an image XObject (unit square, stored orientation) into the box
 * (x, y, w, h) — local PDF frame, y up, (x, y) = bottom-left — displayed upright according to
 * its EXIF orientation.
 */
export function imageMatrix(orientation: number, x: number, y: number, w: number, h: number): Matrix {
  // Each entry maps stored-image unit coords (s right, t up) to displayed unit coords (X, Y).
  const m: Record<number, Matrix> = {
    1: [1, 0, 0, 1, 0, 0],
    2: [-1, 0, 0, 1, 1, 0], // mirror horizontally
    3: [-1, 0, 0, -1, 1, 1], // rotate 180°
    4: [1, 0, 0, -1, 0, 1], // mirror vertically
    5: [0, -1, -1, 0, 1, 1], // transpose
    6: [0, -1, 1, 0, 0, 1], // rotate 90° clockwise
    7: [0, 1, 1, 0, 0, 0], // transverse
    8: [0, 1, -1, 0, 1, 0], // rotate 90° counter-clockwise
  }
  const [a, b, c, d, e, f] = m[orientation] ?? m[1]
  // Scale the unit result into the box.
  return [a * w, b * h, c * w, d * h, x + e * w, y + f * h]
}

export interface EmbeddedImage {
  image: PDFImage
  orientation: number
}

/** Embeds each asset once per document. Resolves null (and warns) when an image can't be embedded. */
export class DocImages {
  private readonly cache = new Map<string, Promise<EmbeddedImage | null>>()
  private readonly doc: PDFDocument
  private readonly convert?: (bytes: Uint8Array, mime: string) => Promise<Uint8Array | null>

  constructor(doc: PDFDocument, convert?: (bytes: Uint8Array, mime: string) => Promise<Uint8Array | null>) {
    this.doc = doc
    this.convert = convert
  }

  get(asset: Asset): Promise<EmbeddedImage | null> {
    let p = this.cache.get(asset.id)
    if (!p) {
      p = this.embed(asset).catch((err) => {
        console.warn(`[export] could not embed image ${asset.id}`, err)
        return null
      })
      this.cache.set(asset.id, p)
    }
    return p
  }

  /** Embeds raw PNG bytes (rasterized text). */
  embedPng(bytes: Uint8Array): Promise<PDFImage> {
    return this.doc.embedPng(bytes)
  }

  private async embed(asset: Asset): Promise<EmbeddedImage | null> {
    const { bytes, mime } = decodeDataUrl(asset.dataUrl)
    const kind = sniffImage(bytes)
    try {
      if (kind === 'png') return { image: await this.doc.embedPng(bytes), orientation: 1 }
      if (kind === 'jpeg') return { image: await this.doc.embedJpg(bytes), orientation: jpegOrientation(bytes) }
    } catch (err) {
      // Exotic encodings (16-bit/interlaced quirks, CMYK oddities): re-encode if we can.
      if (!this.convert) throw err
      console.warn('[export] re-encoding image after embed failure', err)
    }
    if (!this.convert) throw new Error(`Unsupported image type: ${mime}`)
    const png = await this.convert(bytes, mime)
    if (!png) throw new Error(`Could not convert image (${mime})`)
    return { image: await this.doc.embedPng(png), orientation: 1 }
  }
}
