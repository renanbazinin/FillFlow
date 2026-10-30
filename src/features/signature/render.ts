import { IMAGE_DEFAULT_WIDTH } from '../../model/elements'
import type { UploadDraft } from './draft'
import { ensureSignatureFont, signatureFontStack, type SignatureFont } from './fonts'
import {
  findContentBounds,
  fitWithin,
  padBox,
  padBoxPx,
  rasterOutputSize,
  removeBackground,
  vectorOutputSize,
  type Box,
  type Size,
} from './imageUtils'
import type { SignatureRole } from './library'
import { outlinesBounds, strokeOutline, traceOutline, type Stroke } from './strokes'
import { textDirection } from './text'

/**
 * Turns each tab's content into the final PNG: cropped to the ink (+4% padding), transparent,
 * and rendered at ≥ 4× its default physical size (max 1600 px on the long side).
 */

export interface RenderedImage {
  mime: 'image/png'
  dataUrl: string
  width: number
  height: number
}

const PADDING = 0.04
const MAX_LONG = 1600

const OUTPUT: Record<SignatureRole, { targetWidth: number; minWidth: number }> = {
  signature: { targetWidth: 1000, minWidth: IMAGE_DEFAULT_WIDTH.signature * 4 },
  initials: { targetWidth: 480, minWidth: IMAGE_DEFAULT_WIDTH.initials * 4 },
}

export function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  return canvas
}

export function context2d(canvas: HTMLCanvasElement, readback = false): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', readback ? { willReadFrequently: true } : undefined)
  if (!ctx) throw new Error('Canvas 2D is not available')
  return ctx
}

function toPng(canvas: HTMLCanvasElement): RenderedImage {
  return { mime: 'image/png', dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height }
}

/** Copies `box` of `source` (may extend past its edges: that area stays transparent) into a `size` canvas. */
function cropTo(source: HTMLCanvasElement, box: Box, size: Size): HTMLCanvasElement {
  const out = createCanvas(size.width, size.height)
  const ctx = context2d(out)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  const kx = size.width / box.width
  const ky = size.height / box.height
  // Clip the source rectangle ourselves: browsers disagree on out-of-bounds source rects.
  const sx = Math.max(0, box.x)
  const sy = Math.max(0, box.y)
  const sw = Math.min(source.width, box.x + box.width) - sx
  const sh = Math.min(source.height, box.y + box.height) - sy
  if (sw > 0 && sh > 0) ctx.drawImage(source, sx, sy, sw, sh, (sx - box.x) * kx, (sy - box.y) * ky, sw * kx, sh * ky)
  return out
}

// --- Draw ---------------------------------------------------------------------

/** Fills each stroke outline (separately, so overlapping strokes never cancel out). */
export function paintStrokes(ctx: CanvasRenderingContext2D, outlines: number[][][], color: string): void {
  ctx.fillStyle = color
  for (const outline of outlines) {
    const path = new Path2D()
    traceOutline(path, outline)
    ctx.fill(path)
  }
}

export function renderDrawing(strokes: Stroke[], opts: { color: string; size: number; role: SignatureRole }): RenderedImage | null {
  const outlines = strokes.map((s) => strokeOutline(s, opts.size))
  const bounds = outlinesBounds(outlines)
  if (!bounds) return null
  const box = padBox(bounds, PADDING)
  const size = vectorOutputSize(box.width, box.height, { targetWidth: OUTPUT[opts.role].targetWidth, maxLong: MAX_LONG })
  const canvas = createCanvas(size.width, size.height)
  const ctx = context2d(canvas)
  ctx.setTransform(size.scale, 0, 0, size.scale, -box.x * size.scale, -box.y * size.scale)
  paintStrokes(ctx, outlines, opts.color)
  return toPng(canvas)
}

// --- Type ---------------------------------------------------------------------

export function typedFont(font: SignatureFont, px: number): string {
  return `${Math.round(px * font.scale * 100) / 100}px ${signatureFontStack(font)}`
}

/**
 * Draws one line centered on a canvas with generous room around it (script swashes overshoot
 * their metrics) and returns the canvas with its measured ink bounds. Only the advance width
 * is trusted: `actualBoundingBox*` metrics are unreliable for right-to-left runs.
 */
function drawLine(value: string, font: string, px: number, direction: CanvasDirection, color: string): ProcessedImage {
  const measure = context2d(createCanvas(1, 1))
  measure.font = font
  measure.direction = direction
  const advance = measure.measureText(value).width
  const margin = Math.ceil(px * 0.8)
  const canvas = createCanvas(Math.min(8192, advance + margin * 2), Math.min(4096, px * 3))
  const ctx = context2d(canvas, true)
  ctx.font = font
  ctx.direction = direction
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = color
  ctx.fillText(value, canvas.width / 2, Math.round(px * 1.85))
  return { canvas, bounds: findContentBounds(ctx.getImageData(0, 0, canvas.width, canvas.height)) }
}

export async function renderTyped(text: string, opts: { font: SignatureFont; color: string; role: SignatureRole }): Promise<RenderedImage | null> {
  const value = text.trim()
  if (!value) return null
  await ensureSignatureFont(opts.font, value)
  const direction = textDirection(value)
  const { targetWidth } = OUTPUT[opts.role]

  // Measure the ink at a probe size, then render once at the size that makes it `targetWidth` wide.
  const probePx = 120
  const probe = drawLine(value, typedFont(opts.font, probePx), probePx, direction, opts.color)
  if (!probe.bounds) return null
  const px = Math.min(640, Math.max(24, (probePx * targetWidth) / Math.max(1, probe.bounds.width)))
  const { canvas, bounds } = drawLine(value, typedFont(opts.font, px), px, direction, opts.color)
  if (!bounds) return null
  const box = padBoxPx(bounds, PADDING)
  return toPng(cropTo(canvas, box, fitWithin(box.width, box.height, MAX_LONG)))
}

// --- Upload -------------------------------------------------------------------

export interface ProcessedImage {
  canvas: HTMLCanvasElement
  /** Ink bounds in `canvas` pixels; null when nothing is left. */
  bounds: Box | null
}

/** Applies the draft's background removal to its preview or full-size image. */
export function processUpload(draft: UploadDraft, which: 'preview' | 'full'): ProcessedImage {
  const src = which === 'preview' ? draft.preview : draft.source
  const canvas = createCanvas(src.width, src.height)
  const ctx = context2d(canvas, true)
  ctx.drawImage(src, 0, 0)
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  if (draft.removeBg) {
    removeBackground(img, { whitePoint: draft.whitePoint, map: draft.map })
    ctx.putImageData(img, 0, 0)
  }
  return { canvas, bounds: findContentBounds(img) }
}

export function renderUpload(draft: UploadDraft, role: SignatureRole): RenderedImage | null {
  const { canvas, bounds } = processUpload(draft, 'full')
  if (!bounds) return null
  const box = padBoxPx(bounds, PADDING)
  return toPng(cropTo(canvas, box, rasterOutputSize(box.width, box.height, { minWidth: OUTPUT[role].minWidth, maxLong: MAX_LONG })))
}
