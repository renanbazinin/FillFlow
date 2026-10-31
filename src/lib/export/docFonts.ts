import fontkit, { type Font as FkFont } from '@pdf-lib/fontkit'
import type { PDFDocument, PDFFont } from 'pdf-lib'
import type { FontId } from '../../model/types'
import { ExportError } from './errors'
import { SubsetFont } from './subsetFont'

/** Parsed fonts, shared across exports while the loader keeps returning the same bytes. */
const parsed = new WeakMap<Uint8Array, FkFont>()

/** The fonts one export uses: parsed faces, subset fonts for overlay text, and the form font. */
export class DocFonts {
  private readonly doc: PDFDocument
  private readonly load: (fontId: FontId, bold: boolean) => Promise<Uint8Array>
  private readonly faces = new Map<string, Promise<{ bytes: Uint8Array; font: FkFont }>>()
  private readonly subsets = new Map<string, Promise<SubsetFont>>()
  private unicode: Promise<PDFFont> | null = null

  constructor(doc: PDFDocument, load: (fontId: FontId, bold: boolean) => Promise<Uint8Array>) {
    this.doc = doc
    this.load = load
  }

  face(fontId: FontId, bold: boolean): Promise<{ bytes: Uint8Array; font: FkFont }> {
    const key = `${fontId}:${bold}`
    let p = this.faces.get(key)
    if (!p) {
      p = this.load(fontId, bold).then(
        (bytes) => {
          let font = parsed.get(bytes)
          if (!font) {
            font = fontkit.create(bytes)
            parsed.set(bytes, font)
          }
          return { bytes, font }
        },
        (err) => {
          throw new ExportError('fonts', undefined, { cause: err })
        },
      )
      this.faces.set(key, p)
    }
    return p
  }

  /** The subset font used to draw overlay text in this font. */
  subset(fontId: FontId, bold: boolean): Promise<SubsetFont> {
    const key = `${fontId}:${bold}`
    let p = this.subsets.get(key)
    if (!p) {
      p = this.face(fontId, bold).then(
        ({ font, bytes }) => new SubsetFont(this.doc, font, bytes, { serif: fontId === 'serif', fixedPitch: fontId === 'mono' }),
      )
      this.subsets.set(key, p)
    }
    return p
  }

  /**
   * Arimo Regular as a pdf-lib font, for form field appearances with non-Latin values. It shares
   * the overlay text's subset, also for fields that stay editable: only their current appearance
   * uses it, while viewers draw later edits with the field's own /DA font, never this one.
   */
  getUnicodeFont = (): Promise<PDFFont> => {
    this.unicode ??= this.subset('sans', false).then((s) => s.asPdfLibFont())
    return this.unicode
  }

  /** Writes every subset font into the document (pages may reference them even if empty). */
  async finalize(): Promise<void> {
    for (const font of await Promise.all(this.subsets.values())) font.finalize()
  }
}
