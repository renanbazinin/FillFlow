import type { Font as FkFont, Glyph } from '@pdf-lib/fontkit'
import { CustomFontEmbedder, PDFFont, PDFHexString, PDFString, type PDFContext, type PDFDocument, type PDFRef } from 'pdf-lib'
import { SHAPING_FEATURES } from './shaping'
import { subsetTrueType } from './ttfSubset'

/**
 * A TrueType font embedded as a subset CIDFontType2 (Identity-H) that we address by *glyph*
 * rather than by string: pdf-lib's own embedder only accepts strings, drops the shaper's
 * glyph positions (breaking niqqud and combining accents) and relies on fontkit's subsetter,
 * which corrupts fonts like Arimo (see ttfSubset.ts).
 *
 * Usage: `cid(glyph)` while drawing, then `finalize()` once before saving.
 */
export class SubsetFont {
  readonly ref: PDFRef
  readonly font: FkFont
  /** 1000 / unitsPerEm: font units → PDF glyph space. */
  readonly scale: number
  private readonly doc: PDFDocument
  private readonly bytes: Uint8Array
  private readonly flags: number
  private readonly cids = new Map<number, number>()
  /** Glyph for each CID (index = CID; 0 is .notdef). */
  private readonly byCid: Glyph[] = []
  private finalized = false

  constructor(doc: PDFDocument, font: FkFont, bytes: Uint8Array, opts: { serif: boolean; fixedPitch: boolean }) {
    this.doc = doc
    this.font = font
    this.bytes = bytes
    this.scale = 1000 / font.unitsPerEm
    this.ref = doc.context.nextRef()
    this.byCid[0] = font.getGlyph(0)
    this.cids.set(0, 0)
    // FixedPitch | Serif | Symbolic (glyphs are addressed by CID, not a standard encoding).
    this.flags = (opts.fixedPitch ? 1 : 0) | (opts.serif ? 2 : 0) | 4
  }

  /** Includes `glyph` in the subset and returns its CID. */
  cid(glyph: Glyph): number {
    let cid = this.cids.get(glyph.id)
    if (cid === undefined) {
      if (this.finalized) throw new Error('Font already written')
      cid = this.byCid.length
      this.cids.set(glyph.id, cid)
      this.byCid.push(glyph)
    }
    return cid
  }

  /** Hex string operand for a sequence of glyphs (2 bytes per CID). */
  encode(glyphs: Glyph[]): PDFHexString {
    let hex = ''
    for (const g of glyphs) hex += this.cid(g).toString(16).padStart(4, '0')
    return PDFHexString.of(hex)
  }

  /** Writes the subset font program and font dictionaries into the document (once). */
  finalize(): void {
    if (this.finalized) return
    this.finalized = true
    const { context } = this.doc
    const { font, scale } = this
    const subset = subsetTrueType(this.bytes, this.byCid.map((g) => g.id))
    const tag = subsetTag(this.byCid.map((g) => g.id))
    const baseFont = `${tag}+${(font.postscriptName || 'Font').replace(/[^\x21-\x7e]|[#()<>[\]{}/%]/g, '')}`

    const fontFile = context.register(context.flateStream(subset.data, { Length1: subset.data.length }))
    const { minX, minY, maxX, maxY } = font.bbox
    const descriptor = context.register(
      context.obj({
        Type: 'FontDescriptor',
        FontName: baseFont,
        Flags: this.flags,
        FontBBox: [minX * scale, minY * scale, maxX * scale, maxY * scale].map(round),
        ItalicAngle: font.italicAngle || 0,
        Ascent: round(font.ascent * scale),
        Descent: round(font.descent * scale),
        CapHeight: round((font.capHeight || font.ascent) * scale),
        XHeight: round((font.xHeight || 0) * scale),
        StemV: 80,
        FontFile2: fontFile,
      }),
    )
    const cidFont = context.register(
      context.obj({
        Type: 'Font',
        Subtype: 'CIDFontType2',
        BaseFont: baseFont,
        CIDSystemInfo: { Registry: PDFString.of('Adobe'), Ordering: PDFString.of('Identity'), Supplement: 0 },
        FontDescriptor: descriptor,
        W: [0, this.byCid.map((g) => round(g.advanceWidth * scale))],
        CIDToGIDMap: 'Identity',
      }),
    )
    const toUnicode = context.register(context.flateStream(toUnicodeCMap(this.byCid)))
    context.assign(
      this.ref,
      context.obj({
        Type: 'Font',
        Subtype: 'Type0',
        BaseFont: baseFont,
        Encoding: 'Identity-H',
        DescendantFonts: [cidFont],
        ToUnicode: toUnicode,
      }),
    )
  }

