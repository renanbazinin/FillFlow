import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Eraser, Undo2 } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { useT } from '../../i18n'
import { cn, modKeyLabel } from '../../lib/utils/misc'
import { Tooltip } from '../../components/ui/tooltip'
import { useSignatureDraft } from './draft'
import type { SignatureRole } from './library'
import { InkSwatches, PenWidthPicker } from './parts'
import { paintStrokes } from './render'
import { PAD_UNITS, PEN_SIZES, strokeOutline, type Stroke } from './strokes'
import { PAD_FRAME, SOFT_DISABLED } from './styles'

interface Live {
  pointerId: number
  stroke: Stroke
}

/** Minimum distance (pad units) between recorded points; filters jitter and duplicates. */
const MIN_STEP = 0.6

/**
 * The part of `el` that can be seen: its box, cut by the ancestors that clip what overflows them
 * (up to the fixed-position dialog, which nothing above clips) and by the window.
 */
function visibleRect(el: Element): Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom'> {
  const r = el.getBoundingClientRect()
  const rect = { left: Math.max(r.left, 0), top: Math.max(r.top, 0), right: Math.min(r.right, innerWidth), bottom: Math.min(r.bottom, innerHeight) }
  for (let p = el.parentElement; p; p = p.parentElement) {
    const style = getComputedStyle(p)
    if (style.overflowX !== 'visible' || style.overflowY !== 'visible') {
      const b = p.getBoundingClientRect()
      rect.left = Math.max(rect.left, b.left)
      rect.top = Math.max(rect.top, b.top)
      rect.right = Math.min(rect.right, b.right)
      rect.bottom = Math.min(rect.bottom, b.bottom)
    }
    if (style.position === 'fixed') break
  }
  return rect
}

export function DrawPad({
  role,
  controls = true,
}: {
  role: SignatureRole
  /** Show the DrawControls under the pad (false: they're shown elsewhere). */
  controls?: boolean
}) {
  const strokes = useSignatureDraft((s) => s.strokes[role])
  const color = useSignatureDraft((s) => s.color)
  const pen = useSignatureDraft((s) => s.pen)
  const [inking, setInking] = useState(false)
  const t = useT()

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const live = useRef<Live | null>(null)
  const frame = useRef(0)
  /** Committed strokes' outlines, cached per stroke and pen size. */
  const outlines = useRef(new WeakMap<Stroke, { size: number; outline: number[][] }>())
  const view = useRef({ strokes, color, size: PEN_SIZES[pen] })

  const paint = useRef(() => {
    frame.current = 0
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const { strokes: committed, color: ink, size } = view.current
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    const k = canvas.width / PAD_UNITS
    ctx.setTransform(k, 0, 0, k, 0, 0)
    const shapes = committed.map((s) => {
      const hit = outlines.current.get(s)
      if (hit && hit.size === size) return hit.outline
      const outline = strokeOutline(s, size)
      outlines.current.set(s, { size, outline })
      return outline
    })
    if (live.current) shapes.push(strokeOutline(live.current.stroke, size, false))
    paintStrokes(ctx, shapes, ink)
  })

  const schedule = () => {
    if (!frame.current) frame.current = requestAnimationFrame(() => paint.current())
  }

  // Repaint synchronously when the committed drawing or its style changes (no flicker on stroke end).
  useLayoutEffect(() => {
    view.current = { strokes, color, size: PEN_SIZES[pen] }
    paint.current()
  }, [strokes, color, pen])

  // Keep the backing store at device resolution.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0]
      const device = entry.devicePixelContentBoxSize?.[0]
      const w = device ? device.inlineSize : Math.round(entry.contentRect.width * devicePixelRatio)
      const h = device ? device.blockSize : Math.round(entry.contentRect.height * devicePixelRatio)
      if (w && h && (canvas.width !== w || canvas.height !== h)) {
        canvas.width = w
        canvas.height = h
        paint.current()
      }
    })
    try {
      ro.observe(canvas, { box: 'device-pixel-content-box' })
    } catch {
      ro.observe(canvas)
    }
    return () => {
      ro.disconnect()
      cancelAnimationFrame(frame.current)
      frame.current = 0
    }
  }, [])

  const addPoints = (e: ReactPointerEvent<HTMLCanvasElement>, l: Live) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const k = PAD_UNITS / rect.width
    const native = e.nativeEvent
    const events = native.getCoalescedEvents?.() ?? []
    // Off the part of the pad that shows (past its edge, under the dialog's footer…) ink would end up
    // in the signature unseen: the pen lifts there, and comes down again where it comes back.
    const { left, top, right, bottom } = visibleRect(e.currentTarget)
    for (const ev of events.length ? events : [native]) {
      if (ev.clientX < left || ev.clientX > right || ev.clientY < top || ev.clientY > bottom) {
        if (l.stroke.points.length) {
          useSignatureDraft.getState().addStroke(role, l.stroke)
          l.stroke = { points: [], simulate: l.stroke.simulate }
        }
        continue
      }
      const x = (ev.clientX - rect.left) * k
      const y = (ev.clientY - rect.top) * k
      const pts = l.stroke.points
      const last = pts[pts.length - 1]
      if (last && Math.hypot(x - last[0], y - last[1]) < MIN_STEP) continue
      pts.push([x, y, l.stroke.simulate ? 0.5 : ev.pressure || 0.5])
    }
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (live.current || (e.pointerType === 'mouse' && e.button !== 0)) return
    e.preventDefault()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      return // the pointer is already gone
    }
    const l: Live = { pointerId: e.pointerId, stroke: { points: [], simulate: e.pointerType !== 'pen' } }
    live.current = l
    addPoints(e, l)
    setInking(true)
    schedule()
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const l = live.current
    if (!l || e.pointerId !== l.pointerId) return
    addPoints(e, l)
    schedule()
  }

  const finish = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const l = live.current
    if (!l || e.pointerId !== l.pointerId) return
    live.current = null
    setInking(false)
    if (l.stroke.points.length) useSignatureDraft.getState().addStroke(role, l.stroke)
    else schedule()
  }

  const empty = strokes.length === 0 && !inking

  return (
    <div>
      <div data-signing-pad className={cn('relative select-none overflow-hidden rounded-xl border border-line bg-white shadow-xs', PAD_FRAME[role])}>
        {/* Guides: part of the pad, never of the output. The pad is the paper, not the interface: it
            isn't mirrored in a right-to-left one (the × marks the line's left end there too). */}
        <div aria-hidden className="pointer-events-none absolute inset-x-[6%] top-[68%] h-px bg-black/15" />
        <div
          aria-hidden
          className="pointer-events-none absolute left-[6%] top-[68%] -translate-y-full pb-0.5 font-display text-[22px] leading-none text-black/30"
        >
          ×
        </div>
        <div
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-x-0 top-[68%] pt-2.5 text-center text-xs font-medium text-black/60 transition-opacity duration-300',
            !empty && 'opacity-0',
          )}
        >
          {t.signature.draw.hint[role]}
        </div>
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={t.signature.draw.area[role](strokes.length)}
          className="absolute inset-0 size-full cursor-crosshair touch-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={finish}
          onPointerCancel={finish}
          onLostPointerCapture={finish}
        />
      </div>

      {controls && <DrawControls role={role} className="mt-3" />}
    </div>
  )
}

