import type { PageInfo, Point, Rect } from '../../model/types'
import { PT_TO_PX, useEditor } from '../../store/editor'
import { clamp, isEditableTarget } from '../../lib/utils/misc'
import { prefersReducedMotion } from '../../lib/utils/motion'
import type { PagePoint, ScrollToRectOptions, ViewerHandle } from './viewerApi'
import { DOCK_OVERLAP, PAD_BOTTOM, PAD_TOP, SCROLL_TOP_MARGIN, ZOOM_SETTLE_MS, horizontalPadding } from './constants'
import { clampScale, computeFitScale, pinchScale, stepZoom, wheelDeltaPx, wheelZoomLog } from './zoom'
import {
  anchorScrollDelta,
  clampPoint,
  coveredFromBelow,
  distanceToViewport,
  nearestSpanIndex,
  revealDelta,
  spanIndexAt,
  type ClientRect,
  type PageAnchor,
  type Span,
} from './viewMath'

export interface RenderSettings {
  /** Scale page bitmaps are rendered at. */
  scale: number
  /** window.devicePixelRatio. */
  dpr: number
}

type FitMode = 'width' | 'page'

/** Zoom commits within this window of a wheel/pinch/resize event count as one continuous gesture. */
const GESTURE_WINDOW_MS = 200
/** Programmatic scrolls longer than this many viewport heights jump instead of animating. */
const SMOOTH_SCROLL_MAX_VIEWPORTS = 2.5
/** Quiet time after the last scroll/resize event before "viewport settled" listeners run. */
const VIEWPORT_SETTLE_MS = 150
const EPSILON = 1e-9

/** Safari's non-standard trackpad pinch event. */
interface GestureEventLike extends UIEvent {
  scale: number
  clientX: number
  clientY: number
}

const ACTIVATABLE =
  'button, a[href], select, summary, [role="button"], [role="link"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="option"], [role="tab"], [role="switch"], [role="checkbox"], [role="radio"], [role="slider"], [role="combobox"]'

/** Space on these controls means "activate", so it must not start panning. */
function isActivatable(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(ACTIVATABLE) !== null
}

/** A modal (dialog, sheet, alert) is open over the editor: keys and gestures belong to it. */
function modalOpen(): boolean {
  return (
    useEditor.getState().activeDialog !== null ||
    document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]') !== null
  )
}

function touchDistance(a: Touch, b: Touch): number {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
}

/**
 * The tool dock (editor/ToolDock): it floats over the bottom of the pages on larger screens. Found
 * by its data attribute: its name is in the interface language.
 */
const TOOL_DOCK = '[data-tool-dock]'
/** Room kept between what is revealed and the tool dock. */
const DOCK_GAP = 8

/**
 * How much of the bottom of `view` the tool dock covers, measured as it is now: all of its height
 * where it floats over the pages (on a short screen, much of them), nothing while it makes way
 * (hidden while typing on one) or where it sits below them (phones).
 */
function dockCover(view: ClientRect): number {
  const dock = document.querySelector(TOOL_DOCK)
  return dock ? coveredFromBelow(view, dock.getBoundingClientRect(), DOCK_GAP) : DOCK_OVERLAP
}

/**
 * Imperative core of the viewer. Owns scroll position, zoom anchoring, gestures and the
 * `ViewerHandle` API; React components feed it the DOM (container + page frames) and the
 * committed scale. All coordinates handed out are view space (see model/types.ts).
 */
export class ViewerController implements ViewerHandle {
  private container: HTMLElement | null = null
  private frames: (HTMLElement | null)[] = []
  private pages: readonly PageInfo[] = []
  /** The scale the DOM currently reflects (updated when a new scale has been committed). */
  private renderedScale = PT_TO_PX
  /** Where to keep the content when the next scale commit lands. */
  private pendingAnchor: { anchor: PageAnchor; keepTop: boolean } | null = null
  /** Page points under the viewport's center / top edge, captured while the DOM is in sync. */
  private view: { center: PagePoint | null; top: PagePoint | null; atTop: boolean } = { center: null, top: null, atTop: true }
  private resetScrollOnCommit = false
  private lastGestureAt = 0
  private settleTimer: ReturnType<typeof setTimeout> | undefined
  private scrollFrame = 0
  private viewportTimer: ReturnType<typeof setTimeout> | undefined
  private readonly viewportListeners = new Set<() => void>()
  /**
   * After `scrollToPage`, that page stays "current" (no flicker through the pages a smooth scroll
   * passes) while the scroll runs, and afterwards until the user scrolls or it leaves the view.
   */
  private navLock: { page: number; until: number } | null = null

  private renderSettings: RenderSettings = { scale: PT_TO_PX, dpr: typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1 }
  private readonly renderListeners = new Set<() => void>()