  /**
   * The same font as a pdf-lib PDFFont (string API, pdf-lib's shaping semantics), for code
   * that draws through pdf-lib such as form field appearances. Glyphs it encodes join this
   * subset; `finalize()` writes it.
   */
  asPdfLibFont(): PDFFont {
    return PDFFont.of(this.ref, this.doc, SubsetEmbedder.create(this))
  }
}

/** pdf-lib's font embedder interface backed by a SubsetFont (PDFFont requires this subclass). */
class SubsetEmbedder extends CustomFontEmbedder {
  private subset!: SubsetFont

  static create(subset: SubsetFont): SubsetEmbedder {
    const e = new SubsetEmbedder(subset.font, new Uint8Array(0), undefined, SHAPING_FEATURES)
    e.subset = subset
    return e
  }

  encodeText(text: string): PDFHexString {
    return this.subset.encode(this.font.layout(text, this.fontFeatures).glyphs)
  }

  async embedIntoContext(_context: PDFContext, ref?: PDFRef): Promise<PDFRef> {
    this.subset.finalize()
    return ref ?? this.subset.ref
  }
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000
}

/** Six uppercase letters derived from the glyph set (stable output for the same content). */
function subsetTag(ids: number[]): string {
  let h = 2166136261
  for (const id of ids) {
    h ^= id
    h = Math.imul(h, 16777619) >>> 0
  }
  let tag = ''
  for (let i = 0; i < 6; i++) {
    tag += String.fromCharCode(65 + (h % 26))
    h = Math.floor(h / 26)
  }
  return tag
}

function utf16Hex(codePoints: number[]): string {
  let hex = ''
  for (const cp of codePoints) {
    if (cp > 0xffff) {
      const v = cp - 0x10000
      hex += (0xd800 + (v >> 10)).toString(16).padStart(4, '0') + (0xdc00 + (v & 0x3ff)).toString(16).padStart(4, '0')
    } else {
      hex += cp.toString(16).padStart(4, '0')
    }
  }
  return hex
}

/** ToUnicode CMap mapping each CID back to the characters its glyph represents. */
export function toUnicodeCMap(byCid: Glyph[]): string {
  const entries: string[] = []
  byCid.forEach((g, cid) => {
    if (cid === 0 || !g?.codePoints?.length) return
    entries.push(`<${cid.toString(16).padStart(4, '0')}> <${utf16Hex(g.codePoints)}>`)
  })
  const blocks: string[] = []
  for (let i = 0; i < entries.length; i += 100) {
    const chunk = entries.slice(i, i + 100)
    blocks.push(`${chunk.length} beginbfchar\n${chunk.join('\n')}\nendbfchar`)
  }
  return [
    '/CIDInit /ProcSet findresource begin',
    '12 dict begin',
    'begincmap',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
    '/CMapName /Adobe-Identity-UCS def',
    '/CMapType 2 def',
    '1 begincodespacerange',
    '<0000> <FFFF>',
    'endcodespacerange',
    ...blocks,
    'endcmap',
    'CMapName currentdict /CMap defineresource pop',
    'end',
    'end',
  ].join('\n')
}
