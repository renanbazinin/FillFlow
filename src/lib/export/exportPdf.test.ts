import { PDFArray, PDFDocument } from 'pdf-lib'
import { describe, expect, it, vi } from 'vitest'
import type { Element, TextElement } from '../../model/types'
import { layoutTextBlock } from '../text/layout'
import { renderPdf } from './engine'
import { ExportError } from './errors'
import { debugWrite } from './testing/debug'
import { buildPdf, type PageSpec } from './testing/fixtures'
import { fontkitMeasurer } from './testing/fonts'
import { makeInput, makeText, testDeps } from './testing/helpers'
import { openPdfjs, readPages, renderPage, textInView } from './testing/pdfjs'

const GEOMETRY: PageSpec[] = [
  { size: [600, 800], crop: [37, 53, 463, 647], content: 'BT /F1 9 Tf 40 60 Td (orig-0) Tj ET' },
  { size: [600, 800], crop: [37, 53, 463, 647], rotate: 90, content: 'BT /F1 9 Tf 40 60 Td (orig-90) Tj ET' },
  { size: [612, 792], crop: [10, 20, 500, 700], rotate: 180, content: 'BT /F1 9 Tf 40 60 Td (orig-180) Tj ET' },
  { size: [842, 595], crop: [30, 40, 700, 500], rotate: 270, content: 'BT /F1 9 Tf 40 60 Td (orig-270) Tj ET' },
  { size: [300, 400], userUnit: 2, content: 'BT /F1 9 Tf 10 10 Td (orig-uu) Tj ET' },
  // Original content that leaves a scaled CTM (inside unclosed q's) and an open text object.
  { size: [400, 400], content: 'q 0.5 0 0 0.5 0 0 cm q 3 0 0 3 0 0 cm 0 0 1 rg 1 1 10 10 re f BT /F1 9 Tf 1 1 Td (dirty) Tj' },
  // A CTM change without any q.
  { size: [400, 400], content: '2 0 0 2 0 0 cm 0 1 0 rg 0 0 10 10 re f' },
]

describe('exportPdf: geometry', () => {
  it('lands text baselines where the editor shows them on every page geometry', async () => {
    const bytes = await buildPdf(GEOMETRY)
    const pages = await readPages(bytes)
    expect(pages.map((p) => p.rotation)).toEqual([0, 90, 180, 270, 0, 0, 0])
    const elements: Element[] = []
    pages.forEach((p, i) => {
      elements.push(makeText(i, 30, 40, `Top left ${i}`, { fontSize: 14 }))
      elements.push(makeText(i, p.width - 160, p.height - 70, `Centre ${i}\nsecond line ${i}`, { fontSize: 11, align: 'center' }))
      elements.push(makeText(i, 50, p.height / 2, `Right ${i}\nr${i}`, { fontSize: 9, align: 'right', fontId: 'serif', bold: true }))
      elements.push(makeText(i, 60, p.height / 2 + 40, `Mono ${i}`, { fontSize: 10, fontId: 'mono', letterSpacing: 3 }))
    })
    const out = await renderPdf(makeInput(bytes, pages, elements), testDeps)
    await debugWrite('geometry.pdf', out)

    const pdf = await openPdfjs(out)
    for (let i = 0; i < pages.length; i++) {
      const items = await textInView(pdf, i + 1)
      // The page's own content is still there.
      expect(items.some((it) => it.str.startsWith('orig') || it.str === 'dirty' || i === 6)).toBe(true)
      for (const el of elements.filter((e): e is TextElement => e.page === i && e.kind === 'text')) {
        const layout = layoutTextBlock(el.text, el, el.align, fontkitMeasurer)
        for (const line of layout.lines) {
          const baseline = el.y + line.baseline
          // pdf.js may split letter-spaced lines into several items: gather the line's items.
          const parts = items
            .filter((it) => Math.abs(it.y - baseline) < 0.5 && it.x > el.x - 1 && it.x < el.x + el.width + 1)
            .sort((a, b) => a.x - b.x)
          const joined = parts.map((it) => it.str).join('').replace(/\s+/g, '')
          expect(joined, `page ${i}: "${line.text}"`).toBe(line.text.replace(/\s+/g, ''))
          const first = parts[0]
          expect(Math.abs(first.x - (el.x + line.x)), `x of "${line.text}" on page ${i}`).toBeLessThan(0.5)
          // Upright and left-to-right as displayed, at the element's size.
          expect(first.dx).toBeCloseTo(1, 3)
          expect(first.dy).toBeCloseTo(0, 3)
          expect(first.size).toBeCloseTo(el.fontSize, 2)
        }
      }
    }
    await pdf.loadingTask.destroy()
  })

  it('keeps letter-spaced text exactly as wide as the editor lays it out', async () => {
    const bytes = await buildPdf([{ size: [400, 300] }])
    const pages = await readPages(bytes)
    const el = makeText(0, 40, 60, '12345678', { fontSize: 16, fontId: 'mono', letterSpacing: 9 })
    const out = await renderPdf(makeInput(bytes, pages, [el]), testDeps)
    const pdf = await openPdfjs(out)
    const raster = await renderPage(pdf, 1, 4)
    const ink = raster.bbox((r, g, b) => r + g + b < 300)!
    // The last glyph's ink ends one letter-space before the block's right edge.
    const last = layoutTextBlock(el.text, el, el.align, fontkitMeasurer).lines[0]
    expect(Math.abs(ink.x + ink.width - (el.x + last.width - el.letterSpacing))).toBeLessThan(2.5)
    expect(ink.x).toBeGreaterThan(el.x)
    expect(ink.x).toBeLessThan(el.x + 3)
    await pdf.loadingTask.destroy()
  })

  it('does not touch pages without elements', async () => {
    const bytes = await buildPdf([{ size: [300, 300], content: 'q 2 0 0 2 0 0 cm' }, { size: [300, 300] }])
    const pages = await readPages(bytes)
    const out = await renderPdf(makeInput(bytes, pages, [makeText(1, 10, 10, 'only page 2')]), testDeps)
    const doc = await PDFDocument.load(out)
    const contents = doc.getPage(0).node.Contents()
    expect(contents instanceof PDFArray ? contents.size() : 1).toBe(1)
    expect((doc.getPage(1).node.Contents() as PDFArray).size()).toBeGreaterThan(1)
  })
})