  // --- gestures ---
  private ctrlDown = false
  private metaDown = false
  private spaceHeld = false
  private wheel = { log: 0, clientX: 0, clientY: 0, frame: 0 }
  private pan: { pointerId: number; x: number; y: number; scrollLeft: number; scrollTop: number } | null = null
  private pinch: { startScale: number; startDistance: number; anchor: PagePoint } | null = null
  private pinchTarget: { scale: number; clientX: number; clientY: number } | null = null
  private pinchFrame = 0
  private pinchListeners: AbortController | null = null
  private safariGestureScale: number | null = null
  private safariTarget: { scale: number; clientX: number; clientY: number } | null = null
  private safariFrame = 0
  /** Touch pointers currently down → the element they went down on. */
  private readonly touchTargets = new Map<number, EventTarget | null>()
  /** While two fingers are down, page layers must not see touch pointer events. */
  private suppressTouch = false
  private dispatchingCancel = false

  // -------------------------------------------------------------------------
  // Lifecycle (called by <Viewer>)
  // -------------------------------------------------------------------------

  attach(container: HTMLElement): void {
    this.container = container
    this.renderedScale = useEditor.getState().scale
  }

  detach(): void {
    this.container = null
    cancelAnimationFrame(this.scrollFrame)
    cancelAnimationFrame(this.wheel.frame)
    cancelAnimationFrame(this.pinchFrame)
    cancelAnimationFrame(this.safariFrame)
    clearTimeout(this.settleTimer)
    clearTimeout(this.viewportTimer)
    this.scrollFrame = this.wheel.frame = this.pinchFrame = this.safariFrame = 0
    this.pinchListeners?.abort()
    this.pinchListeners = null
    this.pan = null
    this.pinch = null
    this.touchTargets.clear()
    this.suppressTouch = false
  }

  registerFrame(index: number, el: HTMLElement): void {
    this.frames[index] = el
  }

  unregisterFrame(index: number, el: HTMLElement): void {
    if (this.frames[index] === el) this.frames[index] = null
  }

  /** A (new) document was opened: scroll to the top, apply the fit mode, forget gesture state. */
  resetForDocument(pages: readonly PageInfo[]): void {
    this.pages = pages
    this.frames.length = pages.length
    this.pendingAnchor = null
    this.navLock = null
    this.pinch = null
    this.view = { center: null, top: null, atTop: true }
    const c = this.container
    if (c) {
      c.scrollTop = 0
      c.scrollLeft = 0
    }
    const st = useEditor.getState()
    this.renderedScale = st.scale
    if (st.fitMode) {
      const fit = this.computeFit(st.fitMode)
      if (Math.abs(fit - st.scale) > EPSILON) {
        this.resetScrollOnCommit = true
        st.setScale(fit, st.fitMode)
      }
    }
    this.lastGestureAt = 0
    this.setRenderSettings({ ...this.renderSettings, scale: useEditor.getState().scale })
  }

  /** Runs in a layout effect after React rendered `scale`: re-anchor the scroll position. */
  commitScale(scale: number): void {
    const previous = this.renderedScale
    this.renderedScale = scale
    const c = this.container
    if (c) {
      if (this.resetScrollOnCommit) {
        this.resetScrollOnCommit = false
        c.scrollTop = 0
        c.scrollLeft = 0
      } else if (Math.abs(previous - scale) > EPSILON) {
        const pending = this.pendingAnchor ?? this.defaultAnchor()
        if (pending) this.applyAnchor(pending.anchor, pending.keepTop)
      }
    }
    this.pendingAnchor = null
    this.captureView()
    this.updateCurrentPage()
    this.scheduleRenderScale(scale)
  }

  /** Wires DOM listeners; returns the cleanup. */
  bindEvents(): () => void {
    const c = this.container
    if (!c) return () => {}
    const ac = new AbortController()
    const signal = ac.signal
    c.addEventListener('scroll', this.onScroll, { passive: true, signal })
    c.addEventListener('wheel', this.onWheel, { passive: false, signal })
    c.addEventListener('pointerdown', this.onPointerDown, { capture: true, signal })
    c.addEventListener('pointermove', this.onPointerMove, { capture: true, signal })
    c.addEventListener('pointerup', this.onPointerUp, { capture: true, signal })
    c.addEventListener('pointercancel', this.onPointerUp, { capture: true, signal })
    c.addEventListener('lostpointercapture', this.onLostPointerCapture, { signal })
    c.addEventListener('mousedown', this.onMouseDown, { capture: true, signal })
    c.addEventListener('auxclick', this.onAuxClick, { capture: true, signal })
    // Only touchstart is non-passive; touchmove listeners exist just during two-finger gestures.
    c.addEventListener('touchstart', this.onTouchStart, { passive: false, signal })
    c.addEventListener('gesturestart', this.onSafariGestureStart as EventListener, { passive: false, signal })
    c.addEventListener('gesturechange', this.onSafariGestureChange as EventListener, { passive: false, signal })
    c.addEventListener('gestureend', this.onSafariGestureEnd as EventListener, { passive: false, signal })
    window.addEventListener('keydown', this.onKeyDown, { signal })
    window.addEventListener('keyup', this.onKeyUp, { signal })
    window.addEventListener('blur', this.onWindowBlur, { signal })
    const unsubTool = useEditor.subscribe((s) => s.tool, () => this.updatePanAttributes())
    const unsubFit = useEditor.subscribe((s) => s.fitMode, (mode) => this.onFitModeChanged(mode))
    this.updatePanAttributes()
    return () => {
      ac.abort()
      unsubTool()
      unsubFit()
      this.pinchListeners?.abort()
      this.pinchListeners = null
    }
  }

