import type { Font as FkFont, Glyph } from '@pdf-lib/fontkit'
import { CustomFontEmbedder, PDFFont, PDFHexString, PDFString, type PDFContext, type PDFDocument, type PDFRef } from 'pdf-lib'
import { graphemes } from '../text/layout'
import { SHAPING_FEATURES, firstStrongDirection, spellOutPresentationForms } from './shaping'
import { subsetTrueType, type PlacedGlyph } from './ttfSubset'

/** A glyph as drawn: moved by (dx, dy) and advancing by `advance` (font units), standing for `chars`; with no glyph, an empty one. */
export interface Placed {
  glyph: Glyph | null
  chars: string
  dx: number
  dy: number
  advance: number
}

/** The characters a glyph stands for by default: its code points (.notdef, shared by every missing character, for nothing). */
function ownChars(glyph: Glyph): string {
  return glyph.id === 0 ? '' : String.fromCodePoint(...glyph.codePoints)
}

/**
 * A TrueType font embedded as a subset CIDFontType2 (Identity-H) that we address by *glyph*
 * rather than by string: pdf-lib's own embedder only accepts strings, drops the shaper's
 * glyph positions (breaking niqqud and combining accents) and relies on fontkit's subsetter,
 * which corrupts fonts like Arimo (see ttfSubset.ts).
 *
 * Usage: `cid(glyph)` or `placedCid(…)` while drawing, then `finalize()` once before saving.
 */
export class SubsetFont {
  readonly ref: PDFRef
  readonly font: FkFont
  /** 1000 / unitsPerEm: font units → PDF glyph space. */
  readonly scale: number
  private readonly doc: PDFDocument
  private readonly bytes: Uint8Array
  private readonly flags: number
  private readonly cids = new Map<string, number>()
  /** What each CID draws (index = CID; 0 is .notdef): a glyph of the font, or one made for the subset. */
  private readonly byCid: (number | PlacedGlyph)[] = []
  /** Advance width of each CID, in font units. */
  private readonly widths: number[] = []
  /** Characters each CID stands for (its ToUnicode entry). */
  private readonly chars: string[] = []
  private finalized = false

  constructor(doc: PDFDocument, font: FkFont, bytes: Uint8Array, opts: { serif: boolean; fixedPitch: boolean }) {
    this.doc = doc
    this.font = font
    this.bytes = bytes
    this.scale = 1000 / font.unitsPerEm
    this.ref = doc.context.nextRef()
    this.add('0:', 0, font.getGlyph(0).advanceWidth, '')
    // FixedPitch | Serif | Symbolic (glyphs are addressed by CID, not a standard encoding).
    this.flags = (opts.fixedPitch ? 1 : 0) | (opts.serif ? 2 : 0) | 4
  }

  /**
   * Includes `glyph` in the subset and returns its CID. `chars` are the characters this use of the
   * glyph stands for, which copying the text gives: each glyph and characters pair gets its own
   * CID, e.g. the ")" glyph drawn for a right-to-left "(", or the .notdef box drawn for a character
   * the font lacks. By default a glyph stands for its code points, and .notdef (shared by every
   * missing character) for nothing.
   */
  cid(glyph: Glyph, chars = ownChars(glyph)): number {
    return this.add(`${glyph.id}:${chars}`, glyph.id, glyph.advanceWidth, chars)
  }

  /**
   * CID of `glyph` drawn moved by (dx, dy) and advancing by `advance` (font units), standing for
   * `chars`; with no glyph, of an empty glyph. Glyphs placed this way need no positioning in the
   * content stream, which text extractors would read as gaps between words.
   */
  placedCid(glyph: Glyph | null, chars: string, dx: number, dy: number, advance: number): number {
    dx = Math.round(dx)
    dy = Math.round(dy)
    if (glyph && !dx && !dy && advance === glyph.advanceWidth) return this.cid(glyph, chars)
    const id = glyph?.id ?? null
    return this.add(`${id ?? '-'}@${dx},${dy},${round(advance)}:${chars}`, { id, dx, dy, advance }, advance, chars)
  }

