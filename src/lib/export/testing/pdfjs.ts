import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PageInfo, PageRotation } from '../../../model/types'
import { rewriteWithPdfjs, type PdfjsDocument } from '../pdfjsRewrite'
import type { RewrittenDocument } from '../types'

/** Test-only pdf.js (legacy build, in-process worker) helpers. */

pdfjs.GlobalWorkerOptions.workerSrc = new URL('../../../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url).href

export { pdfjs }

export type PdfjsProxy = Awaited<ReturnType<typeof pdfjs.getDocument>['promise']>

export async function openPdfjs(bytes: Uint8Array, password?: string): Promise<PdfjsProxy> {
  return pdfjs.getDocument({ data: bytes.slice(), password }).promise
}

export function pageInfoOf(page: Awaited<ReturnType<PdfjsProxy['getPage']>>): PageInfo {
  const viewport = page.getViewport({ scale: 1 })
  const [x0, y0, x1, y1] = page.view
  return {
    index: page.pageNumber - 1,
    width: viewport.width,
    height: viewport.height,
    rotation: ((((Math.round(page.rotate / 90) * 90) % 360) + 360) % 360) as PageRotation,
    view: [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)],
    userUnit: page.userUnit || 1,
  }
}

/** Page geometry exactly as the app reads it (see lib/pdf/pdfjs.ts). */
export async function readPages(bytes: Uint8Array, password?: string): Promise<PageInfo[]> {
  const pdf = await openPdfjs(bytes, password)
  try {
    const out: PageInfo[] = []
    for (let i = 1; i <= pdf.numPages; i++) out.push(pageInfoOf(await pdf.getPage(i)))
    return out
  } finally {
    await pdf.loadingTask.destroy()
  }
}

/** pdf.js-based decryption, as the browser build does it. */
export function pdfjsDecrypt(password?: string) {
  return async (bytes: Uint8Array): Promise<RewrittenDocument> => {
    const pdf = await openPdfjs(bytes, password)
    try {
      return await rewriteWithPdfjs(pdf as unknown as PdfjsDocument, { dropEncryption: true })
    } finally {
      await pdf.loadingTask.destroy()
    }
  }
}

export function pdfjsRepair() {
  return async (bytes: Uint8Array): Promise<RewrittenDocument> => {
    const pdf = await openPdfjs(bytes)
    try {
      return await rewriteWithPdfjs(pdf as unknown as PdfjsDocument, { dropEncryption: false })
    } finally {
      await pdf.loadingTask.destroy()
    }
  }
}

export interface TextItemInView {
  str: string
  /** Baseline origin in view space. */
  x: number
  y: number
  /** Text direction (unit vector) in view space; (1, 0) = upright left-to-right. */
  dx: number
  dy: number
  /** Font size in view units. */
  size: number
  dir: string
}

/** Text items of a page with their baseline origins mapped into view space. */
export async function textInView(pdf: PdfjsProxy, pageNumber: number): Promise<TextItemInView[]> {
  const page = await pdf.getPage(pageNumber)
  const viewport = page.getViewport({ scale: 1 })
  const content = await page.getTextContent()
  const out: TextItemInView[] = []
  for (const item of content.items) {
    if (!('str' in item) || !item.str) continue
    const [a, b, , , e, f] = item.transform
    const [x, y] = viewport.convertToViewportPoint(e, f)
    const [x2, y2] = viewport.convertToViewportPoint(e + a, f + b)
    const len = Math.hypot(x2 - x, y2 - y)
    out.push({ str: item.str, x, y, dx: (x2 - x) / len, dy: (y2 - y) / len, size: len, dir: item.dir })
  }
  return out
}

export interface Raster {
  width: number
  height: number
  scale: number
  data: Uint8ClampedArray
  /** RGBA at a view-space point. */
  at(x: number, y: number): [number, number, number, number]
  /** Fraction of pixels in a view-space rect darker than `threshold` (0..255 luminance). */
  inkIn(x: number, y: number, w: number, h: number, threshold?: number): number
  /** Bounding box (view space) of pixels matching `pred`, or null. */
  bbox(pred: (r: number, g: number, b: number, a: number) => boolean): { x: number; y: number; width: number; height: number } | null
}

/** Renders a page (white background), on screen or as printed, and gives pixel access in view-space coordinates. */
export async function renderPage(pdf: PdfjsProxy, pageNumber: number, scale = 4, intent: 'display' | 'print' = 'display'): Promise<Raster> {
  const page = await pdf.getPage(pageNumber)
  const viewport = page.getViewport({ scale })
  const factory = (pdf as unknown as { canvasFactory: { create(w: number, h: number): { canvas: unknown; context: CanvasRenderingContext2D } } })
    .canvasFactory
  const { canvas, context } = factory.create(Math.ceil(viewport.width), Math.ceil(viewport.height))
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, Math.ceil(viewport.width), Math.ceil(viewport.height))
  await page.render({ canvas: canvas as HTMLCanvasElement, canvasContext: context, viewport, intent, background: 'rgba(255,255,255,1)' }).promise
  const width = Math.ceil(viewport.width)
  const height = Math.ceil(viewport.height)
  const { data } = context.getImageData(0, 0, width, height)
  const px = (x: number, y: number) => {
    const ix = Math.min(width - 1, Math.max(0, Math.floor(x * scale)))
    const iy = Math.min(height - 1, Math.max(0, Math.floor(y * scale)))
    return (iy * width + ix) * 4
  }
  return {
    width,
    height,
    scale,
    data,
    at(x, y) {
      const i = px(x, y)
      return [data[i], data[i + 1], data[i + 2], data[i + 3]]
    },
    inkIn(x, y, w, h, threshold = 160) {
      const x0 = Math.max(0, Math.floor(x * scale))
      const y0 = Math.max(0, Math.floor(y * scale))
      const x1 = Math.min(width, Math.ceil((x + w) * scale))
      const y1 = Math.min(height, Math.ceil((y + h) * scale))
      let dark = 0
      let total = 0
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * width + xx) * 4
          const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
          if (lum < threshold) dark++
          total++
        }
      }
      return total ? dark / total : 0
    },
    bbox(pred) {
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (let yy = 0; yy < height; yy++) {
        for (let xx = 0; xx < width; xx++) {
          const i = (yy * width + xx) * 4
          if (pred(data[i], data[i + 1], data[i + 2], data[i + 3])) {
            if (xx < minX) minX = xx
            if (xx > maxX) maxX = xx
            if (yy < minY) minY = yy
            if (yy > maxY) maxY = yy
          }
        }
      }
      if (maxX < 0) return null
      return { x: minX / scale, y: minY / scale, width: (maxX + 1 - minX) / scale, height: (maxY + 1 - minY) / scale }
    },
  }
}