describe('exportPdf: right-to-left and mixed text', () => {
  const CASES = ['שלום עולם', 'שלום Hello', 'Hello שלום world', 'מספר 123.', 'טלפון: 03-1234567', '(שלום)', 'שָׁלוֹם', 'éte']

  it('extracts Hebrew and mixed lines in logical order where pdf.js can recover it', async () => {
    const bytes = await buildPdf([{ size: [500, 700] }])
    const pages = await readPages(bytes)
    const elements = CASES.map((s, i) => makeText(0, 40, 40 + i * 50, s, { fontSize: 18 }))
    const out = await renderPdf(makeInput(bytes, pages, elements), testDeps)
    await debugWrite('hebrew.pdf', out)
    const pdf = await openPdfjs(out)
    const items = await textInView(pdf, 1)
    const at = (i: number) => items.filter((it) => Math.abs(it.y - (elements[i].y + layoutTextBlock(CASES[i], elements[i], 'left', fontkitMeasurer).lines[0].baseline)) < 0.5)
    for (const i of [0, 1, 2, 3]) {
      expect(at(i).map((it) => it.str).join(''), CASES[i]).toBe(CASES[i])
    }
    // pdf.js classifies this one as LTR, so it reports the (correct) visual order.
    expect(at(4).map((it) => it.str).join('')).toBe('03-1234567 :טלפון')
    // Every line starts at the element's left edge.
    for (let i = 0; i < CASES.length; i++) {
      const xs = at(i).map((it) => it.x)
      expect(Math.min(...xs), CASES[i]).toBeCloseTo(elements[i].x, 1)
    }
    await pdf.loadingTask.destroy()
  })

  it('places RTL runs at their measured visual offsets', async () => {
    const bytes = await buildPdf([{ size: [400, 200] }])
    const pages = await readPages(bytes)
    // LTR paragraph: "Hello " + RTL run + " world" — the RTL run must sit right after "Hello ".
    const el = makeText(0, 30, 50, 'Hello שלום world', { fontSize: 20 })
    const out = await renderPdf(makeInput(bytes, pages, [el]), testDeps)
    const pdf = await openPdfjs(out)
    const items = await textInView(pdf, 1)
    const hebrew = items.find((it) => it.str.includes('שלום'))!
    const helloWidth = fontkitMeasurer('Hello ', 'sans', false, 20)
    // pdf.js may merge runs into one item; if the Hebrew run is separate, check its origin.
    if (!hebrew.str.startsWith('Hello')) expect(Math.abs(hebrew.x - (el.x + helloWidth))).toBeLessThan(0.5)
    else expect(hebrew.x).toBeCloseTo(el.x, 1)
    await pdf.loadingTask.destroy()
  })
})

