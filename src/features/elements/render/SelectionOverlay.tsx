import { memo } from 'react'
import { Lock } from 'lucide-react'
import type { Element } from '../../../model/types'
import { cn } from '../../../lib/utils/misc'
import { handleCursor, handlePoint, handlesFor, lineEndpoints } from '../lib/geometry'
import { useElementsUi } from '../state/ui'
import { isCoarsePointer } from './hitSize'

export interface SizeReadout {
  id: string
  text: string
}

interface SelectionOverlayProps {
  elements: Element[]
  selectedIds: string[]
  scale: number
  editingId: string | null
  /** Show resize handles (select tool, not moving). */
  showHandles: boolean
  /** Hide everything but the frames (e.g. while moving). */
  quiet: boolean
  readout: SizeReadout | null
}

/**
 * Selection chrome for one page: hover outline, selection frames, resize handles, line
 * endpoint handles, lock badges and the size readout. Handles carry data attributes that the
 * layer's pointer delegation reads (data-handle / data-handle-for).
 */
export const SelectionOverlay = memo(function SelectionOverlay({
  elements,
  selectedIds,
  scale,
  editingId,
  showHandles,
  quiet,
  readout,
}: SelectionOverlayProps) {
  const hoveredId = useElementsUi((s) => s.hoveredId)
  const selected = new Set(selectedIds)
  const hovered = !quiet && hoveredId && !selected.has(hoveredId) ? elements.find((e) => e.id === hoveredId) : undefined
  const sel = elements.filter((e) => selected.has(e.id) && e.id !== editingId)
  const single = sel.length === 1 && selectedIds.length === 1 ? sel[0] : null
  const readoutEl = readout ? elements.find((e) => e.id === readout.id) : undefined

  return (
    <>
      {hovered && <Outline el={hovered} scale={scale} hover />}
      {sel.map((el) => (
        <Outline key={el.id} el={el} scale={scale} />
      ))}
      {sel.length > 1 && <GroupFrame elements={sel} scale={scale} />}
      {single && showHandles && !single.locked && <Handles el={single} scale={scale} />}
      {sel.filter((e) => e.locked).map((el) => (
        <LockBadge key={el.id} el={el} scale={scale} />
      ))}
      {hovered?.locked && <LockBadge el={hovered} scale={scale} />}
      {readout && readoutEl && <Readout el={readoutEl} scale={scale} text={readout.text} />}
    </>
  )
})

function box(el: Element, scale: number) {
  return { left: el.x * scale, top: el.y * scale, width: el.width * scale, height: el.height * scale }
}

function Outline({ el, scale, hover }: { el: Element; scale: number; hover?: boolean }) {
  if (el.kind === 'shape' && el.shape === 'line') {
    const [a, b] = lineEndpoints(el)
    return (
      <svg className="pointer-events-none absolute left-0 top-0 z-[21] overflow-visible" width={1} height={1} aria-hidden>
        <line
          x1={a.x * scale}
          y1={a.y * scale}
          x2={b.x * scale}
          y2={b.y * scale}
          className="stroke-selection"
          strokeWidth={hover ? 1.5 : 1}
          strokeOpacity={hover ? 0.8 : 1}
        />
      </svg>
    )
  }
  const b = box(el, scale)
  return (
    <div
      className={cn(
        'pointer-events-none absolute z-[21] border-selection',
        hover ? 'border-[1.5px] opacity-80' : 'border',
        el.locked && !hover && 'border-dashed',
      )}
      style={{ left: b.left - 1, top: b.top - 1, width: b.width + 2, height: b.height + 2 }}
    />
  )
}

function GroupFrame({ elements, scale }: { elements: Element[]; scale: number }) {
  let x1 = Infinity
  let y1 = Infinity
  let x2 = -Infinity
  let y2 = -Infinity
  for (const e of elements) {
    x1 = Math.min(x1, e.x)
    y1 = Math.min(y1, e.y)
    x2 = Math.max(x2, e.x + e.width)
    y2 = Math.max(y2, e.y + e.height)
  }
  const pad = 4
  return (
    <div
      className="pointer-events-none absolute z-[21] rounded-[3px] border border-dashed border-selection/70"
      style={{ left: x1 * scale - pad, top: y1 * scale - pad, width: (x2 - x1) * scale + pad * 2, height: (y2 - y1) * scale + pad * 2 }}
    />
  )
}

