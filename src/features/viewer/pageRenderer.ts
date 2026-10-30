import type { PDFDocumentProxy } from '../../lib/pdf/pdfjs'
import type { PageInfo } from '../../model/types'
import { bitmapTarget, cleanupPage, regionTarget, releaseCanvas, renderPageBitmap, type BitmapTarget } from './pageRender'
import { renderQueue } from './renderQueue'
import { containsFraction, expandFraction, frameSize, visibleFraction, type ClientRect, type FrameFraction } from './viewMath'

export interface PageRenderInput {
  pdf: PDFDocumentProxy
  info: PageInfo
  /** Within ~1.5 viewport heights of the visible area. */
  near: boolean
  /** Scale to render at (may lag the live zoom while a gesture is in progress). */
  scale: number
  dpr: number
}

/** What a page renderer needs from the viewer (implemented by ViewerController). */
export interface RenderHost {
  renderPriority(el: Element | null): number
  visibleClientRect(): ClientRect | null
  subscribeViewport(listener: () => void): () => void
  isZooming(): boolean
}

/** Reflected on the root element as `data-state` (drives the skeleton / error UI with CSS only). */
export type PageRenderState = 'empty' | 'loading' | 'ready' | 'error'

/** A detail render only pays off when the page bitmap is noticeably below the screen's resolution. */
const DETAIL_MIN_GAIN = 1.15
/** The detail area reaches this fraction of the viewport beyond each visible edge (room to scroll). */
const DETAIL_MARGIN = 0.3

interface Job {
  key: string
  cancel: () => void
}

interface Bitmap {
  canvas: HTMLCanvasElement
  key: string
}

/** Detail renders also remember which part of the page they cover, and at which zoom. */
interface Coverage {
  fraction: FrameFraction
  scaleKey: string
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Owns one page's bitmaps outside React: schedules renders through the shared queue, double-buffers
 * (the old bitmap stays up, stretched by CSS, until the new one is ready — no blank flash while
 * zooming), cancels superseded work, and frees canvases when the page leaves the viewport.
 *
 * The whole-page bitmap is capped at ~16.7M pixels, so at high zoom on dense screens it is rendered
 * below the device resolution. A second "detail" bitmap then covers just the visible part of the page
 * at full resolution, refreshed when scrolling or zooming settles.
 */
export class PageRenderer {
  private readonly root: HTMLElement
  private readonly host: HTMLElement
  private readonly viewer: RenderHost
  private readonly unsubscribe: () => void
  private base: Bitmap | null = null
  private baseJob: Job | null = null
  private detail: (Bitmap & Coverage) | null = null
  private detailJob: (Job & Coverage) | null = null
  private input: PageRenderInput | null = null
  private destroyed = false

  constructor(root: HTMLElement, host: HTMLElement, viewer: RenderHost) {
    this.root = root
    this.host = host
    this.viewer = viewer
    this.unsubscribe = viewer.subscribeViewport(() => this.updateDetail())
    this.setState('empty')
  }

  update(input: PageRenderInput): void {
    if (this.destroyed) return
    this.input = input
    if (!input.near) {
      this.release()
      return
    }
    const css = frameSize(input.info, input.scale)
    const target = bitmapTarget(css.width, css.height, input.dpr)
    if (this.base?.key === target.key) {
      this.cancel('base')
      this.setState('ready')
    } else if (this.baseJob?.key !== target.key) {
      this.cancel('base')
      if (!this.base) this.setState('loading')
      this.baseJob = this.schedule(input, target, 0, (canvas) => this.presentBase(canvas, target.key))
    }
    this.updateDetail()
  }

  destroy(): void {
    this.unsubscribe()
    this.release()
    this.destroyed = true
  }

  private schedule(input: PageRenderInput, target: BitmapTarget, priorityOffset: number, onDone: (canvas: HTMLCanvasElement) => void): Job {
    const { pdf, info } = input
    const job: Job = { key: target.key, cancel: () => {} }
    job.cancel = renderQueue.schedule(
      async (signal) => {
        try {
          const canvas = await renderPageBitmap(pdf, info, target, signal)
          if (!canvas) return
          if (signal.aborted || this.destroyed) {
            releaseCanvas(canvas)
            return
          }
          onDone(canvas)
        } catch (err) {
          if (signal.aborted || this.destroyed) return
          console.warn(`[viewer] page ${info.index + 1} could not be rendered`, err)
          if (!target.region && !this.base) this.setState('error')
        } finally {
          if (this.baseJob === job) this.baseJob = null
          if (this.detailJob === job) this.detailJob = null
        }
      },
      () => this.viewer.renderPriority(this.root) + priorityOffset,
    )
    return job
  }

