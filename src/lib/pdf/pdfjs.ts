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

/**
 * Where `vite.config.ts` serves/copies pdf.js runtime assets. A full address in the browser: the
 * worker, which fetches them, runs from a blob (see `preloadPdfWorker`), against which a path
 * doesn't resolve.
 */
const ASSETS =
  typeof location === 'undefined' ? `${import.meta.env.BASE_URL}pdfjs/` : new URL(`${import.meta.env.BASE_URL}pdfjs/`, location.href).href

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
 * pdf.js's worker script couldn't be downloaded (the connection is down, or the server no longer
 * has it), so no file can be opened yet. Nothing is wrong with the file: trying again can work.
 */
export class WorkerUnavailableError extends Error {
  /**
   * The request itself failed (offline, connection lost), so it can work once the connection is
   * back. Otherwise the server answered with something else (it no longer has that version of the
   * app, say): reloading the page is what helps.
   */
  readonly network: boolean
  constructor(cause: unknown) {
    super('The pdf.js worker could not be downloaded.', { cause })
    this.name = 'WorkerUnavailableError'
    this.network = cause instanceof TypeError
  }
}

/** The worker script being fetched into memory, or there (see `preloadPdfWorker`); null until then. */
let workerReady: Promise<void> | null = null

/**
 * Downloads pdf.js's worker script once and keeps it in memory, where every load then starts its
 * worker from: from then on, files open without the network (offline included). Until it is
 * there, no load is started (see `openPdf`): a worker script that can't be fetched makes pdf.js
 * fall back to running without a worker for good, which then fails every later load in the page.
 * Rejects with WorkerUnavailableError; the next call tries again. (Node runs pdf.js in-process.)
 */
export function preloadPdfWorker(): Promise<void> {
  if (typeof Worker === 'undefined') return Promise.resolve()
  workerReady ??= fetch(workerUrl)
    .then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      let source = await res.text()
      // Something else answered (a captive portal's page, say): as the worker, it would make
      // pdf.js fall back for good.
      if (!source.includes('WorkerMessageHandler')) throw new Error('Not the pdf.js worker')
      // The dev server puts an import of its client in front, by a path, which doesn't resolve
      // from a blob. It only serves the worker's one dynamic import (of an optional fallback
      // decoder): stand in for it, so that, as in a build, the worker needs nothing more from the
      // network. Anything else it might import goes by its full address. Imports are hoisted, so
      // code may come first (as in the e2e tests' older browser): they are found at any line's start.
      if (import.meta.env.DEV) {
        source = source
          .replace(/^([ \t]*)import \{ injectQuery as (\w+) \} from "[^"]*";/m, '$1const $2 = (url) => url;')
          .replace(/^[ \t]*import [^;]*? from "(\/[^"]*)";/gm, (line, path: string) => line.replace(path, new URL(path, location.href).href))
      }
      // Same origin as the page, so pdf.js starts it as is (and could import it, were workers missing).
      pdfjs.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
    })
    .catch((err: unknown) => {
      workerReady = null
      throw new WorkerUnavailableError(err)
    })
  return workerReady
}

// Downloaded with the app, once the page has settled, rather than on the first open: a page that
// loaded can then open files offline too. If that fails, again when the connection comes back
// (and on the next open).
if (typeof window !== 'undefined' && typeof Worker === 'function') {
  const preload = () => {
    preloadPdfWorker().catch(() => window.addEventListener('online', preload, { once: true }))
  }
  if (typeof requestIdleCallback === 'function') requestIdleCallback(preload, { timeout: 3000 })
  else setTimeout(preload, 1000)
}

/** How long a load that is given up on gets to end its worker politely before it is ended for it. */
const STOP_GRACE_MS = 1000

/**
 * Ends a load, or the document it opened, that is no longer wanted. pdf.js's own destroy() waits
 * for the worker to answer before it ends the worker, so a worker that never answers would live
 * on: if the polite way hasn't finished shortly, end the load's worker directly.
 */
export function stopLoading(task: PDFDocumentLoadingTask): void {
  // Private to pdf.js: each load (no shared worker port is set) has a worker of its own.
  const own = task as unknown as { _worker: { destroy(): void } | null }
  const timer = setTimeout(() => own._worker?.destroy(), STOP_GRACE_MS)
  void task.destroy().then(
    () => clearTimeout(timer),
    () => {},
  )
}

/**
 * Opens a PDF with pdf.js. `bytes` is copied because pdf.js transfers the buffer to its worker.
 * Rejects with PasswordRequiredError when the file needs a (different) password, and with
 * WorkerUnavailableError when pdf.js's worker can't be downloaded (see `preloadPdfWorker`).
 *
 * Aborting `signal` while the file loads stops the load, its worker included (see stopLoading; the
 * promise may then never settle). Once it has settled, the document is the caller's: an abort
 * leaves it alone.
 */
export async function openPdf(bytes: Uint8Array, password?: string, signal?: AbortSignal): Promise<PDFDocumentProxy> {
  signal?.throwIfAborted()
  await preloadPdfWorker()
  signal?.throwIfAborted()
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
  const abort = () => stopLoading(task)
  signal?.addEventListener('abort', abort, { once: true })
  try {
    return await task.promise
  } catch (err) {
    if (passwordError) throw passwordError
    throw err
  } finally {
    signal?.removeEventListener('abort', abort)
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
