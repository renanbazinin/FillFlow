import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Eraser, Undo2 } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { cn, modKeyLabel } from '../../lib/utils/misc'
import { Tooltip } from '../../components/ui/tooltip'
import { useSignatureDraft } from './draft'
import type { SignatureRole } from './library'
import { InkSwatches, PenWidthPicker } from './parts'
import { paintStrokes } from './render'
import { PAD_UNITS, PEN_SIZES, strokeOutline, type Stroke } from './strokes'
import { PAD_FRAME } from './styles'

interface Live {
  pointerId: number
  stroke: Stroke
}

/** Minimum distance (pad units) between recorded points; filters jitter and duplicates. */
const MIN_STEP = 0.6

export function DrawPad({ role }: { role: SignatureRole }) {
  const strokes = useSignatureDraft((s) => s.strokes[role])
  const color = useSignatureDraft((s) => s.color)
  const pen = useSignatureDraft((s) => s.pen)
  const setColor = useSignatureDraft((s) => s.setColor)
  const setPen = useSignatureDraft((s) => s.setPen)
  const undo = useSignatureDraft((s) => s.undoStroke)
  const clear = useSignatureDraft((s) => s.clearStrokes)
  const [inking, setInking] = useState(false)

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
    for (const ev of events.length ? events : [native]) {
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
  const noun = role === 'signature' ? 'signature' : 'initials'

  return (
    <div>
      <div className={cn('relative select-none overflow-hidden rounded-xl border border-line bg-white shadow-xs', PAD_FRAME[role])}>
        {/* Guides: part of the pad, never of the output. */}
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
            'pointer-events-none absolute inset-x-0 top-[68%] pt-2.5 text-center text-xs font-medium text-black/40 transition-opacity duration-300',
            !empty && 'opacity-0',
          )}
        >
          {role === 'signature' ? 'Sign above the line' : 'Write your initials above the line'}
        </div>
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={`Drawing area for your ${noun}. Draw with a mouse, finger or stylus${strokes.length ? `; ${strokes.length} ${strokes.length === 1 ? 'stroke' : 'strokes'} so far` : ''}.`}
          className="absolute inset-0 size-full cursor-crosshair touch-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={finish}
          onPointerCancel={finish}
          onLostPointerCapture={finish}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <InkSwatches value={color} onChange={setColor} />
        <span aria-hidden className="h-5 w-px bg-line" />
        <PenWidthPicker value={pen} onChange={setPen} />
        <div className="ml-auto flex items-center gap-0.5">
          <Tooltip content="Undo last stroke" shortcut={`${modKeyLabel}+Z`} side="top">
            <Button variant="ghost" size="sm" onClick={() => undo(role)} disabled={!strokes.length} aria-label="Undo last stroke">
              <Undo2 />
              <span className="max-sm:hidden">Undo</span>
            </Button>
          </Tooltip>
          <Button variant="ghost" size="sm" onClick={() => clear(role)} disabled={!strokes.length} aria-label="Clear drawing">
            <Eraser />
            <span className="max-sm:hidden">Clear</span>
          </Button>
        </div>
      </div>
    </div>
  )
}
