import fontkit from '@pdf-lib/fontkit'
import { describe, expect, it } from 'vitest'
import type { FontId } from '../../model/types'
import { testFont, testFontBytes } from './testing/fonts'
import { subsetTrueType } from './ttfSubset'

function isComposite(font: Uint8Array, gid: number): boolean {
  const view = new DataView(font.buffer, font.byteOffset, font.byteLength)
  const n = view.getUint16(4)
  const tables: Record<string, number> = {}
  for (let i = 0; i < n; i++) {
    const p = 12 + i * 16
    tables[String.fromCharCode(font[p], font[p + 1], font[p + 2], font[p + 3])] = view.getUint32(p + 8)
  }
  const long = view.getInt16(tables.head + 50) === 1
  const off = long ? view.getUint32(tables.loca + gid * 4) : view.getUint16(tables.loca + gid * 2) * 2
  const next = long ? view.getUint32(tables.loca + gid * 4 + 4) : view.getUint16(tables.loca + gid * 2 + 2) * 2
  return next > off && view.getInt16(tables.glyf + off) < 0
}

function fileChecksum(data: Uint8Array): number {
  let sum = 0
  for (let i = 0; i < data.length; i += 4) {
    const word = ((data[i] << 24) | ((data[i + 1] ?? 0) << 16) | ((data[i + 2] ?? 0) << 8) | (data[i + 3] ?? 0)) >>> 0
    sum = (sum + word) >>> 0
  }
  return sum
}

describe('subsetTrueType', () => {
  const SAMPLE = 'Hello, Wörld! ÁÉÍÓÚ ñ ç 0123 שלום עולם Привет Γειά ﬁ'

  for (const [fontId, bold] of [
    ['sans', false],
    ['sans', true],
    ['serif', false],
    ['mono', true],
  ] as [FontId, boolean][]) {
    it(`keeps every glyph outline and advance intact (${fontId}${bold ? ' bold' : ''})`, () => {
      const bytes = testFontBytes(fontId, bold)
      const font = testFont(fontId, bold)
      const wanted = [0, ...new Set(font.glyphsForString(SAMPLE).map((g) => g.id))]
      const { data, glyphIds } = subsetTrueType(bytes, wanted)
      expect(glyphIds.slice(0, wanted.length)).toEqual(wanted)
      const sub = fontkit.create(data)
      expect(sub.numGlyphs).toBe(glyphIds.length)
      glyphIds.forEach((orig, i) => {
        const a = font.getGlyph(orig)
        const b = sub.getGlyph(i)
        expect(b.advanceWidth, `advance of glyph ${orig}`).toBe(a.advanceWidth)
        expect(b.path.toSVG(), `outline of glyph ${orig}`).toBe(a.path.toSVG())
      })
      // Whole-file checksum must come out to the magic constant.
      expect(fileChecksum(data)).toBe(0xb1b0afba)
    })
  }

  it('makes glyphs for the subset: moved, with an advance of their own, or empty', () => {
    const bytes = testFontBytes('serif', false)
    const font = testFont('serif', false)
    const qamats = font.glyphForCodePoint(0x5b8)
    const bet = font.glyphForCodePoint(0x5d1)
    const { data } = subsetTrueType(bytes, [
      0,
      { id: qamats.id, dx: 300, dy: -20, advance: 0 },
      { id: bet.id, dx: 0, dy: 0, advance: 1500 },
      { id: null, dx: 0, dy: 0, advance: 0 },
    ])
    const sub = fontkit.create(data)
    const box = (g: { path: { bbox: { minX: number; minY: number; maxX: number; maxY: number } } }) => {
      const { minX, minY, maxX, maxY } = g.path.bbox
      return [minX, minY, maxX, maxY]
    }
    // The qamats, moved: a composite glyph drawing the original outline at an offset.
    const [x0, y0, x1, y1] = box(qamats)
    expect(isComposite(data, 1)).toBe(true)
    expect(box(sub.getGlyph(1))).toEqual([x0 + 300, y0 - 20, x1 + 300, y1 - 20])
    expect(sub.getGlyph(1).advanceWidth).toBe(0)
    // The bet with a wider advance, and an empty glyph.
    expect(sub.getGlyph(2).path.toSVG()).toBe(bet.path.toSVG())
    expect(sub.getGlyph(2).advanceWidth).toBe(1500)
    expect(sub.getGlyph(3).path.toSVG()).toBe('')
    expect(sub.getGlyph(3).advanceWidth).toBe(0)
    expect(fileChecksum(data)).toBe(0xb1b0afba)
  })

  it('pulls in and renumbers composite glyph components', () => {
    const bytes = testFontBytes('sans', false)
    const font = testFont('sans', false)
    const composite = font.glyphsForString('ÁÉÍÓÚáéíóúĀāŌō').find((g) => isComposite(bytes, g.id))
    expect(composite, 'Arimo should have composite accented glyphs').toBeDefined()
    const { data, glyphIds } = subsetTrueType(bytes, [0, composite!.id])
    expect(glyphIds.length).toBeGreaterThan(2)
    const sub = fontkit.create(data)
    expect(sub.getGlyph(1).path.toSVG()).toBe(composite!.path.toSVG())
  })
})
