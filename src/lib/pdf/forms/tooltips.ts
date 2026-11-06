import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFRef, PDFString, ParseSpeeds } from 'pdf-lib'
import { pdfText, refKey } from './pdfIndex'

const TU = PDFName.of('TU')
const T = PDFName.of('T')
const PARENT = PDFName.of('Parent')
const SUBTYPE = PDFName.of('Subtype')
const WIDGET = PDFName.of('Widget')

function tooltip(dict: PDFDict): string {
  const tu = dict.lookup(TU)
  return tu instanceof PDFString || tu instanceof PDFHexString ? pdfText(tu).trim() : ''
}

/**
 * The labels (/TU) of the fields that the widgets of a document belong to, by pdf.js annotation
 * id ("12R"). pdf.js reads a label from the widget dictionary only, but a field whose widgets are
 * separate dictionaries (radio groups, fields shown on several pages, every field pdf-lib makes)
 * keeps its label on the field. Only widgets without a label and a name (/T) of their own get
 * one: the field above a named widget is a group of fields, and its label is not theirs.
 * Null for an encrypted file, whose strings can't be read here.
 */
export async function readFieldTooltips(bytes: Uint8Array): Promise<Map<string, string> | null> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, parseSpeed: ParseSpeeds.Fast })
  if (doc.isEncrypted) return null
  const out = new Map<string, string>()
  for (const page of doc.getPages()) {
    const annots = page.node.Annots()
    for (let i = 0; i < (annots?.size() ?? 0); i++) {
      const ref = annots!.get(i)
      const widget = annots!.lookup(i)
      if (!(ref instanceof PDFRef) || !(widget instanceof PDFDict) || widget.lookup(SUBTYPE) !== WIDGET) continue
      if (widget.has(T) || tooltip(widget)) continue
      const field = widget.lookup(PARENT)
      const label = field instanceof PDFDict ? tooltip(field) : ''
      if (label) out.set(refKey(ref), label)
    }
  }
  return out
}
