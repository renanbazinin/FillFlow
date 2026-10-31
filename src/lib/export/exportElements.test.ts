import { describe, expect, it, vi } from 'vitest'
import { HIGHLIGHT_COLOR, HIGHLIGHT_OPACITY } from '../../model/elements'
import type { Asset, Element, ImageElement, InkElement, MarkElement, ShapeElement } from '../../model/types'
import { renderPdf } from './engine'
import { debugWrite } from './testing/debug'
import { buildPdf } from './testing/fixtures'
import { makeInput, makeText, testDeps } from './testing/helpers'
import { openPdfjs, pdfjs, readPages, renderPage, textInView, type PdfjsProxy } from './testing/pdfjs'

/** @napi-rs/canvas ships with pdfjs-dist (optional) and lets us encode real PNG/JPEG files. */
type NapiCanvas = {
  createCanvas(w: number, h: number): {
    getContext(t: '2d'): CanvasRenderingContext2D
    toBuffer(mime: 'image/png' | 'image/jpeg', quality?: number): Uint8Array
  }
}
const napi: NapiCanvas | null = await import(/* @vite-ignore */ `@napi-rs/${'canvas'}`).catch(() => null)

function encode(width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void, mime: 'image/png' | 'image/jpeg'): Uint8Array {
  const canvas = napi!.createCanvas(width, height)
  draw(canvas.getContext('2d'))
  return new Uint8Array(canvas.toBuffer(mime, 100))
}

const toDataUrl = (bytes: Uint8Array, mime: string) => `data:${mime};base64,${btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''))}`

/** Inserts an EXIF APP1 segment with the given orientation right after SOI. */
function withExifOrientation(jpeg: Uint8Array, orientation: number): Uint8Array {
  const tiff = [0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0, 0, 0, 0, 0, 0, 0]
  const payload = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff]
  const len = payload.length + 2
  const app1 = [0xff, 0xe1, len >> 8, len & 255, ...payload]
  const out = new Uint8Array(jpeg.length + app1.length)
  out.set(jpeg.subarray(0, 2), 0)
  out.set(app1, 2)
  out.set(jpeg.subarray(2), 2 + app1.length)
  return out
}

const shape = (id: string, props: Partial<ShapeElement>): ShapeElement => ({
  id,
  kind: 'shape',
  page: 0,
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  shape: 'rect',
  strokeColor: null,
  fillColor: null,
  strokeWidth: 0,
  opacity: 1,
  ...props,
})

const near = (a: number[], b: number[], tol = 24) => a.slice(0, 3).every((v, i) => Math.abs(v - b[i]) <= tol)

async function exportAndRender(elements: Element[], assets: Record<string, Asset> = {}, content = '') {
  const bytes = await buildPdf([{ size: [400, 400], content }])
  const pages = await readPages(bytes)
  const out = await renderPdf(makeInput(bytes, pages, elements, { assets }), testDeps)
  const pdf = await openPdfjs(out)
  const raster = await renderPage(pdf, 1, 4)
  return { out, pdf, raster }
}

async function operators(pdf: PdfjsProxy) {
  const page = await pdf.getPage(1)
  const list = await page.getOperatorList()
  return list.fnArray
}

describe('exportPdf: marks', () => {
  it('draws ✓ ✗ • with the editor outlines, scaled into the element box', async () => {
    const marks: MarkElement[] = [
      { id: 'c', kind: 'mark', page: 0, x: 40, y: 40, width: 48, height: 48, shape: 'check', color: '#111827' },
      { id: 'x', kind: 'mark', page: 0, x: 140, y: 40, width: 24, height: 24, shape: 'cross', color: '#c81e1e' },
      { id: 'd', kind: 'mark', page: 0, x: 240, y: 40, width: 24, height: 24, shape: 'dot', color: '#1d4ed8' },
    ]
    const { pdf, raster, out } = await exportAndRender(marks)
    await debugWrite('marks.pdf', out)
    const dark = (r: number, g: number, b: number) => r + g + b < 200
    // check path spans x 3.4–20.6, y 5.3–18.8 of 24 units.
    const check = raster.bbox((r, g, b) => dark(r, g, b))!
    const s = 48 / 24
    expect(check.x).toBeCloseTo(40 + 3.4 * s, 0)
    expect(check.y).toBeCloseTo(40 + 5.3 * s, 0)
    expect(check.x + check.width).toBeCloseTo(40 + 20.6 * s, 0)
    expect(check.y + check.height).toBeCloseTo(40 + 18.8 * s, 0)
    // cross spans 5.3–18.7 both ways, dot is a radius-5 circle centred at 12,12.
    const cross = raster.bbox((r, g, b) => r > 150 && g < 80 && b < 80)!
    expect(cross.x).toBeCloseTo(140 + 5.3, 0)
    expect(cross.y + cross.height).toBeCloseTo(40 + 18.7, 0)
    const dot = raster.bbox((r, _g, b) => b > 150 && r < 80)!
    expect(dot.x + dot.width / 2).toBeCloseTo(252, 0)
    expect(dot.y + dot.height / 2).toBeCloseTo(52, 0)
    expect(dot.width).toBeCloseTo(10, 0)
    expect((await operators(pdf)).filter((op) => op === pdfjs.OPS.constructPath).length).toBeGreaterThanOrEqual(3)
    await pdf.loadingTask.destroy()
  })
})