  /** Container size changed (window resize, side panel toggled, phone rotated). */
  onResize(): void {
    const c = this.container
    const st = useEditor.getState()
    if (!c || !this.pages.length) return
    this.scheduleViewportSettled()
    if (!st.fitMode) {
      this.captureView()
      this.updateCurrentPage()
      return
    }
    const fit = this.computeFit(st.fitMode)
    if (Math.abs(fit - st.scale) < EPSILON) {
      this.captureView()
      this.updateCurrentPage()
      return
    }
    // Panels animate their width: treat refits as a continuous gesture (re-render once settled).
    this.markGesture()
    const v = this.visibleRect(false)
    const top = this.view.top
    const anchor = top ? { ...top, clientX: (v.left + v.right) / 2, clientY: v.top } : null
    this.setScale(fit, st.fitMode, anchor, this.view.atTop)
  }

  setDevicePixelRatio(dpr: number): void {
    this.setRenderSettings({ ...this.renderSettings, dpr: dpr > 0 ? dpr : 1 })
  }

  // -------------------------------------------------------------------------
  // Render settings (a tiny external store for the page canvases)
  // -------------------------------------------------------------------------

  readonly subscribeRender = (listener: () => void): (() => void) => {
    this.renderListeners.add(listener)
    return () => {
      this.renderListeners.delete(listener)
    }
  }

  readonly getRenderSettings = (): RenderSettings => this.renderSettings

  private setRenderSettings(next: RenderSettings): void {
    if (next.scale === this.renderSettings.scale && next.dpr === this.renderSettings.dpr) return
    this.renderSettings = next
    for (const l of this.renderListeners) l()
  }

  private markGesture(): void {
    this.lastGestureAt = performance.now()
  }

  private scheduleRenderScale(scale: number): void {
    clearTimeout(this.settleTimer)
    const c = this.container
    if (performance.now() - this.lastGestureAt < GESTURE_WINDOW_MS) {
      c?.setAttribute('data-zooming', '')
      // Keep showing the stretched bitmaps; re-render crisply once the zoom settles.
      this.settleTimer = setTimeout(() => {
        this.container?.removeAttribute('data-zooming')
        this.setRenderSettings({ ...this.renderSettings, scale: this.renderedScale })
      }, ZOOM_SETTLE_MS)
    } else {
      c?.removeAttribute('data-zooming')
      this.setRenderSettings({ ...this.renderSettings, scale })
    }
  }

  /** Notified (debounced) once scrolling or resizing settles; high-zoom detail renders listen to it. */
  readonly subscribeViewport = (listener: () => void): (() => void) => {
    this.viewportListeners.add(listener)
    return () => {
      this.viewportListeners.delete(listener)
    }
  }

  private scheduleViewportSettled(): void {
    clearTimeout(this.viewportTimer)
    this.viewportTimer = setTimeout(() => {
      for (const l of this.viewportListeners) l()
    }, VIEWPORT_SETTLE_MS)
  }

  /** The visible part of the document area in client coordinates (null when not mounted). */
  visibleClientRect(): ClientRect | null {
    return this.container ? this.visibleRect(false) : null
  }

  /** A continuous zoom gesture is in progress (bitmaps are stretched; renders wait for it to settle). */
  isZooming(): boolean {
    return this.container?.hasAttribute('data-zooming') ?? false
  }

  /** Render-queue priority of a page frame: visible pages first (closest to the center first), then by distance. */
  renderPriority(el: Element | null): number {
    if (!el || !this.container || !el.isConnected) return Number.MAX_SAFE_INTEGER
    const r = el.getBoundingClientRect()
    const v = this.visibleRect(false)
    const d = distanceToViewport(r, v)
    if (d > 0) return d
    return -1 + Math.min(0.99, Math.abs((r.top + r.bottom) / 2 - (v.top + v.bottom) / 2) / 1e5)
  }

  // -------------------------------------------------------------------------
  // ViewerHandle
  // -------------------------------------------------------------------------

  getScrollContainer(): HTMLElement | null {
    return this.container
  }

  getPageElement(index: number): HTMLElement | null {
    return this.frames[index] ?? null
  }