/**
 * Visual handle square (9px) inside a bigger invisible hit area. `dx`/`dy` move the knob back
 * onto the true corner when the hit area is pushed outward (small items); only the hit area
 * takes presses, so a knob drawn over a small item's body doesn't turn a move into a resize.
 */
function HandleKnob({ round, dx = 0, dy = 0 }: { round?: boolean; dx?: number; dy?: number }) {
  return (
    <span
      className={cn(
        'pointer-events-none block size-[9px] border border-selection bg-white shadow-[0_0_0_0.5px_rgb(255_255_255),0_1px_2px_rgb(16_24_40/0.25)]',
        round ? 'rounded-full' : 'rounded-[2px]',
      )}
      style={dx || dy ? { transform: `translate(${dx}px, ${dy}px)` } : undefined}
    />
  )
}

function Handles({ el, scale }: { el: Element; scale: number }) {
  const kind = handlesFor(el)
  const coarse = isCoarsePointer()
  const hit = coarse ? 28 : 16
  if (kind === 'line') {
    const pts = lineEndpoints(el)
    return (
      <>
        {pts.map((p, i) => (
          <div
            key={i}
            data-handle={i === 0 ? 'p0' : 'p1'}
            data-handle-for={el.id}
            aria-hidden
            className="pointer-events-auto absolute z-[22] flex items-center justify-center"
            style={{ left: p.x * scale - hit / 2, top: p.y * scale - hit / 2, width: hit, height: hit, cursor: 'crosshair', touchAction: 'none' }}
          >
            <HandleKnob round />
          </div>
        ))}
      </>
    )
  }
  const w = el.width * scale
  const h = el.height * scale
  // On small items the hit areas move outward (the knobs stay on the corners) so the body
  // stays grabbable.
  const tight = Math.min(w, h) < hit * 2
  const push = tight ? hit / 2 - 3 : 0
  const pxBox = { x: el.x * scale, y: el.y * scale, width: w, height: h }
  // Side handles only when the side is long enough to tell them apart from the corners.
  const shown = kind.filter((hd) => {
    if (hd === 'n' || hd === 's') return w >= hit * 2.5
    if (hd === 'e' || hd === 'w') return h >= hit * 2.5
    return true
  })
  return (
    <>
      {shown.map((hd) => {
        const p = handlePoint(pxBox, hd)
        const dx = hd.includes('w') ? -push : hd.includes('e') ? push : 0
        const dy = hd.includes('n') ? -push : hd.includes('s') ? push : 0
        return (
          <div
            key={hd}
            data-handle={hd}
            data-handle-for={el.id}
            aria-hidden
            className="pointer-events-auto absolute z-[22] flex items-center justify-center"
            style={{ left: p.x + dx - hit / 2, top: p.y + dy - hit / 2, width: hit, height: hit, cursor: handleCursor(hd), touchAction: 'none' }}
          >
            <HandleKnob dx={-dx} dy={-dy} />
          </div>
        )
      })}
    </>
  )
}

function LockBadge({ el, scale }: { el: Element; scale: number }) {
  const b = box(el, scale)
  return (
    <div
      className="pointer-events-none absolute z-[22] flex size-[18px] items-center justify-center rounded-full border border-selection/30 bg-white text-selection shadow-[0_1px_3px_rgb(16_24_40/0.2)]"
      style={{ left: b.left + b.width - 4, top: b.top - 14 }}
      title="Locked"
    >
      <Lock className="size-[10px]" strokeWidth={2.5} />
    </div>
  )
}

function Readout({ el, scale, text }: { el: Element; scale: number; text: string }) {
  const b = box(el, scale)
  return (
    <div
      className="pointer-events-none absolute z-[24] -translate-x-1/2 whitespace-nowrap rounded-md bg-selection px-1.5 py-0.5 text-[11px] font-medium leading-4 text-white tabular-nums shadow-[0_1px_3px_rgb(16_24_40/0.25)]"
      style={{ left: b.left + b.width / 2, top: b.top + b.height + 10 }}
    >
      {text}
    </div>
  )
}