describe('exportPdf: shapes', () => {
  it('keeps rect/ellipse strokes inside the box (inset convention)', async () => {
    const { raster, pdf } = await exportAndRender([
      shape('r', { x: 40, y: 40, width: 100, height: 60, strokeColor: '#ff0000', strokeWidth: 6 }),
      shape('e', { shape: 'ellipse', x: 200, y: 40, width: 100, height: 60, strokeColor: '#ff0000', strokeWidth: 6 }),
      shape('f', { x: 40, y: 200, width: 50, height: 50, fillColor: '#0000ff', strokeColor: '#ff0000', strokeWidth: 4 }),
    ])
    const red = [255, 0, 0]
    // Stroke band of the rect is [40, 46] on the left edge; outside stays white.
    expect(near(raster.at(43, 70), red)).toBe(true)
    expect(near(raster.at(38.5, 70), [255, 255, 255])).toBe(true)
    expect(near(raster.at(47.5, 70), [255, 255, 255])).toBe(true)
    expect(near(raster.at(137, 70), red)).toBe(true)
    expect(near(raster.at(141.5, 70), [255, 255, 255])).toBe(true)
    // Ellipse: leftmost point of the stroke at x ≈ 200..206 at mid-height.
    expect(near(raster.at(203, 70), red)).toBe(true)
    expect(near(raster.at(198.5, 70), [255, 255, 255])).toBe(true)
    expect(near(raster.at(250, 70), [255, 255, 255])).toBe(true)
    // Filled + stroked: fill inside, stroke in the outer 4pt.
    expect(near(raster.at(65, 225), [0, 0, 255])).toBe(true)
    expect(near(raster.at(41.5, 225), red)).toBe(true)
    await pdf.loadingTask.destroy()
  })

  it('draws a shape narrower than its border as a solid shape inside its box', async () => {
    const { raster, pdf } = await exportAndRender([
      shape('r', { x: 50, y: 50, width: 4, height: 80, strokeColor: '#ff0000', strokeWidth: 8 }),
      shape('e', { shape: 'ellipse', x: 150, y: 50, width: 4, height: 80, strokeColor: '#ff0000', strokeWidth: 8 }),
      shape('w', { x: 50, y: 300, width: 200, height: 4, strokeColor: '#ff0000', fillColor: '#0000ff', strokeWidth: 8 }),
    ])
    const red = [255, 0, 0]
    const isRed = (r: number, g: number, b: number) => r > 200 && g < 80 && b < 80
    expect(near(raster.at(52, 90), red)).toBe(true)
    expect(near(raster.at(152, 90), red)).toBe(true)
    expect(near(raster.at(150, 302), red)).toBe(true)
    // Nothing spills out of the boxes (the stroke used to be centred on a zero-width path).
    const box = raster.bbox(isRed)!
    expect(box.x).toBeGreaterThan(49.5)
    expect(box.x + box.width).toBeLessThan(250.5)
    expect(near(raster.at(56, 90), [255, 255, 255])).toBe(true)
    expect(near(raster.at(156, 90), [255, 255, 255])).toBe(true)
    expect(near(raster.at(150, 306), [255, 255, 255])).toBe(true)
    await pdf.loadingTask.destroy()
  })

  it('draws lines corner to corner (and flipped) with round caps', async () => {
    const { raster, pdf } = await exportAndRender([
      shape('a', { shape: 'line', x: 40, y: 40, width: 100, height: 100, strokeColor: '#000000', strokeWidth: 4 }),
      shape('b', { shape: 'line', x: 200, y: 40, width: 100, height: 100, strokeColor: '#000000', strokeWidth: 4, flip: true }),
      shape('h', { shape: 'line', x: 40, y: 300, width: 200, height: 0, strokeColor: '#000000', strokeWidth: 4 }),
    ])
    expect(raster.inkIn(41, 41, 3, 3)).toBeGreaterThan(0.5)
    expect(raster.inkIn(137, 137, 2, 2)).toBeGreaterThan(0.5)
    expect(raster.inkIn(137, 41, 2, 2)).toBe(0)
    expect(raster.inkIn(201, 137, 2, 2)).toBeGreaterThan(0.5)
    expect(raster.inkIn(201, 41, 3, 3)).toBe(0)
    // Round caps extend half the width past the end points.
    expect(raster.inkIn(38.6, 299.5, 0.8, 1)).toBeGreaterThan(0.5)
    expect(raster.inkIn(240.6, 299.5, 0.8, 1)).toBeGreaterThan(0.5)
    expect(raster.inkIn(243, 299.5, 1, 1)).toBe(0)
    await pdf.loadingTask.destroy()
  })

  it('multiplies highlights so text shows through, and whiteout covers content', async () => {
    // Original content: a black bar at view (50..150, 60..70) and one at (250..350, 60..70).
    const content = '0 0 0 rg 50 330 100 10 re f 250 330 100 10 re f'
    const { raster, pdf } = await exportAndRender(
      [
        shape('hl', { x: 40, y: 50, width: 120, height: 30, fillColor: HIGHLIGHT_COLOR, opacity: HIGHLIGHT_OPACITY }),
        shape('wo', { x: 240, y: 50, width: 120, height: 30, fillColor: '#ffffff' }),
      ],
      {},
      content,
    )
    // Black stays black under a multiply highlight (normal blending would turn it yellow-brown).
    expect(near(raster.at(100, 65), [0, 0, 0], 12)).toBe(true)
    // Over white paper the highlight is a light yellow.
    const paper = raster.at(100, 75)
    expect(paper[0]).toBeGreaterThan(240)
    expect(paper[2]).toBeLessThan(205)
    expect(paper[2]).toBeGreaterThan(160)
    // Whiteout hides the second bar.
    expect(near(raster.at(300, 65), [255, 255, 255], 4)).toBe(true)
    await pdf.loadingTask.destroy()
  })

  it('applies opacity to fill + stroke as one group (no darker overlap)', async () => {
    const { raster, pdf } = await exportAndRender([
      shape('g', { x: 40, y: 40, width: 100, height: 100, fillColor: '#0000ff', strokeColor: '#ff0000', strokeWidth: 10, opacity: 0.5 }),
    ])
    // Inner half of the stroke overlaps the fill; as a group it is plain 50% red over white.
    expect(near(raster.at(47, 90), [255, 128, 128], 16)).toBe(true)
    expect(near(raster.at(90, 90), [128, 128, 255], 16)).toBe(true)
    await pdf.loadingTask.destroy()
  })
})

