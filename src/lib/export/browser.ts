import { cssFontFamily, fontFileUrl, loadFont } from '../../model/fonts'
import type { FontId, TextElement } from '../../model/types'
import type { TextBlockLayout } from '../text/layout'
import { ExportError } from './errors'
import { rewriteWithPdfjs, type PdfjsDocument } from './pdfjsRewrite'
import { firstStrongDirection } from './shaping'
import type { ExportDeps, RasterizedText, RewrittenDocument } from './types'

/** Browser implementations of the exporter's environment services. */

const fontBytes = new Map<string, Promise<Uint8Array>>()

/** The element font files (same URLs the FontFaces use, so usually served from cache). */
export function loadFontBytes(fontId: FontId, bold: boolean): Promise<Uint8Array> {
  const url = fontFileUrl(fontId, bold)
  let p = fontBytes.get(url)
  if (!p) {
    p = fetch(url).then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
      return new Uint8Array(await res.arrayBuffer())
    })
    p.catch(() => fontBytes.delete(url))
    fontBytes.set(url, p)
  }
  return p
}

/** Device pixels per point for rasterized text (4× ≈ 288 dpi). */
const RASTER_SCALE = 4
const MAX_CANVAS_SIDE = 8192
const MAX_CANVAS_AREA = 16_777_216

/**
 * Renders a text element with the browser's own text stack (font + system fallbacks for
 * emoji, CJK, Arabic…) using the same layout as the editor, padded so glyphs that overflow
 * the line box aren't clipped.
 */
export async function rasterizeText(el: TextElement, layout: TextBlockLayout): Promise<RasterizedText | null> {
  if (typeof document === 'undefined') return null
  await loadFont(el.fontId, el.bold)
  const pad = el.fontSize * 0.6
  const boxW = layout.width + pad * 2
  const boxH = layout.height + pad * 2
  const scale = Math.max(
    1,
    Math.min(RASTER_SCALE, MAX_CANVAS_SIDE / boxW, MAX_CANVAS_SIDE / boxH, Math.sqrt(MAX_CANVAS_AREA / (boxW * boxH))),
  )
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(boxW * scale)
  canvas.height = Math.ceil(boxH * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.scale(scale, scale)
  ctx.translate(pad, pad)
  ctx.font = `${el.bold ? 700 : 400} ${el.fontSize}px ${cssFontFamily(el.fontId)}`
  ctx.fillStyle = el.color
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fontKerning = 'none'
  if (el.letterSpacing && 'letterSpacing' in ctx) ctx.letterSpacing = `${el.letterSpacing}px`
  for (const line of layout.lines) {
    if (!line.text) continue
    ctx.direction = firstStrongDirection(line.text) ?? 'ltr'
    ctx.fillText(line.text, line.x, line.baseline)
  }
  const png = await canvasToPng(canvas)
  if (!png) return null
  return { png, x: el.x - pad, y: el.y - pad, width: canvas.width / scale, height: canvas.height / scale }
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      if (!blob) return resolve(null)
      blob.arrayBuffer().then(
        (buf) => resolve(new Uint8Array(buf)),
        () => resolve(null),
      )
    }, 'image/png')
  })
}

/** Re-encodes any image the browser can decode (WebP, GIF, AVIF, odd PNGs…) as PNG. */
export async function convertImage(bytes: Uint8Array, mime: string): Promise<Uint8Array | null> {
  if (typeof document === 'undefined' || typeof createImageBitmap === 'undefined') return null
  const bitmap = await createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime }))
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(bitmap, 0, 0)
    return await canvasToPng(canvas)
  } finally {
    bitmap.close()
  }
}

/**
 * pdf.js-based decrypt/repair. Uses the already-open document when given (it holds the
 * password the user typed); otherwise opens the bytes itself.
 */
export function pdfjsRewriter(open?: PdfjsDocument | null): Pick<ExportDeps, 'decrypt' | 'repair'> {
  const withDocument = async (bytes: Uint8Array, dropEncryption: boolean): Promise<RewrittenDocument> => {
    if (open) return rewriteWithPdfjs(open, { dropEncryption })
    const { openPdf, PasswordRequiredError } = await import('../pdf/pdfjs')
    let pdf
    try {
      pdf = await openPdf(bytes)
    } catch (err) {
      if (err instanceof PasswordRequiredError) {
        throw new ExportError('encrypted', 'This PDF is password-protected. Open it in FillFlow with its password, then export again.')
      }
      throw err
    }
    try {
      return await rewriteWithPdfjs(pdf as unknown as PdfjsDocument, { dropEncryption })
    } finally {
      void pdf.loadingTask.destroy()
    }
  }
  return {
    decrypt: (bytes) => withDocument(bytes, true),
    repair: (bytes) => withDocument(bytes, false),
  }
}
