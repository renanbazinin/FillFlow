import { describe, expect, it } from 'vitest'
import type { PDFDocumentProxy } from '../../lib/pdf/pdfjs'
import { retainPage } from './pageRender'

/** Stands in for a pdf.js document; records which pages (0-based) got `page.cleanup()`. */
function fakePdf() {
  const cleanups: number[] = []
  const pdf = { getPage: (n: number) => Promise.resolve({ cleanup: () => void cleanups.push(n - 1) }) }
  return { pdf: pdf as unknown as PDFDocumentProxy, cleanups }
}

const settle = () => new Promise((r) => setTimeout(r, 0))

describe('retainPage', () => {
  it('frees a page that only a thumbnail rendered', async () => {
    const { pdf, cleanups } = fakePdf()
    const release = retainPage(pdf, 4)
    await settle()
    expect(cleanups).toEqual([])
    release()
    await settle()
    expect(cleanups).toEqual([4])
  })

  it('keeps a page while the document view still uses it', async () => {
    const { pdf, cleanups } = fakePdf()
    const view = retainPage(pdf, 2)
    const thumbnail = retainPage(pdf, 2)
    thumbnail()
    await settle()
    expect(cleanups).toEqual([])
    view()
    await settle()
    expect(cleanups).toEqual([2])
  })

  it('counts a repeated release once', async () => {
    const { pdf, cleanups } = fakePdf()
    const view = retainPage(pdf, 0)
    const thumbnail = retainPage(pdf, 0)
    thumbnail()
    thumbnail()
    await settle()
    expect(cleanups).toEqual([])
    view()
    await settle()
    expect(cleanups).toEqual([0])
  })

  it('skips the cleanup when the page is used again before pdf.js hands it out', async () => {
    const { pdf, cleanups } = fakePdf()
    retainPage(pdf, 1)()
    const again = retainPage(pdf, 1)
    await settle()
    expect(cleanups).toEqual([])
    again()
    await settle()
    expect(cleanups).toEqual([1])
  })

  it('counts per document and per page', async () => {
    const a = fakePdf()
    const b = fakePdf()
    const keep = retainPage(a.pdf, 0)
    retainPage(b.pdf, 0)()
    retainPage(a.pdf, 1)()
    await settle()
    expect(a.cleanups).toEqual([1])
    expect(b.cleanups).toEqual([0])
    keep()
    await settle()
    expect(a.cleanups).toEqual([1, 0])
  })

  it('ignores a document that was closed meanwhile', async () => {
    const pdf = { getPage: () => Promise.reject(new Error('Transport destroyed')) } as unknown as PDFDocumentProxy
    retainPage(pdf, 0)()
    await settle()
  })
})
