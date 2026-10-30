import { PDFDocument } from 'pdf-lib'
import type { RecoveredInfo, RewrittenDocument } from './types'

/** The part of pdf.js' PDFDocumentProxy this module needs (same in the modern and legacy builds). */
export interface PdfjsDocument {
  numPages: number
  extractPages(pageInfos: Array<{ document?: Uint8Array | null }>): Promise<Uint8Array>
  getMetadata(): Promise<{ info: object }>
}

let blank: Promise<Uint8Array> | null = null

/** A one-page helper document (pdf.js transfers the bytes to its worker, so copy before use). */
function blankPdf(): Promise<Uint8Array> {
  blank ??= PDFDocument.create({ updateMetadata: false }).then((d) => {
    d.addPage([72, 72])
    return d.save()
  })
  return blank.then((b) => b.slice())
}

/**
 * Rewrites a document with pdf.js' page editor, which re-serializes every object it copies
 * (pages, annotations, AcroForm, outlines, structure tree) through its own writer.
 *
 * With `dropEncryption`, a helper page from a second document is appended: pdf.js only keeps
 * the original /Encrypt when all pages come from a single file, so the result is written
 * unencrypted. The caller removes the helper page (`extraPageIndex`) after loading.
 */
export async function rewriteWithPdfjs(pdf: PdfjsDocument, opts: { dropEncryption: boolean }): Promise<RewrittenDocument> {
  const pageInfos: Array<{ document: Uint8Array | null }> = [{ document: null }]
  if (opts.dropEncryption) pageInfos.push({ document: await blankPdf() })
  const bytes = await pdf.extractPages(pageInfos)
  if (!bytes?.length) throw new Error('pdf.js could not rewrite the document')
  return {
    bytes,
    extraPageIndex: opts.dropEncryption ? pdf.numPages : undefined,
    // Multi-document output drops the Info dictionary; carry it over.
    info: opts.dropEncryption ? await readInfo(pdf).catch(() => undefined) : undefined,
  }
}

async function readInfo(pdf: PdfjsDocument): Promise<RecoveredInfo> {
  const { info } = await pdf.getMetadata()
  const get = (key: string) => {
    const v = (info as Record<string, unknown>)[key]
    return typeof v === 'string' && v.trim() ? v : undefined
  }
  const created = get('CreationDate')
  return {
    title: get('Title'),
    author: get('Author'),
    subject: get('Subject'),
    keywords: get('Keywords'),
    creator: get('Creator'),
    creationDate: created ? (parsePdfDate(created) ?? undefined) : undefined,
  }
}

/** Parses a PDF date string ("D:YYYYMMDDHHmmSSOHH'mm'"). */
export function parsePdfDate(input: string): Date | null {
  const m = /^(?:D:)?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Z+-])?(\d{2})?'?(\d{2})?'?/.exec(input.trim())
  if (!m) return null
  const n = (s: string | undefined, d: number) => (s ? parseInt(s, 10) : d)
  let minutes = n(m[5], 0)
  let hours = n(m[4], 0)
  const sign = m[7] === '-' ? 1 : m[7] === '+' ? -1 : 0
  hours += sign * n(m[8], 0)
  minutes += sign * n(m[9], 0)
  const date = new Date(Date.UTC(n(m[1], 1970), n(m[2], 1) - 1, n(m[3], 1), hours, minutes, n(m[6], 0)))
  return Number.isNaN(date.getTime()) ? null : date
}
