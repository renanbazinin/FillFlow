import { pdfjs, type PDFDocumentProxy, type PDFPageProxy } from '../../lib/pdf/pdfjs'
import type { PageInfo } from '../../model/types'
import { bitmapSize, bitmapTransform, capPixelRatio, fractionToCss, type CssRect, type FrameFraction } from './viewMath'
import { createAnnotationSkipFilter, formLayerWidgetIds, type AnnotationLike } from './widgetFilter'

export interface BitmapTarget {
  /** CSS size of the page frame. */
  cssWidth: number
  cssHeight: number
  /** Effective device-pixel ratio (already capped). */
  ratio: number
  /** Integer bitmap size. */
  width: number
  height: number
  /** Identifies the resolution (and region), to skip redundant re-renders. */
  key: string
  /** Render only this part of the frame (CSS px) instead of the whole page. */
  region?: CssRect
  /** `region` as fractions of the frame (zoom-independent), for positioning and coverage checks. */
  fraction?: FrameFraction
}

/** Resolution for a CSS box on the current screen, capped to safe canvas limits. */
export function bitmapTarget(cssWidth: number, cssHeight: number, devicePixelRatio: number): BitmapTarget {
  const ratio = capPixelRatio(cssWidth, cssHeight, devicePixelRatio)
  const { width, height } = bitmapSize(cssWidth, cssHeight, ratio)
  return { cssWidth, cssHeight, ratio, width, height, key: `${width}x${height}` }
}

/** Resolution for a sub-rectangle of the frame (a high-zoom "detail" render of the visible area). */
export function regionTarget(cssWidth: number, cssHeight: number, fraction: FrameFraction, devicePixelRatio: number): BitmapTarget {
  const region = fractionToCss(fraction, cssWidth, cssHeight)
  const ratio = capPixelRatio(region.width, region.height, devicePixelRatio)
  const { width, height } = bitmapSize(region.width, region.height, ratio)
  const key = `${cssWidth}x${cssHeight}:${Math.round(region.x)},${Math.round(region.y)},${width}x${height}`
  return { cssWidth, cssHeight, ratio, width, height, key, region, fraction }
}

const skipIdsCache = new WeakMap<PDFPageProxy, Promise<Set<string>>>()

/** Ids of the widgets the forms layer draws (cached per page). */
function formWidgetIds(page: PDFPageProxy): Promise<Set<string>> {
  let ids = skipIdsCache.get(page)
  if (!ids) {
    ids = page
      .getAnnotations({ intent: 'display' })
      .then((annotations) => formLayerWidgetIds(annotations as AnnotationLike[]))
      .catch(() => new Set<string>())
    skipIdsCache.set(page, ids)
  }
  return ids
}

export function isCancellation(err: unknown): boolean {
  return err instanceof pdfjs.RenderingCancelledException || (err instanceof Error && err.name === 'RenderingCancelledException')
}

/** Frees a canvas' backing store right away (Safari keeps it alive until GC otherwise). */
export function releaseCanvas(canvas: HTMLCanvasElement | null | undefined): void {
  if (!canvas) return
  canvas.width = 0
  canvas.height = 0
  canvas.remove()
}

/**
 * Renders one page (or `target.region` of it) into a fresh, detached canvas of exactly
 * `target.width × target.height` pixels, filled edge to edge. Form widgets are left out — see
 * `widgetFilter.ts`. Resolves to null when aborted; rejects on real rendering errors.
 */
export async function renderPageBitmap(
  pdf: PDFDocumentProxy,
  info: PageInfo,
  target: BitmapTarget,
  signal: AbortSignal,
): Promise<HTMLCanvasElement | null> {
  const page = await pdf.getPage(info.index + 1)
  if (signal.aborted) return null
  const skipIds = await formWidgetIds(page)
  if (signal.aborted) return null

  // pdf.js maps the page onto `scale * dpr` pixels; the extra transform absorbs the sub-pixel
  // difference to our integer bitmap (so overlays line up exactly) and selects the region, if any.
  const viewport = page.getViewport({ scale: (target.cssWidth / info.width) * target.ratio })
  const canvas = document.createElement('canvas')
  canvas.width = target.width
  canvas.height = target.height
  const task = page.render({
    canvas,
    viewport,
    transform: bitmapTransform(viewport.width, viewport.height, target.cssWidth, target.cssHeight, target.width, target.height, target.region),
    annotationMode: pdfjs.AnnotationMode.ENABLE_FORMS,
    operationsFilter: createAnnotationSkipFilter(skipIds, pdfjs.OPS),
  })
  const onAbort = () => task.cancel()
  signal.addEventListener('abort', onAbort)
  try {
    await task.promise
  } catch (err) {
    releaseCanvas(canvas)
    if (signal.aborted || isCancellation(err)) return null
    throw err
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
  if (signal.aborted) {
    releaseCanvas(canvas)
    return null
  }
  return canvas
}

/** Per document: how many users (a page near the viewport, a thumbnail being rendered) each page has. */
const pageUsers = new WeakMap<PDFDocumentProxy, Map<number, number>>()

/**
 * Marks a page as in use; call the returned function when done with it. Once its last user lets
 * go, pdf.js drops the page's parsed resources (decoded images: tens of MB on a scanned page).
 * pdf.js waits for a render of the page that is still running before it does.
 */
export function retainPage(pdf: PDFDocumentProxy, index: number): () => void {
  const users = pageUsers.get(pdf) ?? new Map<number, number>()
  pageUsers.set(pdf, users)
  users.set(index, (users.get(index) ?? 0) + 1)
  let released = false
  return () => {
    if (released) return
    released = true
    const left = (users.get(index) ?? 1) - 1
    if (left > 0) {
      users.set(index, left)
      return
    }
    users.delete(index)
    pdf
      .getPage(index + 1)
      .then((page) => {
        // Unless someone started using the page again meanwhile.
        if (!users.has(index)) page.cleanup()
      })
      .catch(() => {})
  }
}