  clientToPage(clientX: number, clientY: number): PagePoint | null {
    const n = this.pages.length
    if (!n || !this.framesReady()) return null
    const rects = this.rectCache()
    const i = spanIndexAt(n, rects.span, clientY)
    if (i < 0) return null
    const r = rects.get(i)
    if (clientX < r.left || clientX > r.right) return null
    const info = this.pages[i]
    const s = this.renderedScale
    return { page: i, ...clampPoint({ x: (clientX - r.left) / s, y: (clientY - r.top) / s }, info.width, info.height) }
  }

  pageToClient(page: number, p: Point): Point | null {
    const frame = this.frames[page]
    if (!frame) return null
    const r = frame.getBoundingClientRect()
    return { x: r.left + p.x * this.renderedScale, y: r.top + p.y * this.renderedScale }
  }

  getVisibleCenter(): PagePoint | null {
    if (!this.container || !this.pages.length) return null
    const v = this.visibleRect(true)
    const cx = (v.left + v.right) / 2
    const cy = (v.top + v.bottom) / 2
    const hit = this.clientToPage(cx, cy)
    if (hit) return hit
    const near = this.pagePointAt(cx, cy)
    const frame = near ? this.frames[near.page] : null
    if (!near || !frame) return null
    // Pull the point onto the visible part of the nearest page.
    const r = frame.getBoundingClientRect()
    const left = Math.max(r.left, v.left)
    const right = Math.min(r.right, v.right)
    const top = Math.max(r.top, v.top)
    const bottom = Math.min(r.bottom, v.bottom)
    const x = left <= right ? clamp(cx, left, right) : clamp(cx, r.left, r.right)
    const y = top <= bottom ? clamp(cy, top, bottom) : clamp(cy, r.top, r.bottom)
    const info = this.pages[near.page]
    const s = this.renderedScale
    return { page: near.page, ...clampPoint({ x: (x - r.left) / s, y: (y - r.top) / s }, info.width, info.height) }
  }

  scrollToPage(index: number, opts?: { behavior?: ScrollBehavior }): void {
    const c = this.container
    const n = this.pages.length
    if (!c || !n) return
    const i = clamp(Math.round(index), 0, n - 1)
    const frame = this.frames[i]
    if (!frame) return
    const r = frame.getBoundingClientRect()
    const v = this.visibleRect(false)
    const dy = i === 0 ? -c.scrollTop : r.top - v.top - SCROLL_TOP_MARGIN
    let dx = 0
    if (r.left < v.left || r.right > v.right) {
      dx =
        r.width <= v.right - v.left
          ? (r.left + r.right) / 2 - (v.left + v.right) / 2
          : r.left - v.left - horizontalPadding(c.clientWidth)
    }
    const behavior = opts?.behavior ?? this.autoBehavior(dy)
    this.lockCurrentPage(i, behavior)
    useEditor.getState().setCurrentPage(i)
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return
    c.scrollBy({ left: dx, top: dy, behavior })
  }

  /**
   * Scrolls so `rect` on `page` is visible with some margin, clear of the tool dock. `inlineEnd`: a
   * rect wider than the view has its right edge lined up rather than its left one (where the text of
   * a right-to-left or right-aligned field sits).
   */
  scrollToRect(page: number, rect: Rect, opts?: ScrollToRectOptions): void {
    const c = this.container
    const frame = this.frames[page]
    if (!c || !frame) return
    const s = this.renderedScale
    const r = frame.getBoundingClientRect()
    const left = r.left + rect.x * s
    const top = r.top + rect.y * s
    const right = left + Math.max(0, rect.width) * s
    const bottom = top + Math.max(0, rect.height) * s
    const v = this.visibleRect(true)
    const margin = Math.max(0, opts?.margin ?? 48)
    const dy = revealDelta(top, bottom, v.top, v.bottom, Math.min(margin, (v.bottom - v.top) / 4))
    const dx = revealDelta(left, right, v.left, v.right, Math.min(margin, (v.right - v.left) / 4), opts?.inlineEnd)
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return
    c.scrollBy({ left: dx, top: dy, behavior: opts?.behavior ?? this.autoBehavior(dy) })
  }

  zoomTo(scale: number, anchor?: { clientX: number; clientY: number }): void {
    if (!this.container) {
      useEditor.getState().setScale(clampScale(scale), null)
      return
    }
    const v = this.visibleRect(false)
    const clientX = anchor?.clientX ?? (v.left + v.right) / 2
    const clientY = anchor?.clientY ?? (v.top + v.bottom) / 2
    const p = this.pagePointAt(clientX, clientY)
    this.setScale(scale, null, p ? { ...p, clientX, clientY } : null)
  }

  zoomIn(): void {
    this.zoomTo(stepZoom(useEditor.getState().scale, 1))
  }

  zoomOut(): void {
    this.zoomTo(stepZoom(useEditor.getState().scale, -1))
  }

