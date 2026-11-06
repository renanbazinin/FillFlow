import { memo } from 'react'
import { useT } from '../../../i18n'
import { elementLabel } from '../../../model/elements'
import type { Element } from '../../../model/types'
import { useEditor } from '../../../store/editor'
import { lineEndpoints } from '../lib/geometry'
import { useElementsUi } from '../state/ui'
import { ElementContent } from './ElementContent'
import { isHighlight, isLine } from './helpers'
import { minHitPx } from './hitSize'

interface ElementViewProps {
  el: Element
  scale: number
  /** Select tool: the element can be hovered, pressed and dragged. */
  interactive: boolean
  /** Text being edited: the textarea draws it instead. */
  editing?: boolean
  /** Source of a cross-page drag. */
  dimmed?: boolean
}

/**
 * One placed element, positioned in page px. Each element is its own stacking context at
 * z-20 (above the form layer) so the highlight's multiply blend reaches the PDF canvas below.
 */
export const ElementView = memo(function ElementView({ el, scale, interactive, editing, dimmed }: ElementViewProps) {
  // The accessible name is in the interface's language.
  const t = useT()
  const w = el.width * scale
  const h = el.height * scale
  const highlight = isHighlight(el)
  return (
    <div
      data-element-id={el.id}
      data-kind={el.kind}
      role={el.kind === 'text' ? undefined : 'img'}
      aria-label={el.kind === 'text' ? undefined : elementLabel(el, t)}
      className="pointer-events-none absolute z-20"
      style={{
        left: el.x * scale,
        top: el.y * scale,
        width: w,
        height: h,
        mixBlendMode: highlight ? 'multiply' : undefined,
        opacity: dimmed ? 0.3 : undefined,
        visibility: editing ? 'hidden' : undefined,
      }}
    >
      <ElementContent el={el} scale={scale} />
      {interactive && !editing && <HitArea el={el} scale={scale} />}
    </div>
  )
})

function HitArea({ el, scale }: { el: Element; scale: number }) {
  const cursor = el.locked ? 'default' : 'move'
  // One finger on an item that isn't selected (or can't move) scrolls the document like the page
  // around it; a tap selects it, then a drag moves it. A pen grabs items straight away.
  const grabs = useEditor((s) => s.selection.includes(el.id)) && !el.locked
  const pen = useElementsUi((s) => s.penInput)
  const touchAction = grabs || pen ? 'none' : 'pan-x pan-y'
  const min = minHitPx()
  if (isLine(el) && el.kind === 'shape') {
    const lw = el.width * scale
    const lh = el.height * scale
    const [a, b] = lineEndpoints({ x: 0, y: 0, width: lw, height: lh, flip: el.flip })
    return (
      <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={Math.max(1, lw)} height={Math.max(1, lh)} aria-hidden>
        <line
          data-hit=""
          x1={a.x}
          y1={a.y}
          x2={b.x}
          y2={b.y}
          stroke="transparent"
          strokeWidth={Math.max(el.strokeWidth * scale, min * 0.6)}
          strokeLinecap="round"
          style={{ pointerEvents: 'stroke', cursor, touchAction }}
        />
      </svg>
    )
  }
  const w = el.width * scale
  const h = el.height * scale
  const padX = Math.max(0, (min - w) / 2)
  const padY = Math.max(0, (min - h) / 2)
  return (
    <div
      data-hit=""
      className="pointer-events-auto absolute"
      style={{ left: -padX, right: -padX, top: -padY, bottom: -padY, cursor, touchAction }}
    />
  )
}