describe('exportPdf: ink', () => {
  it('draws strokes through their points with round joins, and single points as dots', async () => {
    const ink: InkElement = {
      id: 'ink',
      kind: 'ink',
      page: 0,
      x: 50,
      y: 50,
      width: 200,
      height: 100,
      strokes: [
        [0, 0, 0.5, 1, 1, 0],
        [0.25, 0.25],
      ],
      color: '#1d4ed8',
      strokeWidth: 4,
    }
    const { raster, pdf } = await exportAndRender([ink])
    const blue = (r: number, _g: number, b: number) => b > 150 && r < 120
    const box = raster.bbox(blue)!
    // Stroke half-width (2pt) beyond the extreme points.
    expect(box.x).toBeCloseTo(48, 0)
    expect(box.x + box.width).toBeCloseTo(252, 0)
    expect(box.y).toBeCloseTo(48, 0)
    expect(box.y + box.height).toBeCloseTo(152, 0)
    // Middle of the first segment.
    expect(raster.inkIn(99, 99, 2, 2, 200)).toBeGreaterThan(0.5)
    // The lone point is a dot of diameter = stroke width.
    expect(raster.inkIn(99, 74, 2, 2, 200)).toBeGreaterThan(0.5)
    expect(raster.inkIn(95, 69, 1, 1, 200)).toBe(0)
    await pdf.loadingTask.destroy()
  })
})