  fitWidth(): void {
    const c = this.container
    if (!c) return void useEditor.getState().setScale(useEditor.getState().scale, 'width')
    const v = this.visibleRect(false)
    const cx = (v.left + v.right) / 2
    const top = this.pagePointAt(cx, v.top)
    this.setScale(this.computeFit('width'), 'width', top ? { ...top, clientX: cx, clientY: v.top } : null, c.scrollTop <= 1)
  }

  fitPage(): void {
    const c = this.container
    if (!c || !this.pages.length) return void useEditor.getState().setScale(useEditor.getState().scale, 'page')
    const page = clamp(useEditor.getState().currentPage, 0, this.pages.length - 1)
    const v = this.visibleRect(false)
    // Show the whole current page: its top edge lands just below the top padding.
    const anchor: PageAnchor = {
      page,
      x: this.pages[page].width / 2,
      y: 0,
      clientX: (v.left + v.right) / 2,
      clientY: v.top + PAD_TOP,
    }
    this.lockCurrentPage(page, 'auto')
    this.setScale(this.computeFit('page'), 'page', anchor, page === 0)
  }

  // -------------------------------------------------------------------------
  // Scale & anchoring
  // -------------------------------------------------------------------------

  private computeFit(mode: FitMode): number {
    const c = this.container
    if (!c || !this.pages.length) return useEditor.getState().scale
    return computeFitScale({
      mode,
      viewportWidth: c.clientWidth,
      viewportHeight: c.clientHeight,
      pages: this.pages,
      padX: horizontalPadding(c.clientWidth),
      padTop: PAD_TOP,
      padBottom: PAD_BOTTOM,
    })
  }

  /** Sets the zoom; once React has rendered it, `anchor` is kept at its client position. */
  private setScale(target: number, fitMode: FitMode | null, anchor: PageAnchor | null, keepTop = false): void {
    const st = useEditor.getState()
    const next = clampScale(target)
    if (Math.abs(next - st.scale) < EPSILON) {
      if (st.fitMode !== fitMode) st.setScale(next, fitMode)
      if (Math.abs(next - this.renderedScale) > EPSILON) {
        // A commit for this scale is still pending; let it use the newest anchor.
        this.pendingAnchor = anchor ? { anchor, keepTop } : null
      } else if (anchor) {
        // Same zoom: only the anchor moved (two-finger pan, re-fit) — the DOM is in sync, apply now.
        this.applyAnchor(anchor, keepTop)
      }
      return
    }
    this.pendingAnchor = anchor ? { anchor, keepTop } : null
    st.setScale(next, fitMode)
  }

  private defaultAnchor(): { anchor: PageAnchor; keepTop: boolean } | null {
    const center = this.view.center
    if (!center || !this.container) return null
    const v = this.visibleRect(false)
    return { anchor: { ...center, clientX: (v.left + v.right) / 2, clientY: (v.top + v.bottom) / 2 }, keepTop: this.view.atTop }
  }

  private applyAnchor(a: PageAnchor, keepTop: boolean): void {
    const c = this.container
    const frame = this.frames[a.page]
    if (!c || !frame) return
    const r = frame.getBoundingClientRect()
    const { dx, dy } = anchorScrollDelta(r.left, r.top, this.renderedScale, a)
    if (Math.abs(dx) >= 0.01) c.scrollLeft += dx
    if (keepTop) c.scrollTop = 0
    else if (Math.abs(dy) >= 0.01) c.scrollTop += dy
  }

  private onFitModeChanged(mode: FitMode | null): void {
    const st = useEditor.getState()
    // While a new document is being swapped in, resetForDocument applies the fit instead.
    if (!mode || !this.container || !this.pages.length || st.doc?.pages !== this.pages) return
    const fit = this.computeFit(mode)
    if (Math.abs(fit - st.scale) > EPSILON) {
      const v = this.visibleRect(false)
      const cx = (v.left + v.right) / 2
      const top = this.pagePointAt(cx, v.top)
      this.setScale(fit, mode, top ? { ...top, clientX: cx, clientY: v.top } : null, this.container.scrollTop <= 1)
    }
  }

  // -------------------------------------------------------------------------
  // Geometry helpers (DOM)
  // -------------------------------------------------------------------------

  /**
   * The scroll container's visible box in client coordinates (scrollbars excluded). `excludeDock`:
   * without the strip the tool dock covers, as it is now (see `dockCover`).
   */
  private visibleRect(excludeDock: boolean): ClientRect {
    const c = this.container
    if (!c) return { left: 0, top: 0, right: 0, bottom: 0 }
    const r = c.getBoundingClientRect()
    const left = r.left + c.clientLeft
    const top = r.top + c.clientTop
    const view = { left, top, right: left + c.clientWidth, bottom: top + c.clientHeight }
    return excludeDock ? { ...view, bottom: Math.max(top, view.bottom - dockCover(view)) } : view
  }

  private framesReady(): boolean {
    for (let i = 0; i < this.pages.length; i++) if (!this.frames[i]) return false
    return true
  }

