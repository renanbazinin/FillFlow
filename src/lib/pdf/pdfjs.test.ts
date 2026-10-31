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

  it('keeps a worker that a test helper set before it loaded', async () => {
    const helper = new URL('../../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url).href
    pdfjs.GlobalWorkerOptions.workerSrc = helper
    vi.resetModules()
    const app = await import('./pdfjs')
    expect(app.pdfjs.GlobalWorkerOptions).toBe(pdfjs.GlobalWorkerOptions)
    expect(pdfjs.GlobalWorkerOptions.workerSrc).toBe(helper)
  })
})