/** Ink color, pen width, Undo and Clear for the drawing pad. `compact`: Undo and Clear show icons only. */
export function DrawControls({ role, compact, className }: { role: SignatureRole; compact?: boolean; className?: string }) {
  const color = useSignatureDraft((s) => s.color)
  const pen = useSignatureDraft((s) => s.pen)
  const canUndo = useSignatureDraft((s) => s.strokes[role].length > 0)
  const setColor = useSignatureDraft((s) => s.setColor)
  const setPen = useSignatureDraft((s) => s.setPen)
  const undo = useSignatureDraft((s) => s.undoStroke)
  const clear = useSignatureDraft((s) => s.clearStrokes)
  const t = useT()
  const d = t.signature.draw

  return (
    // Touch screens: bigger targets, so tighter spacing (and no divider) to keep them on one line.
    // Undo and Clear go to the end of the row (right, or left in a right-to-left interface).
    <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-2 pointer-coarse:gap-x-2', className)}>
      <InkSwatches value={color} onChange={setColor} />
      <span aria-hidden className="h-5 w-px bg-line pointer-coarse:hidden" />
      <PenWidthPicker value={pen} onChange={setPen} />
      {/* aria-disabled: emptying the pad must not take focus away from the button just used. */}
      <div className="ms-auto flex items-center gap-0.5">
        <Tooltip content={d.undoStroke} shortcut={`${modKeyLabel}+Z`} side="top">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => canUndo && undo(role)}
            aria-disabled={!canUndo || undefined}
            aria-label={d.undoStroke}
            className={SOFT_DISABLED}
          >
            {/* It points back: the other way round right to left. */}
            <Undo2 className="rtl:-scale-x-100" />
            {!compact && <span className="max-sm:hidden">{d.undo}</span>}
          </Button>
        </Tooltip>
        <Tooltip content={d.clearDrawing} side="top">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => canUndo && clear(role)}
            aria-disabled={!canUndo || undefined}
            aria-label={d.clearDrawing}
            className={SOFT_DISABLED}
          >
            <Eraser />
            {!compact && <span className="max-sm:hidden">{d.clear}</span>}
          </Button>
        </Tooltip>
      </div>
    </div>
  )
}
