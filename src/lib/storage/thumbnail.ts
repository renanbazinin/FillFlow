import type { PDFDocumentProxy } from '../pdf/pdfjs'

/** Width of a recent-document thumbnail, in px, at 1× density. */
export const THUMBNAIL_WIDTH = 280
/** Very tall pages (receipts, posters) are capped at this many widths. */
const MAX_ASPECT = 2
const JPEG_QUALITY = 0.82

/** Thumbnail width for a screen density: a little sharper on HiDPI screens, size-capped. */
export function thumbnailWidth(dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1): number {
  return Math.round(THUMBNAIL_WIDTH * Math.min(Math.max(dpr || 1, 1), 1.5))
}

/** Pixel size of a thumbnail for a page of the given view size (points). */
export function thumbnailSize(
  pageWidth: number,
  pageHeight: number,
  width = THUMBNAIL_WIDTH,
): { width: number; height: number; scale: number } {
  const scale = Math.min(width / pageWidth, (width * MAX_ASPECT) / pageHeight)
  return { width: Math.max(1, Math.round(pageWidth * scale)), height: Math.max(1, Math.round(pageHeight * scale)), scale }
}

/** Renders page 1 (rotation applied) to a small JPEG data URL. Rejects if pdf.js fails. */
export async function renderThumbnail(pdf: PDFDocumentProxy): Promise<string> {
  const page = await pdf.getPage(1)
  const unit = page.getViewport({ scale: 1 })
  const size = thumbnailSize(unit.width, unit.height, thumbnailWidth())
  const viewport = page.getViewport({ scale: size.scale })
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  try {
    await page.render({ canvas, viewport, background: '#ffffff' }).promise
    return canvas.toDataURL('image/jpeg', JPEG_QUALITY)
  } finally {
    // Release the backing store right away (Safari keeps canvas memory around otherwise).
    canvas.width = 0
    canvas.height = 0
  }
}

/** Resolves when the browser is idle (or after a short delay where requestIdleCallback is missing). */
export function whenIdle(timeout = 2000): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(() => resolve(), { timeout })
    else setTimeout(resolve, 300)
  })
}
