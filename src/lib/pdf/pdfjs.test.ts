import { describe, expect, it, vi } from 'vitest'
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

  it('keeps a worker that a test helper set before it loaded', async () => {
    const helper = new URL('../../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url).href
    pdfjs.GlobalWorkerOptions.workerSrc = helper
    vi.resetModules()
    const app = await import('./pdfjs')
    expect(app.pdfjs.GlobalWorkerOptions).toBe(pdfjs.GlobalWorkerOptions)
    expect(pdfjs.GlobalWorkerOptions.workerSrc).toBe(helper)
  })
})