describe.skipIf(!napi)('exportPdf: images', () => {
  it('embeds PNG (with transparency) and JPEG, honouring opacity and EXIF orientation', async () => {
    const png = encode(
      2,
      2,
      (ctx) => {
        ctx.fillStyle = '#ff0000'
        ctx.fillRect(0, 0, 1, 1)
        ctx.fillStyle = '#00ff00'
        ctx.fillRect(1, 0, 1, 1)
        ctx.fillStyle = '#0000ff'
        ctx.fillRect(0, 1, 1, 1)
      },
      'image/png',
    )
    // 20×10 JPEG: left half red, right half blue, tagged "rotate 90° clockwise".
    const jpeg = withExifOrientation(
      encode(
        20,
        10,
        (ctx) => {
          ctx.fillStyle = '#ff0000'
          ctx.fillRect(0, 0, 10, 10)
          ctx.fillStyle = '#0000ff'
          ctx.fillRect(10, 0, 10, 10)
        },
        'image/jpeg',
      ),
      6,
    )
    const assets: Record<string, Asset> = {
      png: { id: 'png', mime: 'image/png', dataUrl: toDataUrl(png, 'image/png'), width: 2, height: 2 },
      jpg: { id: 'jpg', mime: 'image/jpeg', dataUrl: toDataUrl(jpeg, 'image/jpeg'), width: 10, height: 20 },
    }
    const img = (id: string, assetId: string, x: number, y: number, w: number, h: number, opacity = 1): ImageElement => ({
      id,
      kind: 'image',
      page: 0,
      x,
      y,
      width: w,
      height: h,
      role: 'image',
      assetId,
      opacity,
    })
    const { raster, pdf, out } = await exportAndRender(
      [img('a', 'png', 40, 40, 40, 40), img('b', 'jpg', 200, 40, 40, 80), img('c', 'png', 40, 200, 40, 40, 0.5), img('d', 'png', 120, 200, 40, 40)],
      assets,
    )
    await debugWrite('images.pdf', out)
    expect(near(raster.at(50, 50), [255, 0, 0])).toBe(true)
    expect(near(raster.at(70, 50), [0, 255, 0])).toBe(true)
    expect(near(raster.at(50, 70), [0, 0, 255])).toBe(true)
    expect(near(raster.at(70, 70), [255, 255, 255])).toBe(true) // transparent pixel
    // Rotated JPEG: red on top, blue below.
    expect(near(raster.at(220, 55), [255, 0, 0], 40)).toBe(true)
    expect(near(raster.at(220, 105), [0, 0, 255], 40)).toBe(true)
    // 50% opacity.
    expect(near(raster.at(50, 210), [255, 128, 128], 16)).toBe(true)
    // The same asset is embedded once.
    const ops = await operators(pdf)
    expect(ops.filter((op) => op === pdfjs.OPS.paintImageXObject).length).toBe(4)
    await pdf.loadingTask.destroy()
  })
})

describe('exportPdf: text that the fonts cannot draw', () => {
  it('rasterizes the element and places the bitmap over its box', async () => {
    const bytes = await buildPdf([{ size: [300, 300] }])
    const pages = await readPages(bytes)
    const el = makeText(0, 40, 50, 'Thumbs 👍', { fontSize: 20 })
    const ok = makeText(0, 40, 150, 'Plain', { fontSize: 20 })
    // A 4×4 opaque black PNG standing in for the browser rendering.
    const png = napi ? encode(4, 4, (c) => c.fillRect(0, 0, 4, 4), 'image/png') : null
    const rasterizeText = vi.fn(async () => (png ? { png, x: el.x - 5, y: el.y - 5, width: el.width + 10, height: el.height + 10 } : null))
    const out = await renderPdf(makeInput(bytes, pages, [el, ok]), { ...testDeps, rasterizeText })
    expect(rasterizeText).toHaveBeenCalledOnce()
    const pdf = await openPdfjs(out)
    const strings = (await textInView(pdf, 1)).map((t) => t.str)
    expect(strings).toContain('Plain')
    if (png) {
      expect(strings.some((s) => s.includes('Thumbs'))).toBe(false)
      const raster = await renderPage(pdf, 1, 2)
      const box = raster.bbox((r, g, b) => r + g + b < 50)!
      expect(box.x).toBeCloseTo(el.x - 5, 0)
      expect(box.y).toBeCloseTo(el.y - 5, 0)
      expect(box.width).toBeCloseTo(el.width + 10, 0)
    }
    await pdf.loadingTask.destroy()
  })
})