describe('exportPdf: document handling', () => {
  it('stamps the producer and keeps the original metadata', async () => {
    const bytes = await buildPdf([{ size: [200, 200] }], { title: 'Tax form 2026', author: 'Jane' })
    const pages = await readPages(bytes)
    const out = await renderPdf(makeInput(bytes, pages, [makeText(0, 10, 10, 'x')]), testDeps)
    const pdf = await openPdfjs(out)
    const { info } = (await pdf.getMetadata()) as { info: Record<string, unknown> }
    expect(info.Producer).toBe('FillFlow')
    expect(info.Title).toBe('Tax form 2026')
    expect(info.Author).toBe('Jane')
    await pdf.loadingTask.destroy()
  })

  it('reports progress per page and can be cancelled', async () => {
    const bytes = await buildPdf([{ size: [200, 200] }, { size: [200, 200] }, { size: [200, 200] }])
    const pages = await readPages(bytes)
    const elements = [0, 1, 2].map((p) => makeText(p, 10, 10, `p${p}`))
    const progress = vi.fn()
    await renderPdf(makeInput(bytes, pages, elements), { ...testDeps, onProgress: progress })
    const phases = progress.mock.calls.map(([p]) => p.phase)
    expect(phases[0]).toBe('prepare')
    expect(phases.filter((p) => p === 'pages')).toHaveLength(3)
    expect(phases.at(-1)).toBe('save')

    const ctrl = new AbortController()
    const run = renderPdf(makeInput(bytes, pages, elements), {
      ...testDeps,
      onProgress: (p) => {
        if (p.phase === 'pages' && p.done === 1) ctrl.abort()
      },
      signal: ctrl.signal,
    })
    await expect(run).rejects.toMatchObject({ name: 'ExportError', code: 'aborted' })
  })

  it('rewrites files pdf-lib cannot parse through the repair hook', async () => {
    const good = await buildPdf([{ size: [200, 200] }])
    const pages = await readPages(good)
    const broken = new TextEncoder().encode('%PDF-1.7\nthis is not a pdf')
    const repair = vi.fn(async () => ({ bytes: good }))
    const out = await renderPdf(makeInput(broken, pages, [makeText(0, 10, 10, 'fixed')]), { ...testDeps, repair })
    expect(repair).toHaveBeenCalledOnce()
    const pdf = await openPdfjs(out)
    expect((await textInView(pdf, 1)).map((t) => t.str)).toContain('fixed')
    await pdf.loadingTask.destroy()

    await expect(renderPdf(makeInput(broken, pages, []), testDeps)).rejects.toMatchObject({ code: 'damaged' })
  })

  it('skips elements on missing pages and images without assets', async () => {
    const bytes = await buildPdf([{ size: [200, 200] }])
    const pages = await readPages(bytes)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const out = await renderPdf(
      makeInput(bytes, pages, [
        makeText(3, 10, 10, 'ghost'),
        { id: 'img', kind: 'image', page: 0, x: 0, y: 0, width: 10, height: 10, role: 'image', assetId: 'nope', opacity: 1 },
        makeText(0, 10, 10, '   '),
      ]),
      testDeps,
    )
    warn.mockRestore()
    const pdf = await openPdfjs(out)
    expect(pdf.numPages).toBe(1)
    await pdf.loadingTask.destroy()
  })

  it('fails with a clear error when fonts cannot be loaded', async () => {
    const bytes = await buildPdf([{ size: [200, 200] }])
    const pages = await readPages(bytes)
    const run = renderPdf(makeInput(bytes, pages, [makeText(0, 10, 10, 'x')]), {
      ...testDeps,
      loadFontBytes: async () => {
        throw new Error('offline')
      },
    })
    await expect(run).rejects.toBeInstanceOf(ExportError)
    await expect(run).rejects.toMatchObject({ code: 'fonts' })
  })
})
