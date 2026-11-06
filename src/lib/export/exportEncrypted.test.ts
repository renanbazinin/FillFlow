import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { looksEncrypted, renderPdf } from './engine'
import { ExportError } from './errors'
import { debugWrite } from './testing/debug'
import { buildPdf, encryptPdf } from './testing/fixtures'
import { makeInput, makeText, testDeps } from './testing/helpers'
import { openPdfjs, pdfjsDecrypt, readPages, textInView } from './testing/pdfjs'

async function securedFixture(user?: string) {
  const plain = await buildPdf(
    [
      { size: [400, 500], rotate: 90, content: 'BT /F1 12 Tf 30 30 Td (Original secret text) Tj ET' },
      { size: [300, 300], content: 'q 2 0 0 2 0 0 cm BT /F1 8 Tf 5 5 Td (page two) Tj ET' },
    ],
    { title: 'Confidential form', author: 'Records office', form: true },
  )
  return encryptPdf(plain, { owner: 'owner-secret', user })
}

describe('exportPdf: encrypted input', () => {
  it('builds a real RC4 fixture that pdf-lib refuses and pdf.js opens', async () => {
    const bytes = await securedFixture()
    expect(looksEncrypted(bytes)).toBe(true)
    await expect(PDFDocument.load(bytes)).rejects.toThrow(/encrypted/i)
    const pdf = await openPdfjs(bytes)
    expect((await textInView(pdf, 1)).map((t) => t.str)).toContain('Original secret text')
    await pdf.loadingTask.destroy()
  })

  it('exports an unencrypted, complete copy through pdf.js', async () => {
    const bytes = await securedFixture()
    const pages = await readPages(bytes)
    const elements = [makeText(0, 40, 60, 'Filled on page 1', { fontSize: 14 }), makeText(1, 20, 30, 'שלום page 2')]
    const out = await renderPdf(makeInput(bytes, pages, elements, { options: { flattenForms: false } }), {
      ...testDeps,
      decrypt: pdfjsDecrypt(),
    })
    await debugWrite('decrypted.pdf', out)

    const doc = await PDFDocument.load(out, { updateMetadata: false })
    expect(doc.isEncrypted).toBe(false)
    expect(doc.getPageCount()).toBe(2)
    // AcroForm survived the rewrite.
    expect(doc.getForm().getFields().map((f) => f.getName()).sort()).toEqual(['agree', 'name'])
    expect(doc.getTitle()).toBe('Confidential form')
    expect(doc.getAuthor()).toBe('Records office')
    expect(doc.getProducer()).toBe('FillFlow')
    expect(doc.getCreator()).not.toBe('PDF.js')

    const pdf = await openPdfjs(out)
    const [p1, p2] = [await textInView(pdf, 1), await textInView(pdf, 2)]
    expect(p1.map((t) => t.str)).toEqual(expect.arrayContaining(['Original secret text', 'Filled on page 1']))
    expect(p2.map((t) => t.str)).toEqual(expect.arrayContaining(['page two', 'שלום page 2']))
    // Geometry is unchanged by the rewrite: overlays still land on their baselines.
    const filled = p1.find((t) => t.str === 'Filled on page 1')!
    expect(filled.x).toBeCloseTo(40, 1)
    expect(Math.abs(filled.y - (60 + 14 * 0.9467))).toBeLessThan(0.5)
    expect(filled.dx).toBeCloseTo(1, 3)
    await pdf.loadingTask.destroy()
  })

  it('works for files that need a user password (opened by the app with it)', async () => {
    const bytes = await securedFixture('letmein')
    const pages = await readPages(bytes, 'letmein')
    const out = await renderPdf(makeInput(bytes, pages, [makeText(0, 40, 60, 'Unlocked')]), {
      ...testDeps,
      decrypt: pdfjsDecrypt('letmein'),
    })
    const pdf = await openPdfjs(out)
    expect((await textInView(pdf, 1)).map((t) => t.str)).toContain('Unlocked')
    await pdf.loadingTask.destroy()
  })

  it('fails with a clear "encrypted" error when it cannot decrypt', async () => {
    const bytes = await securedFixture()
    const pages = await readPages(bytes)
    const noDecrypt = renderPdf(makeInput(bytes, pages, [makeText(0, 10, 10, 'x')]), testDeps)
    await expect(noDecrypt).rejects.toBeInstanceOf(ExportError)
    await expect(noDecrypt).rejects.toMatchObject({ code: 'encrypted' })

    const failing = renderPdf(makeInput(bytes, pages, []), {
      ...testDeps,
      decrypt: async () => {
        throw new Error('worker crashed')
      },
    })
    await expect(failing).rejects.toMatchObject({ code: 'encrypted' })

    // A "decrypted" copy that is still encrypted (or incomplete) is rejected, not written.
    const stillEncrypted = renderPdf(makeInput(bytes, pages, []), { ...testDeps, decrypt: async () => ({ bytes }) })
    await expect(stillEncrypted).rejects.toMatchObject({ code: 'encrypted' })
  })
})