  /** Lazily measured frame rects for one synchronous computation. */
  private rectCache() {
    const cache: DOMRect[] = []
    const get = (i: number): DOMRect => (cache[i] ??= this.frames[i]!.getBoundingClientRect())
    const span = (i: number): Span => {
      const r = get(i)
      return { start: r.top, end: r.bottom }
    }
    return { get, span }
  }

  /** Page point (unclamped) under a client position, using the nearest page. */
  private pagePointAt(clientX: number, clientY: number): PagePoint | null {
    const n = this.pages.length
    if (!n || !this.framesReady()) return null
    const rects = this.rectCache()
    const i = nearestSpanIndex(n, rects.span, clientY)
    const r = rects.get(i)
    const s = this.renderedScale
    return { page: i, x: (clientX - r.left) / s, y: (clientY - r.top) / s }
  }

  private captureView(): void {
    const c = this.container
    if (!c || !this.pages.length) return
    const v = this.visibleRect(false)
    const cx = (v.left + v.right) / 2
    this.view = {
      center: this.pagePointAt(cx, (v.top + v.bottom) / 2),
      top: this.pagePointAt(cx, v.top),
      atTop: c.scrollTop <= 1,
    }
  }

  private isPageVisible(index: number): boolean {
    const frame = this.frames[index]
    if (!frame || !this.container) return false
    return distanceToViewport(frame.getBoundingClientRect(), this.visibleRect(false)) === 0
  }

  private lockCurrentPage(page: number, behavior: ScrollBehavior): void {
    // Generous upper bound for a browser smooth scroll; user input releases the lock earlier.
    this.navLock = { page, until: performance.now() + (behavior === 'smooth' ? 1200 : 0) }
  }

  private autoBehavior(distance: number): ScrollBehavior {
    if (prefersReducedMotion() || !this.container) return 'auto'
    return Math.abs(distance) > this.container.clientHeight * SMOOTH_SCROLL_MAX_VIEWPORTS ? 'auto' : 'smooth'
  }

  // -------------------------------------------------------------------------
  // Current page
  // -------------------------------------------------------------------------

  private onScroll = (): void => {
    this.scheduleViewportSettled()
    if (this.scrollFrame) return
    this.scrollFrame = requestAnimationFrame(() => {
      this.scrollFrame = 0
      this.updateCurrentPage()
      this.captureView()
    })
  }

  private updateCurrentPage(): void {
    const c = this.container
    const n = this.pages.length
    if (!c || !n || !this.framesReady()) return
    const st = useEditor.getState()
    const lock = this.navLock
    if (lock) {
      if (lock.page < n && (performance.now() < lock.until || this.isPageVisible(lock.page))) {
        st.setCurrentPage(lock.page)
        return
      }
      this.navLock = null
    }
    let index: number
    if (c.scrollTop <= 1) index = 0
    else if (c.scrollTop + c.clientHeight >= c.scrollHeight - 2) index = n - 1
    else {
      const v = this.visibleRect(false)
      index = nearestSpanIndex(n, this.rectCache().span, (v.top + v.bottom) / 2)
    }
    st.setCurrentPage(index)
  }

  // -------------------------------------------------------------------------
  // Wheel & Safari trackpad zoom
  // -------------------------------------------------------------------------

  private onWheel = (e: WheelEvent): void => {
    this.navLock = null
    if (!e.ctrlKey && !e.metaKey) return
    // Never let the browser page-zoom over the document.
    e.preventDefault()
    const c = this.container
    if (!c || useEditor.getState().activeDialog) return
    this.markGesture()
    // Trackpad pinch arrives as ctrl+wheel without the Ctrl key being held.
    const pinch = e.ctrlKey && !this.ctrlDown && !this.metaDown
    this.wheel.log += wheelZoomLog(wheelDeltaPx(e, c.clientHeight), pinch)
    this.wheel.clientX = e.clientX
    this.wheel.clientY = e.clientY
    if (!this.wheel.frame) this.wheel.frame = requestAnimationFrame(this.flushWheel)
  }

  private flushWheel = (): void => {
    this.wheel.frame = 0
    const log = this.wheel.log
    this.wheel.log = 0
    if (!log) return
    this.zoomTo(useEditor.getState().scale * Math.exp(log), { clientX: this.wheel.clientX, clientY: this.wheel.clientY })
  }

  private onSafariGestureStart = (e: GestureEventLike): void => {
    e.preventDefault()
    // On iOS the same pinch is handled through touch events.
    if (this.touchTargets.size) return
    this.safariGestureScale = useEditor.getState().scale
  }

  private onSafariGestureChange = (e: GestureEventLike): void => {
    e.preventDefault()
    if (this.touchTargets.size || this.safariGestureScale === null) return
    this.markGesture()
    this.safariTarget = { scale: this.safariGestureScale * e.scale, clientX: e.clientX, clientY: e.clientY }
    if (!this.safariFrame) {
      this.safariFrame = requestAnimationFrame(() => {
        this.safariFrame = 0
        const t = this.safariTarget
        this.safariTarget = null
        if (t) this.zoomTo(t.scale, t)
      })
    }
  }