  private presentBase(canvas: HTMLCanvasElement, key: string): void {
    const previous = this.base
    canvas.className = 'absolute inset-0 block size-full'
    // The page bitmap always sits below the detail bitmap.
    if (previous) previous.canvas.replaceWith(canvas)
    else this.host.prepend(canvas)
    releaseCanvas(previous?.canvas)
    this.base = { canvas, key }
    this.setState('ready')
    if (!previous && !prefersReducedMotion() && typeof canvas.animate === 'function') {
      canvas.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: 'ease-out' })
    }
  }

  // --- high-zoom detail ------------------------------------------------------

  private updateDetail(): void {
    const input = this.input
    if (this.destroyed || !input?.near) return
    // Re-evaluated when the zoom settles (that changes the render scale and calls update()).
    if (this.viewer.isZooming()) return
    const css = frameSize(input.info, input.scale)
    const page = bitmapTarget(css.width, css.height, input.dpr)
    if (page.ratio * DETAIL_MIN_GAIN > input.dpr) {
      this.clearDetail()
      return
    }
    const view = this.viewer.visibleClientRect()
    if (!view) return
    const frame = this.root.getBoundingClientRect()
    const visible = visibleFraction(frame, view)
    if (!visible) {
      this.clearDetail()
      return
    }
    const scaleKey = `${css.width}x${css.height}@${input.dpr}`
    const covers = (c: Coverage | null) => !!c && c.scaleKey === scaleKey && containsFraction(c.fraction, visible)
    if (covers(this.detailJob)) return
    if (covers(this.detail)) {
      this.cancel('detail')
      return
    }
    const fraction = expandFraction(
      visible,
      ((view.right - view.left) * DETAIL_MARGIN) / (frame.right - frame.left),
      ((view.bottom - view.top) * DETAIL_MARGIN) / (frame.bottom - frame.top),
    )
    const target = regionTarget(css.width, css.height, fraction, input.dpr)
    if (target.ratio < page.ratio * DETAIL_MIN_GAIN) {
      this.clearDetail()
      return
    }
    this.cancel('detail')
    // After the visible pages' whole-page bitmaps, before anything offscreen.
    const job = this.schedule(input, target, 0.5, (canvas) => this.presentDetail(canvas, fraction, scaleKey, target.key))
    this.detailJob = Object.assign(job, { fraction, scaleKey })
  }

  private presentDetail(canvas: HTMLCanvasElement, f: FrameFraction, scaleKey: string, key: string): void {
    const previous = this.detail
    canvas.className = 'absolute block'
    // Positioned in % of the frame, so it stays aligned (stretched) while a zoom gesture resizes the page.
    Object.assign(canvas.style, {
      left: `${f.x0 * 100}%`,
      top: `${f.y0 * 100}%`,
      width: `${(f.x1 - f.x0) * 100}%`,
      height: `${(f.y1 - f.y0) * 100}%`,
    })
    if (previous) previous.canvas.replaceWith(canvas)
    else this.host.append(canvas)
    releaseCanvas(previous?.canvas)
    this.detail = { canvas, key, fraction: f, scaleKey }
  }

  private clearDetail(): void {
    this.cancel('detail')
    if (this.detail) {
      releaseCanvas(this.detail.canvas)
      this.detail = null
    }
  }

  // --- housekeeping -------------------------------------------------------------

  private release(): void {
    this.cancel('base')
    this.clearDetail()
    if (this.base) {
      releaseCanvas(this.base.canvas)
      this.base = null
      if (this.input) cleanupPage(this.input.pdf, this.input.info.index)
    }
    this.setState('empty')
  }

  private cancel(which: 'base' | 'detail'): void {
    const job = which === 'base' ? this.baseJob : this.detailJob
    if (which === 'base') this.baseJob = null
    else this.detailJob = null
    job?.cancel()
  }

  private setState(state: PageRenderState): void {
    if (this.root.dataset.state !== state) this.root.dataset.state = state
  }
}