  private add(key: string, glyph: number | PlacedGlyph, width: number, chars: string): number {
    let cid = this.cids.get(key)
    if (cid === undefined) {
      if (this.finalized) throw new Error('Font already written')
      cid = this.byCid.length
      this.cids.set(key, cid)
      this.byCid.push(glyph)
      this.widths.push(width)
      this.chars.push(chars)
    }
    return cid
  }

  /** Hex string operand for a sequence of glyphs (2 bytes per CID). */
  encode(glyphs: Glyph[]): PDFHexString {
    let hex = ''
    for (const g of glyphs) hex += this.cid(g).toString(16).padStart(4, '0')
    return PDFHexString.of(hex)
  }

  /** Hex string operand drawing placed glyphs (2 bytes per CID). */
  encodePlaced(placed: Placed[]): PDFHexString {
    let hex = ''
    for (const p of placed) hex += this.placedCid(p.glyph, p.chars, p.dx, p.dy, p.advance).toString(16).padStart(4, '0')
    return PDFHexString.of(hex)
  }

  /** Writes the subset font program and font dictionaries into the document (once). */
  finalize(): void {
    if (this.finalized) return
    this.finalized = true
    const { context } = this.doc
    const { font, scale } = this
    const subset = subsetTrueType(this.bytes, this.byCid)
    const tag = subsetTag(this.byCid.flatMap((g) => (typeof g === 'number' ? [g] : [g.id ?? -1, g.dx, g.dy, Math.round(g.advance)])))
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
        W: [0, this.widths.map((w) => round(w * scale))],
        CIDToGIDMap: 'Identity',
      }),
    )
    const toUnicode = context.register(context.flateStream(toUnicodeCMap(this.chars)))
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
    const font = PDFFont.of(this.ref, this.doc, SubsetEmbedder.create(this))
    subsetOf.set(font, this)
    return font
  }
}

const subsetOf = new WeakMap<PDFFont, SubsetFont>()

/**
 * Encodes `shown`, a line in visual order, one character at a time like `font.encodeText` and
 * drawing the same, but so that it copies as typed, as text elements do: each glyph stands for
 * the character at the same place in `typed` (the ")" glyph drawn for a right-to-left "(" copies
 * as "(", a Hebrew presentation form as its letter and points), and a right-to-left letter with
 * points comes after its points, which are drawn where they were (extractors reverse right-to-left
 * text one character at a time); spaces before points are folded (foldSpacesBeforePoints). Only
 * for fonts made by `SubsetFont.asPdfLibFont`, and lines as long as what was typed; others encode
 * `shown` one character at a time.
 */
export function encodeTyped(font: PDFFont, shown: string, typed: string): PDFHexString {
  const subset = subsetOf.get(font)
  const chars = [...typed]
  if (!subset || [...shown].length !== chars.length) return encodeEach(font, shown)
  const placed: Placed[] = []
  let i = 0
  for (const cluster of graphemes(shown)) {
    const shapes = Array.from(cluster, (ch) => subset.font.layout(ch, SHAPING_FEATURES).glyphs)
    const stands = chars.slice(i, (i += shapes.length)).map(spellOutPresentationForms)
    if (shapes.length > 1 && shapes.every((g) => g.length === 1) && firstStrongDirection(cluster) === 'rtl') {
      // From the letter's place, each point moved to where it is drawn after the letter.
      let x = 0
      const at = shapes.map(([g]) => (x += g.advanceWidth) - g.advanceWidth)
      for (let k = shapes.length - 1; k > 0; k--) placed.push({ glyph: shapes[k][0], chars: stands[k], dx: at[k], dy: 0, advance: 0 })
      placed.push({ glyph: shapes[0][0], chars: stands[0], dx: 0, dy: 0, advance: x })
    } else {
      shapes.forEach((glyphs, k) =>
        glyphs.forEach((g, n) => placed.push({ glyph: g, chars: n === 0 ? stands[k] : ownChars(g), dx: 0, dy: 0, advance: g.advanceWidth })),
      )
    }
  }
  const folded = foldSpacesBeforePoints(placed)
  return subset.encodePlaced(placed.filter((p) => !folded.has(p)))
}

