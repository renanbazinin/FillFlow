import { describe, expect, it } from 'vitest'
import { applyMatrix } from '../pdf/geometry'
import { decodeDataUrl, imageMatrix, jpegOrientation, sniffImage } from './images'

function jpegWithOrientation(o: number | null, littleEndian = false): Uint8Array {
  const soi = [0xff, 0xd8]
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]
  const segs = [...soi, ...app0]
  if (o !== null) {
    const u16 = (v: number) => (littleEndian ? [v & 255, v >> 8] : [v >> 8, v & 255])
    const u32 = (v: number) => (littleEndian ? [v & 255, (v >> 8) & 255, (v >> 16) & 255, v >>> 24] : [v >>> 24, (v >> 16) & 255, (v >> 8) & 255, v & 255])
    const tiff = [
      ...(littleEndian ? [0x49, 0x49] : [0x4d, 0x4d]),
      ...u16(42),
      ...u32(8),
      ...u16(2), // two entries: a decoy tag, then orientation
      ...u16(0x010f),
      ...u16(2),
      ...u32(4),
      ...u32(0),
      ...u16(0x0112),
      ...u16(3),
      ...u32(1),
      ...u16(o),
      0,
      0,
      ...u32(0),
    ]
    const payload = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff]
    const len = payload.length + 2
    segs.push(0xff, 0xe1, len >> 8, len & 255, ...payload)
  }
  segs.push(0xff, 0xda, 0x00, 0x02, 0xff, 0xd9)
  return new Uint8Array(segs)
}

describe('jpegOrientation', () => {
  it('reads the EXIF orientation in both byte orders', () => {
    for (let o = 1; o <= 8; o++) {
      expect(jpegOrientation(jpegWithOrientation(o))).toBe(o)
      expect(jpegOrientation(jpegWithOrientation(o, true))).toBe(o)
    }
  })

  it('defaults to 1 without EXIF or for garbage', () => {
    expect(jpegOrientation(jpegWithOrientation(null))).toBe(1)
    expect(jpegOrientation(new Uint8Array([0xff, 0xd8, 0x00, 0x00]))).toBe(1)
    expect(jpegOrientation(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff]))).toBe(1)
  })
})

describe('imageMatrix', () => {
  // Stored image corners (unit square, y up) → where they must appear in a 100×50 box at (10, 20).
  const box = { x: 10, y: 20, w: 100, h: 50 }
  const corner = (o: number, s: number, t: number) => {
    const p = applyMatrix(imageMatrix(o, box.x, box.y, box.w, box.h), { x: s, y: t })
    return [Math.round(p.x), Math.round(p.y)]
  }
  const TL = [10, 70]
  const TR = [110, 70]
  const BL = [10, 20]
  const BR = [110, 20]

  it('maps the stored top-left pixel to the right displayed corner', () => {
    // Stored top-left is (s, t) = (0, 1).
    expect(corner(1, 0, 1)).toEqual(TL)
    expect(corner(2, 0, 1)).toEqual(TR)
    expect(corner(3, 0, 1)).toEqual(BR)
    expect(corner(4, 0, 1)).toEqual(BL)
    expect(corner(5, 0, 1)).toEqual(TL)
    expect(corner(6, 0, 1)).toEqual(TR)
    expect(corner(7, 0, 1)).toEqual(BR)
    expect(corner(8, 0, 1)).toEqual(BL)
  })

  it('maps the stored top-right pixel too (distinguishes flips from rotations)', () => {
    // Stored top-right is (1, 1).
    expect(corner(1, 1, 1)).toEqual(TR)
    expect(corner(5, 1, 1)).toEqual(BL)
    expect(corner(6, 1, 1)).toEqual(BR)
    expect(corner(7, 1, 1)).toEqual(TR)
    expect(corner(8, 1, 1)).toEqual(TL)
  })
})

describe('data URLs and sniffing', () => {
  it('decodes base64 and percent-encoded payloads', () => {
    expect(Array.from(decodeDataUrl('data:image/png;base64,iVBORw0K').bytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47])
    const { bytes, mime } = decodeDataUrl('data:text/plain,a%20b')
    expect(mime).toBe('text/plain')
    expect(new TextDecoder().decode(bytes)).toBe('a b')
    expect(() => decodeDataUrl('https://example.com/x.png')).toThrow()
  })

  it('identifies PNG and JPEG by content, not by label', () => {
    expect(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe('png')
    expect(sniffImage(jpegWithOrientation(null))).toBe('jpeg')
    expect(sniffImage(new TextEncoder().encode('GIF89a...'))).toBeNull()
  })
})
