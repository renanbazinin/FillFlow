import type { Point } from '../../../model/types'
import { isEditableTarget } from '../../../lib/utils/misc'
import { viewer } from '../../viewer/viewerApi'

/** The parts of a pointer event the interactions need (also synthesized on modifier changes). */
export interface PointerSample {
  clientX: number
  clientY: number
  shiftKey: boolean
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  pointerType: string
}

export function sample(e: PointerEvent | MouseEvent): PointerSample {
  return {
    clientX: e.clientX,
    clientY: e.clientY,
    shiftKey: e.shiftKey,
    altKey: e.altKey,
    ctrlKey: e.ctrlKey,
    metaKey: e.metaKey,
    pointerType: 'pointerType' in e ? e.pointerType : 'mouse',
  }
}

export interface TrackHandlers {
  /** Pointer moved (or a modifier key changed; then `raw` is undefined). */
  move?(s: PointerSample, raw?: PointerEvent): void
  up?(s: PointerSample): void
  /** pointercancel, Escape, a second finger, or the tracker was disposed. */
  cancel?(): void
  /**
   * The owner went away mid-gesture (e.g. its page scrolled out of the mounted range during an
   * auto-scroll). Defaults to `cancel`; a move would rather keep what was done so far.
   */
  detach?(): void
}

/** Ends tracking early: 'cancel' (default) reverts, 'detach' lets the gesture keep its result. */
export type TrackDisposer = (reason?: 'cancel' | 'detach') => void

export interface TrackOptions {
  /** Element that captures the pointer (keeps events flowing outside the window). */
  capture?: Element | null
  /** Re-run `move` when Shift/Alt/Ctrl change mid-gesture. */
  modifiers?: boolean
  /** Escape cancels the gesture (default true). */
  escapeCancels?: boolean
  /** Scroll the viewer when the pointer nears its edges; `move` is re-run after each scroll step. */
  autoScroll?: boolean
}

/**
 * Follows one pointer until it's released. Listens on window so handlers keep receiving events
 * even if the pressed node re-renders away. Returns a disposer.
 */
export function trackPointer(down: PointerEvent, handlers: TrackHandlers, opts: TrackOptions = {}): TrackDisposer {
  const id = down.pointerId
  let last = sample(down)
  let done = false
  const scroller = opts.autoScroll ? createAutoScroller(() => !done && handlers.move?.(last)) : null

  try {
    opts.capture?.setPointerCapture(id)
  } catch {
    /* capture is best effort */
  }

  const onMove = (e: PointerEvent) => {
    if (e.pointerId !== id) return
    last = sample(e)
    handlers.move?.(last, e)
    scroller?.update(e.clientX, e.clientY)
  }
  const onUp = (e: PointerEvent) => {
    if (e.pointerId !== id) return
    last = sample(e)
    stop()
    handlers.up?.(last)
  }
  const onCancel = (e: PointerEvent) => {
    if (e.pointerId !== id) return
    stop()
    handlers.cancel?.()
  }
  const onOtherDown = (e: PointerEvent) => {
    // A second finger (pinch/scroll) aborts a one-finger gesture.
    if (e.pointerId !== id && down.pointerType === 'touch' && e.pointerType === 'touch') {
      stop()
      handlers.cancel?.()
    }
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && e.type === 'keydown' && opts.escapeCancels !== false) {
      e.preventDefault()
      e.stopPropagation()
      stop()
      handlers.cancel?.()
      return
    }
    if (opts.modifiers && (e.key === 'Shift' || e.key === 'Alt' || e.key === 'Control' || e.key === 'Meta')) {
      last = { ...last, shiftKey: e.shiftKey, altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey }
      handlers.move?.(last)
    }
  }
  const onBlur = () => {
    stop()
    handlers.cancel?.()
  }

  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onCancel)
  window.addEventListener('pointerdown', onOtherDown, true)
  window.addEventListener('keydown', onKey, true)
  window.addEventListener('keyup', onKey, true)
  window.addEventListener('blur', onBlur)

  function stop() {
    if (done) return
    done = true
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onCancel)
    window.removeEventListener('pointerdown', onOtherDown, true)
    window.removeEventListener('keydown', onKey, true)
    window.removeEventListener('keyup', onKey, true)
    window.removeEventListener('blur', onBlur)
    scroller?.stop()
    try {
      if (opts.capture?.hasPointerCapture(id)) opts.capture.releasePointerCapture(id)
    } catch {
      /* already released */
    }
  }

  return (reason = 'cancel') => {
    if (done) return
    stop()
    if (reason === 'detach' && handlers.detach) handlers.detach()
    else handlers.cancel?.()
  }
}

/** Client point → view-space point on the page whose layer is `node` (robust to CSS transforms). */
export function clientToLocal(node: HTMLElement, pageWidth: number, pageHeight: number, clientX: number, clientY: number): Point {
  const r = node.getBoundingClientRect()
  const kx = r.width ? pageWidth / r.width : 1
  const ky = r.height ? pageHeight / r.height : 1
  return { x: (clientX - r.left) * kx, y: (clientY - r.top) * ky }
}

/** The viewer owns the pointer: hand tool / Space held, a pan in progress, or a touch pinch. */
export function isPanning(): boolean {
  const sc = viewer.getScrollContainer()
  return !!sc && (sc.hasAttribute('data-panning') || sc.hasAttribute('data-pan-ready') || sc.hasAttribute('data-pinching'))
}

export const DRAG_THRESHOLD_PX = 3
export const TOUCH_DRAG_THRESHOLD_PX = 6

export function dragThreshold(pointerType: string): number {
  return pointerType === 'touch' ? TOUCH_DRAG_THRESHOLD_PX : DRAG_THRESHOLD_PX
}

const EDGE = 36
const MAX_STEP = 22

function edgeSpeed(p: number, min: number, max: number): number {
  if (max - min < EDGE * 3) return 0
  if (p < min + EDGE) return -Math.ceil(MAX_STEP * Math.min(1, (min + EDGE - p) / EDGE) ** 1.6)
  if (p > max - EDGE) return Math.ceil(MAX_STEP * Math.min(1, (p - (max - EDGE)) / EDGE) ** 1.6)
  return 0
}

/** Scrolls the viewer while the pointer is near (or beyond) its edges. */
function createAutoScroller(onScrolled: () => void) {
  let raf = 0
  let pointer: Point | null = null
  const tick = () => {
    raf = 0
    const sc = viewer.getScrollContainer()
    if (!sc || !pointer) return
    const r = sc.getBoundingClientRect()
    const vx = edgeSpeed(pointer.x, r.left, r.right)
    const vy = edgeSpeed(pointer.y, r.top, r.bottom)
    if (!vx && !vy) return
    const left = sc.scrollLeft
    const top = sc.scrollTop
    sc.scrollBy({ left: vx, top: vy, behavior: 'instant' })
    if (sc.scrollLeft === left && sc.scrollTop === top) return
    onScrolled()
    raf = requestAnimationFrame(tick)
  }
  return {
    update(x: number, y: number) {
      pointer = { x, y }
      if (!raf) raf = requestAnimationFrame(tick)
    },
    stop() {
      if (raf) cancelAnimationFrame(raf)
      raf = 0
      pointer = null
    },
  }
}

/** Drawing tools capture the press without moving focus; leave any text field the user was in. */
export function blurFocusedField(): void {
  const a = document.activeElement
  if (a instanceof HTMLElement && isEditableTarget(a)) a.blur()
}
