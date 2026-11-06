import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'

// pdf.js in Node: the "worker" runs in-process from this file.
pdfjs.GlobalWorkerOptions.workerSrc = new URL('../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url).href
// A file path (Node reads it with fs) that must end with "/", also on Windows.
const STANDARD_FONTS = fileURLToPath(new URL('../../node_modules/pdfjs-dist/standard_fonts/', import.meta.url))
  .replace(/\\/g, '/')
  .replace(/\/?$/, '/')

export type PdfSource = string | Uint8Array

export interface ViewSize {
  width: number
  height: number
}

/** A run of text as pdf.js extracts it, positioned in *view space* (points, y down, rotation applied). */
export interface PlacedText {
  str: string
  /** Baseline origin of the run. */
  x: number
  y: number
  /** Unit vector of the text direction in view space ((1, 0) = upright, left to right). */
  direction: { x: number; y: number }
  /** Font size in points (length of the text-space y axis). */
  size: number
}

async function bytesOf(src: PdfSource): Promise<Uint8Array> {
  return typeof src === 'string' ? new Uint8Array(await readFile(src)) : src
}

/** Opens a PDF with pdf.js, runs `fn`, and always cleans up. */
export async function withPdf<T>(
  src: PdfSource,
  fn: (pdf: pdfjs.PDFDocumentProxy) => Promise<T>,
  opts: { password?: string } = {},
): Promise<T> {
  // pdf.js transfers (detaches) the buffer it is given: hand it a copy.
  const data = (await bytesOf(src)).slice()
  const task = pdfjs.getDocument({ data, password: opts.password, standardFontDataUrl: STANDARD_FONTS, verbosity: 0 })
  const pdf = await task.promise
  try {
    return await fn(pdf)
  } finally {
    await task.destroy()
  }
}

/** View-space size (points, rotation applied) of every page. */
export function readViewSizes(src: PdfSource): Promise<ViewSize[]> {
  return withPdf(src, async (pdf) => {
    const sizes: ViewSize[] = []
    for (let i = 1; i <= pdf.numPages; i++) {
      const vp = (await pdf.getPage(i)).getViewport({ scale: 1 })
      sizes.push({ width: vp.width, height: vp.height })
    }
    return sizes
  })
}

/** Every text run on a page (0-based), in view space. */
export function readPageText(src: PdfSource, pageIndex: number): Promise<PlacedText[]> {
  return withPdf(src, async (pdf) => {
    const page = await pdf.getPage(pageIndex + 1)
    const vp = page.getViewport({ scale: 1 })
    const content = await page.getTextContent()
    const out: PlacedText[] = []
    for (const item of content.items) {
      if (!('str' in item) || !item.str) continue
      const m = pdfjs.Util.transform(vp.transform, item.transform) as number[]
      const len = Math.hypot(m[0], m[1]) || 1
      out.push({
        str: item.str,
        x: m[4],
        y: m[5],
        direction: { x: m[0] / len, y: m[1] / len },
        size: Math.hypot(m[2], m[3]),
      })
    }
    return out
  })
}

/** All text of a page joined by spaces (for "contains" checks). */
export async function pageText(src: PdfSource, pageIndex: number): Promise<string> {
  return (await readPageText(src, pageIndex)).map((t) => t.str).join(' ')
}

/** The first text run containing `needle` on a page, or null. */
export async function findText(src: PdfSource, pageIndex: number, needle: string): Promise<PlacedText | null> {
  return (await readPageText(src, pageIndex)).find((t) => t.str.includes(needle)) ?? null
}

/** Number of painted paths on a page: a cheap way to tell that vector marks were added. */
export function pathCount(src: PdfSource, pageIndex: number): Promise<number> {
  return withPdf(src, async (pdf) => {
    const ops = await (await pdf.getPage(pageIndex + 1)).getOperatorList()
    return ops.fnArray.filter((fn) => fn === pdfjs.OPS.constructPath).length
  })
}

export interface AnnotationInfo {
  fieldName?: string
  fieldType?: string
  alternativeText?: string
  required?: boolean
  multiLine?: boolean
  comb?: boolean
  maxLen?: number
  checkBox?: boolean
  radioButton?: boolean
  buttonValue?: string
  combo?: boolean
  multiSelect?: boolean
  textAlignment?: number
  options?: { exportValue: string; displayValue: string }[]
}

/** Widget annotations of a page, as pdf.js reports them to viewers. */
export function readAnnotations(src: PdfSource, pageIndex: number): Promise<AnnotationInfo[]> {
  return withPdf(src, async (pdf) => (await (await pdf.getPage(pageIndex + 1)).getAnnotations()) as AnnotationInfo[])
}

export interface PageGeometry {
  rotate: number
  view: number[]
  size: ViewSize
}

export function readPageGeometry(src: PdfSource): Promise<PageGeometry[]> {
  return withPdf(src, async (pdf) => {
    const out: PageGeometry[] = []
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      const vp = page.getViewport({ scale: 1 })
      out.push({ rotate: page.rotate, view: [...page.view], size: { width: vp.width, height: vp.height } })
    }
    return out
  })
}