/** Spaces, blank glyphs. */
const isSpace = (chars: string) => /^[ \u00A0]+$/.test(chars)
/** What pdf.js takes for a zero-width diacritic: it doesn't move past it. */
const isPoint = (chars: string) => !/^\s/u.test(chars) && /\p{Mn}/u.test(chars)
/** What pdf.js takes for a glyph of its own, which it measures the next gap from. */
const isPlain = (chars: string) => chars !== '' && !/^\s/u.test(chars) && !/[\p{Mn}\p{Cf}]/u.test(chars)

/**
 * pdf.js (Firefox's viewer) reads a space glyph followed by a point as a space on either side of
 * the point: one comes in with the point, and another with its letter, which as far as pdf.js can
 * tell starts a gap away from the last glyph that moved past (a point doesn't). Right-to-left
 * clusters are written points first, so a space before a word ending in a pointed letter split it:
 * "מֶלֶךְ דָּוִד" copied as "מֶלֶך ְ דָּוִד". So such spaces are drawn as part of the glyph before
 * them instead, which also stands for them, and the page is unchanged. `placed` is in drawing
 * order; returns the spaces folded away, to leave out.
 */
export function foldSpacesBeforePoints(placed: Placed[]): Set<Placed> {
  const folded = new Set<Placed>()
  for (let k = 1; k < placed.length; k++) {
    if (!isSpace(placed[k].chars)) continue
    let end = k + 1
    while (end < placed.length && isSpace(placed[end].chars)) end++
    const before = placed[k - 1]
    if (end < placed.length && isPoint(placed[end].chars) && isPlain(before.chars)) {
      let spaces = ''
      for (const space of placed.slice(k, end)) {
        before.advance += space.advance
        spaces += space.chars
        folded.add(space)
      }
      // As drawn, the glyph and then the spaces (toUnicodeCMap reverses right-to-left characters).
      before.chars = firstStrongDirection(before.chars) === 'rtl' ? spaces + before.chars : before.chars + spaces
    }
    k = end
  }
  return folded
}

/**
 * Encodes `text` one character at a time, as field appearances do, so that it is drawn in the order
 * given: fontkit shapes a whole string, and draws a right-to-left one backwards. A character the font
 * can't encode is left out.
 */
function encodeEach(font: PDFFont, text: string): PDFHexString {
  let hex = ''
  for (const ch of text) {
    try {
      hex += font.encodeText(ch).asString()
    } catch {
      // Not in the font's encoding (a standard font and a non-Latin character).
    }
  }
  return PDFHexString.of(hex)
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

/**
 * ToUnicode CMap mapping each CID (index) back to the characters its glyph stands for.
 *
 * Right-to-left text is drawn in visual order, and extractors (pdf.js, PDFium, Acrobat, poppler,
 * xpdf) turn it back into logical order by reversing it one character at a time. Text elements
 * give each character a glyph of its own; a glyph that still stands for several right-to-left
 * characters (a letter composed with its dagesh or shin dot, וֹ, or a letter and the spaces folded
 * into it) is mapped to them in reverse, so that each point comes out after its letter.
 */
export function toUnicodeCMap(chars: string[]): string {
  const entries: string[] = []
  chars.forEach((text, cid) => {
    if (cid === 0 || !text) return
    const codePoints = Array.from(text, (ch) => ch.codePointAt(0)!)
    if (codePoints.length > 1 && firstStrongDirection(text) === 'rtl') codePoints.reverse()
    entries.push(`<${cid.toString(16).padStart(4, '0')}> <${utf16Hex(codePoints)}>`)
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
