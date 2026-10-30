import { describe, expect, it } from 'vitest'
import { PDFDocument, degrees } from 'pdf-lib'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PageInfo, PageRotation } from '../../model/types'
import { applyMatrix, exportMatrix, pdfRectToViewRect, pdfToViewPoint, viewRectToPdfRect, viewToPdfPoint } from './geometry'

// pdf.js in Node: run the worker in-process.
pdfjs.GlobalWorkerOptions.workerSrc = new URL('../../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url).href

/** A document with every rotation and an offset crop box on each page. */
async function makeFixture() {
  const doc = await PDFDocument.create()
  for (const rot of [0, 90, 180, 270]) {
    const page = doc.addPage([600, 800])
    page.setCropBox(37, 53, 500, 700)
    page.setRotation(degrees(rot))
  }
  return doc.save()
}

async function loadPages() {
  const bytes = await makeFixture()
  const pdf = await pdfjs.getDocument({ data: bytes }).promise
  const out: { info: PageInfo; viewport: pdfjs.PageViewport }[] = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const viewport = page.getViewport({ scale: 1 })
    const [x0, y0, x1, y1] = page.view
    out.push({
      info: {
        index: i - 1,
        width: viewport.width,
        height: viewport.height,
        rotation: page.rotate as PageRotation,
        view: [x0, y0, x1, y1],
        userUnit: page.userUnit || 1,
      },
      viewport,
    })
  }
  return out
}

describe('geometry', () => {
  it('matches pdf.js PageViewport for every rotation and crop offset', async () => {
    const pages = await loadPages()
    expect(pages.map((p) => p.info.rotation)).toEqual([0, 90, 180, 270])
    for (const { info, viewport } of pages) {
      for (const [px, py] of [[37, 53], [500, 700], [123.5, 456.25], [400, 60]]) {
        const [vx, vy] = viewport.convertToViewportPoint(px, py)
        const mine = pdfToViewPoint(info, { x: px, y: py })
        expect(mine.x).toBeCloseTo(vx, 6)
        expect(mine.y).toBeCloseTo(vy, 6)
        const back = viewToPdfPoint(info, mine)
        expect(back.x).toBeCloseTo(px, 6)
        expect(back.y).toBeCloseTo(py, 6)
      }
    }
  })

  it('round-trips rects', async () => {
    const pages = await loadPages()
    for (const { info } of pages) {
      const r = { x: 10, y: 20, width: 30, height: 40 }
      const pdfRect = viewRectToPdfRect(info, r)
      const back = pdfRectToViewRect(info, pdfRect)
      expect(back.x).toBeCloseTo(r.x)
      expect(back.y).toBeCloseTo(r.y)
      expect(back.width).toBeCloseTo(r.width)
      expect(back.height).toBeCloseTo(r.height)
    }
  })

  it('exportMatrix maps the y-up local frame onto the same PDF points', async () => {
    const pages = await loadPages()
    for (const { info } of pages) {
      const m = exportMatrix(info)
      for (const v of [{ x: 0, y: 0 }, { x: info.width, y: info.height }, { x: 12, y: 345 }]) {
        // local frame: u = viewX, w = pageHeight - viewY
        const viaMatrix = applyMatrix(m, { x: v.x, y: info.height - v.y })
        const direct = viewToPdfPoint(info, v)
        expect(viaMatrix.x).toBeCloseTo(direct.x, 6)
        expect(viaMatrix.y).toBeCloseTo(direct.y, 6)
      }
    }
  })
})
