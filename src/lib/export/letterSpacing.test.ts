import { describe, expect, it } from 'vitest'
import type { Element } from '../../model/types'
import { charCount, layoutTextBlock } from '../text/layout'
import { renderPdf } from './engine'
import { buildPdf } from './testing/fixtures'
import { fontkitMeasurer } from './testing/fonts'
import { makeInput, makeText, testDeps } from './testing/helpers'
import { openPdfjs, pdfjs, readPages, renderPage, type Raster } from './testing/pdfjs'

/** "שָׁלוֹם" in canonical order: shin + qamats + shin dot, lamed, vav + holam, final mem. */
const SHALOM = '\u05E9\u05B8\u05C1\u05DC\u05D5\u05B9\u05DD'

/** Ink bounding box (view space) inside a region of the page. */
function inkBox(raster: Raster, x: number, y: number, w: number, h: number) {
  const { scale, width, data } = raster
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (let yy = Math.floor(y * scale); yy < Math.ceil((y + h) * scale); yy++) {
    for (let xx = Math.floor(x * scale); xx < Math.ceil((x + w) * scale); xx++) {
      const i = (yy * width + xx) * 4
      if (data[i] + data[i + 1] + data[i + 2] > 600) continue
      minX = Math.min(minX, xx)
      maxX = Math.max(maxX, xx + 1)
      minY = Math.min(minY, yy)
      maxY = Math.max(maxY, yy + 1)
    }
  }
  if (maxX < 0) return null
  return { x: minX / scale, y: minY / scale, width: (maxX - minX) / scale, height: (maxY - minY) / scale }
}

/** Exports the elements onto one 500×400 page and renders it. */
async function render(elements: Element[]) {
  const bytes = await buildPdf([{ size: [500, 400] }])
  const pages = await readPages(bytes)
  const out = await renderPdf(makeInput(bytes, pages, elements), testDeps)
  const pdf = await openPdfjs(out)
  const raster = await renderPage(pdf, 1, 4)
  const ops = (await (await pdf.getPage(1)).getOperatorList()).fnArray
  await pdf.loadingTask.destroy()
  return { raster, ops }
}

describe('exportPdf: letter spacing', () => {
  it('does not carry over to text drawn after a letter-spaced element', async () => {
    const spaced = makeText(0, 40, 40, '1234', { fontSize: 16, letterSpacing: 12 })
    const plain = makeText(0, 40, 120, 'Hello world', { fontSize: 16 })
    const alone = await render([plain])
    const after = await render([spaced, plain])
    const a = inkBox(alone.raster, 0, 110, 500, 40)!
    const b = inkBox(after.raster, 0, 110, 500, 40)!
    expect(b.x).toBeCloseTo(a.x, 1)
    expect(b.width).toBeCloseTo(a.width, 1)
    // Spacing is part of the glyph positioning; character spacing (Tc) is never set.
    expect(after.ops).not.toContain(pdfjs.OPS.setCharSpacing)
  })

  it('keeps combining marks and niqqud on their letters', async () => {
    for (const text of ['e\u0301', '\u05E9\u05B8\u05C1']) {
      const tight = await render([makeText(0, 100, 100, text, { fontSize: 40 })])
      const spaced = await render([makeText(0, 100, 100, text, { fontSize: 40, letterSpacing: 30 })])
      const a = inkBox(tight.raster, 0, 0, 500, 400)!
      const b = inkBox(spaced.raster, 0, 0, 500, 400)!
      expect(b.x, text).toBeCloseTo(a.x, 1)
      expect(b.width, text).toBeCloseTo(a.width, 1)
    }
  })

  it('spaces whole letters, as wide as the editor lays the text out', async () => {
    for (const text of [SHALOM, 'e\u0301te']) {
      const tight = makeText(0, 100, 100, text, { fontSize: 40 })
      const spaced = makeText(0, 100, 100, text, { fontSize: 40, letterSpacing: 8 })
      const a = inkBox((await render([tight])).raster, 0, 0, 500, 400)!
      const b = inkBox((await render([spaced])).raster, 0, 0, 500, 400)!
      // Spacing goes between the clusters (the one after the last letter is blank).
      expect(b.width - a.width, text).toBeCloseTo(8 * (charCount(text) - 1), 0)
      const layout = layoutTextBlock(text, spaced, 'left', fontkitMeasurer)
      expect(layout.width - layoutTextBlock(text, tight, 'left', fontkitMeasurer).width).toBeCloseTo(8 * charCount(text))
      expect(b.x + b.width).toBeLessThan(spaced.x + layout.width - 8 + 1)
    }
  })

  it('draws the shin dot on the shin when a vowel comes first', async () => {
    const shin = inkBox((await render([makeText(0, 100, 100, '\u05E9', { fontSize: 80 })])).raster, 0, 0, 500, 400)!
    const pointed = inkBox((await render([makeText(0, 100, 100, '\u05E9\u05B8\u05C1', { fontSize: 80 })])).raster, 0, 0, 500, 400)!
    // The dot sits over the right arm, inside the letter's extent (not to its left).
    expect(pointed.x).toBeGreaterThan(shin.x - 0.5)
    expect(pointed.x + pointed.width).toBeLessThan(shin.x + shin.width + 0.5)
  })
})
