// The legacy build: the default one calls the newest JS built-ins (Promise.try,
// Map#getOrInsertComputed, Math.sumPrecise…) without polyfills, so it fails in browsers
// that are only a year or so old. Same API (and types) as 'pdfjs-dist'.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import type { PageInfo, PageRotation } from '../../model/types'

// Unless already set: in Node (unit tests) pdf.js points it at its own worker file, or a test
// helper sharing this module did, and `workerUrl` only resolves in the browser.
pdfjs.GlobalWorkerOptions.workerSrc ||= workerUrl

/** Where `vite.config.ts` serves/copies pdf.js runtime assets. */
const ASSETS = `${import.meta.env.BASE_URL}pdfjs/`

export { pdfjs }
export type { PDFDocumentProxy, PDFPageProxy }

export class PasswordRequiredError extends Error {
  readonly incorrect: boolean
  constructor(incorrect: boolean) {
    super(incorrect ? 'Incorrect password' : 'Password required')
    this.name = 'PasswordRequiredError'
    this.incorrect = incorrect
  }
}

/**
 * Opens a PDF with pdf.js. `bytes` is copied because pdf.js transfers the buffer to its worker.
 * Rejects with PasswordRequiredError when the file needs a (different) password.
 */
export async function openPdf(bytes: Uint8Array, password?: string): Promise<PDFDocumentProxy> {
  const task: PDFDocumentLoadingTask = pdfjs.getDocument({
    data: bytes.slice(),
    password,
    cMapUrl: `${ASSETS}cmaps/`,
    standardFontDataUrl: `${ASSETS}standard_fonts/`,
    wasmUrl: `${ASSETS}wasm/`,
    iccUrl: `${ASSETS}iccs/`,
    enableXfa: false,
  })
  let passwordError: PasswordRequiredError | null = null
  task.onPassword = (_update: (pw: string) => void, reason: number) => {
    passwordError = new PasswordRequiredError(reason === pdfjs.PasswordResponses.INCORRECT_PASSWORD)
    void task.destroy()
  }
  try {
    return await task.promise
  } catch (err) {
    if (passwordError) throw passwordError
    throw err
  }
}

function normalizeRotation(r: number): PageRotation {
  const n = ((Math.round(r / 90) * 90) % 360 + 360) % 360
  return n as PageRotation
}

export function pageInfoFromProxy(page: PDFPageProxy): PageInfo {
  const viewport = page.getViewport({ scale: 1 })
  const [x0, y0, x1, y1] = page.view
  return {
    index: page.pageNumber - 1,
    width: viewport.width,
    height: viewport.height,
    rotation: normalizeRotation(page.rotate),
    view: [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)],
    userUnit: page.userUnit || 1,
  }
}

/** Reads geometry for every page (in parallel). */
export async function readPageInfos(pdf: PDFDocumentProxy): Promise<PageInfo[]> {
  const pages = await Promise.all(Array.from({ length: pdf.numPages }, (_, i) => pdf.getPage(i + 1)))
  return pages.map(pageInfoFromProxy)
}

/** Quick check that the bytes look like a PDF (header within the first 1KB). */
export function looksLikePdf(bytes: Uint8Array): boolean {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024))
  return head.includes('%PDF-')
}
