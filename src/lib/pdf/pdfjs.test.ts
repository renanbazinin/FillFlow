import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'

// Unit tests load this same pdf.js module (see lib/export/testing/pdfjs.ts), so app code that
// reaches the wrapper must not swap their worker for its browser-only `?url` one.

async function twoPages() {
  const doc = await PDFDocument.create()
  doc.addPage([600, 800])
  doc.addPage([600, 800])
  return doc.save()
}

describe('pdf.js wrapper', () => {
  it('keeps the worker pdf.js picks in Node, and opens PDFs with it', async () => {
    const own = pdfjs.GlobalWorkerOptions.workerSrc
    const app = await import('./pdfjs')
    expect(app.pdfjs.GlobalWorkerOptions).toBe(pdfjs.GlobalWorkerOptions)
    expect(pdfjs.GlobalWorkerOptions.workerSrc).toBe(own)
    const pdf = await app.openPdf(await twoPages())
    expect(pdf.numPages).toBe(2)
    await pdf.loadingTask.destroy()
  })

  it('stops a load given up on, and leaves alone a document it opened', async () => {
    const app = await import('./pdfjs')
    const bytes = await twoPages()
    // Given up on while loading: pdf.js drops the load (and its worker), which then fails.
    const early = new AbortController()
    const loading = app.openPdf(bytes, undefined, early.signal)
    early.abort()
    await expect(loading).rejects.toThrow()
    // Given up on before it starts: no load at all.
    await expect(app.openPdf(bytes, undefined, early.signal)).rejects.toMatchObject({ name: 'AbortError' })
    // Given up on once it has opened (the document is the caller's by then): it stays usable.
    const late = new AbortController()
    const pdf = await app.openPdf(bytes, undefined, late.signal)
    late.abort()
    expect(pdf.loadingTask.destroyed).toBe(false)
    expect((await pdf.getPage(2)).pageNumber).toBe(2)
    await pdf.loadingTask.destroy()
  })

  it('ends the worker of a load whose worker never answers', async () => {
    vi.useFakeTimers()
    try {
      const app = await import('./pdfjs')
      const worker = { destroy: vi.fn() }
      // pdf.js's destroy() waits for the worker first, which here never answers.
      const stuck = { destroy: vi.fn(() => new Promise<void>(() => {})), _worker: worker }
      app.stopLoading(stuck as unknown as Parameters<typeof app.stopLoading>[0])
      expect(stuck.destroy).toHaveBeenCalledOnce()
      expect(worker.destroy).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1000)
      expect(worker.destroy).toHaveBeenCalledOnce()

      // One that ends politely in time is left to pdf.js.
      const polite = { destroy: vi.fn(async () => {}), _worker: { destroy: vi.fn() } }
      app.stopLoading(polite as unknown as Parameters<typeof app.stopLoading>[0])
      await vi.advanceTimersByTimeAsync(1000)
      expect(polite._worker.destroy).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  describe('in a browser', () => {
    const fetchWorker = vi.fn<typeof fetch>()
    /** What the server sends for the worker script (pdf.js's own ends with this export). */
    const worker = () => new Response('export { WorkerMessageHandler }', { status: 200 })
    let own = ''

    beforeEach(() => {
      own = pdfjs.GlobalWorkerOptions.workerSrc
      vi.stubGlobal('Worker', class {})
      vi.stubGlobal('fetch', fetchWorker)
      fetchWorker.mockReset()
      vi.resetModules()
    })

    afterEach(() => {
      vi.unstubAllGlobals()
      pdfjs.GlobalWorkerOptions.workerSrc = own
    })

    it('keeps the worker in memory once downloaded, so files open without the network', async () => {
      fetchWorker.mockImplementation(async () => worker())
      const app = await import('./pdfjs')
      await app.preloadPdfWorker()
      await app.preloadPdfWorker()
      expect(fetchWorker).toHaveBeenCalledTimes(1)
      expect(pdfjs.GlobalWorkerOptions.workerSrc).toMatch(/^blob:/)
    })

    it('never starts a load without it, and downloads it again on the next open', async () => {
      // Offline, then the server no longer has it, then something else answers (a captive portal):
      // pdf.js would fall back to running without a worker for good, and fail every later load.
      fetchWorker
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockResolvedValueOnce(new Response('', { status: 404 }))
        .mockResolvedValueOnce(new Response('<!doctype html><title>Sign in to the Wi-Fi</title>', { status: 200 }))
      const app = await import('./pdfjs')
      const bytes = await twoPages()
      const failures = []
      for (let i = 0; i < 3; i++) failures.push(await app.openPdf(bytes).catch((err: unknown) => err))
      expect(fetchWorker).toHaveBeenCalledTimes(3)
      for (const failure of failures) expect(failure).toBeInstanceOf(app.WorkerUnavailableError)
      // Only the first can work once the connection is back; the others need the page reloaded.
      expect(failures.map((f) => (f as InstanceType<typeof app.WorkerUnavailableError>).network)).toEqual([true, false, false])
      expect(pdfjs.GlobalWorkerOptions.workerSrc).toBe(own)

      // Back online.
      fetchWorker.mockResolvedValueOnce(worker())
      await app.preloadPdfWorker()
      expect(pdfjs.GlobalWorkerOptions.workerSrc).toMatch(/^blob:/)
    })

    it('makes the dev server’s imports work from memory, with code in front of them', async () => {
      // By a path, from a blob: they would not resolve. Imports are hoisted, so code may come first
      // (the e2e tests' older browser adds some), on lines of its own and indented.
      vi.stubGlobal('location', new URL('http://localhost:5173/FillFlow/'))
      const blobs = vi.spyOn(URL, 'createObjectURL')
      try {
        const served = [
          '\n    delete Promise.try;\n  import { injectQuery as __vite__injectQuery } from "/FillFlow/@vite/client";/**',
          ' * @licstart */',
          'import { helper } from "/FillFlow/@id/helper.js";',
          'const load = (url) => import(__vite__injectQuery(url, "import"));',
          'export { WorkerMessageHandler }',
        ].join('\n')
        fetchWorker.mockResolvedValueOnce(new Response(served, { status: 200 }))
        const app = await import('./pdfjs')
        await app.preloadPdfWorker()
        const source = await (blobs.mock.calls[0][0] as Blob).text()
        expect(source).toContain('delete Promise.try;\n  const __vite__injectQuery = (url) => url;/**\n * @licstart */')
        expect(source).toContain('import { helper } from "http://localhost:5173/FillFlow/@id/helper.js";')
        expect(source).not.toContain('"/FillFlow/')
      } finally {
        blobs.mockRestore()
      }
    })
  })

  it('keeps a worker that a test helper set before it loaded', async () => {
    const helper = new URL('../../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url).href
    pdfjs.GlobalWorkerOptions.workerSrc = helper
    vi.resetModules()
    const app = await import('./pdfjs')
    expect(app.pdfjs.GlobalWorkerOptions).toBe(pdfjs.GlobalWorkerOptions)
    expect(pdfjs.GlobalWorkerOptions.workerSrc).toBe(helper)
  })
})