  private onSafariGestureEnd = (e: GestureEventLike): void => {
    e.preventDefault()
    this.safariGestureScale = null
  }

  // -------------------------------------------------------------------------
  // Touch pinch
  // -------------------------------------------------------------------------

  private onTouchStart = (e: TouchEvent): void => {
    this.navLock = null
    if (e.touches.length < 2) {
      // Authoritative "one finger down": forget pointers whose end we may have missed (e.g. their
      // element was removed mid-gesture). The newest entry is the finger that just went down.
      const latest = [...this.touchTargets].pop()
      this.touchTargets.clear()
      if (latest) this.touchTargets.set(latest[0], latest[1])
      this.suppressTouch = false
      return
    }
    this.beginTouchSuppression()
    if (!this.pinch) {
      const [a, b] = [e.touches[0], e.touches[1]]
      const midX = (a.clientX + b.clientX) / 2
      const midY = (a.clientY + b.clientY) / 2
      const anchor = this.pagePointAt(midX, midY)
      if (anchor) {
        this.pinch = { startScale: useEditor.getState().scale, startDistance: touchDistance(a, b), anchor }
        this.container?.setAttribute('data-pinching', '')
      }
    }
    if (e.cancelable) e.preventDefault()
    if (!this.pinchListeners && this.container) {
      this.pinchListeners = new AbortController()
      const opts = { passive: false, signal: this.pinchListeners.signal }
      this.container.addEventListener('touchmove', this.onTouchMove, opts)
      this.container.addEventListener('touchend', this.onTouchEnd, opts)
      this.container.addEventListener('touchcancel', this.onTouchEnd, opts)
    }
  }

  private onTouchMove = (e: TouchEvent): void => {
    const pinch = this.pinch
    if (!pinch || e.touches.length < 2) return
    // Not cancelable = the browser already started scrolling with these fingers; leave it alone.
    if (!e.cancelable) return
    e.preventDefault()
    const [a, b] = [e.touches[0], e.touches[1]]
    this.markGesture()
    this.pinchTarget = {
      scale: pinchScale(pinch.startScale, pinch.startDistance, touchDistance(a, b)),
      clientX: (a.clientX + b.clientX) / 2,
      clientY: (a.clientY + b.clientY) / 2,
    }
    if (!this.pinchFrame) this.pinchFrame = requestAnimationFrame(this.flushPinch)
  }

  private flushPinch = (): void => {
    this.pinchFrame = 0
    const t = this.pinchTarget
    const pinch = this.pinch
    this.pinchTarget = null
    if (!t || !pinch) return
    // The page point that was under the fingers' midpoint at the start follows the midpoint.
    this.setScale(t.scale, null, { ...pinch.anchor, clientX: t.clientX, clientY: t.clientY })
  }

  private onTouchEnd = (e: TouchEvent): void => {
    if (e.touches.length < 2 && this.pinch) {
      if (this.pinchFrame) {
        cancelAnimationFrame(this.pinchFrame)
        this.flushPinch()
      }
      this.pinch = null
    }
    if (e.touches.length === 0) {
      this.pinchListeners?.abort()
      this.pinchListeners = null
      this.touchTargets.clear()
      this.suppressTouch = false
      this.container?.removeAttribute('data-pinching')
    }
  }

  /**
   * A second finger landed: from now until every finger lifts, touch pointer events stop at the
   * container, and the layers get a `pointercancel` for the fingers they already saw — exactly what
   * a browser does when it takes over a touch for a native gesture.
   */
  private beginTouchSuppression(): void {
    if (this.suppressTouch) return
    this.suppressTouch = true
    this.dispatchingCancel = true
    try {
      for (const [pointerId, target] of this.touchTargets) {
        if (!(target instanceof Element) || !target.isConnected) continue
        target.dispatchEvent(new PointerEvent('pointercancel', { pointerId, pointerType: 'touch', bubbles: true, isPrimary: true }))
      }
    } finally {
      this.dispatchingCancel = false
    }
  }

  // -------------------------------------------------------------------------
  // Panning (hand tool, Space + drag, middle mouse)
  // -------------------------------------------------------------------------

  private onPointerDown = (e: PointerEvent): void => {
    this.navLock = null
    if (e.pointerType === 'touch') {
      // Pinch detection itself happens in touchstart (which follows), where the finger count is reliable.
      this.touchTargets.set(e.pointerId, e.target)
      if (this.suppressTouch && !this.dispatchingCancel) e.stopPropagation()
      return
    }
    const c = this.container
    if (!c || this.pan) return
    const wantsPan = e.button === 1 || (e.button === 0 && (this.spaceHeld || useEditor.getState().tool === 'hand'))
    if (!wantsPan || this.isOnScrollbar(e)) return
    e.preventDefault()
    e.stopPropagation()
    try {
      c.setPointerCapture(e.pointerId)
    } catch {
      /* pointer already gone */
    }
    this.pan = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, scrollLeft: c.scrollLeft, scrollTop: c.scrollTop }
    window.getSelection()?.removeAllRanges()
    this.updatePanAttributes()
  }

  private onPointerMove = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') {
      if (this.suppressTouch && !this.dispatchingCancel) e.stopPropagation()
      return
    }
    const pan = this.pan
    const c = this.container
    if (!pan || !c || e.pointerId !== pan.pointerId) return
    e.preventDefault()
    e.stopPropagation()
    // Absolute (start − delta), so per-event rounding of scroll offsets can't accumulate.
    c.scrollLeft = pan.scrollLeft - (e.clientX - pan.x)
    c.scrollTop = pan.scrollTop - (e.clientY - pan.y)
  }

  private onPointerUp = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') {
      if (this.dispatchingCancel) return
      if (this.suppressTouch) e.stopPropagation()
      this.touchTargets.delete(e.pointerId)
      if (!this.touchTargets.size && !this.pinch) this.suppressTouch = false
      return
    }
    if (this.pan && e.pointerId === this.pan.pointerId) {
      e.stopPropagation()
      this.endPan()
    }
  }

  private onLostPointerCapture = (e: PointerEvent): void => {
    if (this.pan && e.pointerId === this.pan.pointerId) this.endPan()
  }

  /** Middle-click autoscroll (Windows/Linux) would fight our middle-drag panning. */
  private onMouseDown = (e: MouseEvent): void => {
    if (e.button === 1) e.preventDefault()
  }

  private onAuxClick = (e: MouseEvent): void => {
    if (e.button === 1) e.preventDefault()
  }

  private endPan(): void {
    const c = this.container
    const pan = this.pan
    this.pan = null
    if (c && pan && c.hasPointerCapture?.(pan.pointerId)) {
      try {
        c.releasePointerCapture(pan.pointerId)
      } catch {
        /* already released */
      }
    }
    this.updatePanAttributes()
  }

  private isOnScrollbar(e: PointerEvent): boolean {
    const c = this.container
    if (!c) return false
    const r = c.getBoundingClientRect()
    const x = e.clientX - r.left - c.clientLeft
    const y = e.clientY - r.top - c.clientTop
    return x < 0 || y < 0 || x >= c.clientWidth || y >= c.clientHeight
  }

  /** `data-pan-ready` (hand tool / Space held) and `data-panning` (dragging) on the scroll container. */
  private updatePanAttributes(): void {
    const c = this.container
    if (!c) return
    const ready = this.spaceHeld || useEditor.getState().tool === 'hand' || this.pan !== null
    c.toggleAttribute('data-pan-ready', ready)
    c.toggleAttribute('data-panning', this.pan !== null)
  }

  // -------------------------------------------------------------------------
  // Keyboard
  // -------------------------------------------------------------------------

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Control') this.ctrlDown = true
    else if (e.key === 'Meta') this.metaDown = true
    else if (e.key !== 'Shift' && e.key !== 'Alt') this.navLock = null
    // Another handler (e.g. the shell's shortcut fallback) already took this key.
    if (e.defaultPrevented) return

    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      const zoomIn = e.key === '=' || e.key === '+' || e.code === 'NumpadAdd'
      const zoomOut = e.key === '-' || e.key === '_' || e.code === 'NumpadSubtract'
      const fit = e.key === '0' || e.code === 'Digit0' || e.code === 'Numpad0'
      if (!zoomIn && !zoomOut && !fit) return
      // Blocks the browser's own page zoom.
      e.preventDefault()
      if (modalOpen()) return
      if (zoomIn) this.zoomIn()
      else if (zoomOut) this.zoomOut()
      else this.fitWidth()
      return
    }

    if ((e.key === ' ' || e.code === 'Space') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (isEditableTarget(e.target) || isActivatable(e.target) || modalOpen()) return
      // Space pans instead of scrolling by a screenful.
      e.preventDefault()
      if (!this.spaceHeld) {
        this.spaceHeld = true
        this.updatePanAttributes()
      }
    }
  }

  private onKeyUp = (e: KeyboardEvent): void => {
    if (e.key === 'Control') this.ctrlDown = false
    else if (e.key === 'Meta') this.metaDown = false
    else if ((e.key === ' ' || e.code === 'Space') && this.spaceHeld) {
      this.spaceHeld = false
      this.updatePanAttributes()
    }
  }

  private onWindowBlur = (): void => {
    this.ctrlDown = false
    this.metaDown = false
    if (this.spaceHeld) {
      this.spaceHeld = false
      this.updatePanAttributes()
    }
    if (this.pan) this.endPan()
  }
}
