import { memo } from 'react'
import type { Rect } from '../../../model/types'
import type { Guide } from '../lib/snap'
import { useElementsUi } from '../state/ui'
import { ElementContent } from './ElementContent'

/** Smart-guide color (on-page; pages are always white paper). */
const GUIDE = '#f43f5e'

export const Guides = memo(function Guides({ guides, scale }: { guides: Guide[]; scale: number }) {
  if (!guides.length) return null
  return (
    <svg className="pointer-events-none absolute left-0 top-0 z-[24] overflow-visible" width={1} height={1} aria-hidden>
      {guides.map((g, i) =>
        g.axis === 'x' ? (
          <line key={i} x1={g.pos * scale} x2={g.pos * scale} y1={g.from * scale} y2={g.to * scale} stroke={GUIDE} strokeWidth={1} shapeRendering="crispEdges" />
        ) : (
          <line key={i} y1={g.pos * scale} y2={g.pos * scale} x1={g.from * scale} x2={g.to * scale} stroke={GUIDE} strokeWidth={1} shapeRendering="crispEdges" />
        ),
      )}
    </svg>
  )
})

export const Marquee = memo(function Marquee({ rect, scale }: { rect: Rect | null; scale: number }) {
  if (!rect) return null
  return (
    <div
      className="pointer-events-none absolute z-[24] rounded-[2px] border border-selection/80 bg-selection/[0.08]"
      style={{ left: rect.x * scale, top: rect.y * scale, width: rect.width * scale, height: rect.height * scale }}
    />
  )
})

/** Where a single element dragged in from another page will land. */
export const DropGhost = memo(function DropGhost({ page, scale }: { page: number; scale: number }) {
  const preview = useElementsUi((s) => (s.dropPreview?.page === page ? s.dropPreview : null))
  if (!preview) return null
  const el = preview.element
  return (
    <div
      className="pointer-events-none absolute z-[24]"
      style={{ left: el.x * scale, top: el.y * scale, width: el.width * scale, height: el.height * scale }}
    >
      <div className="absolute inset-0 opacity-70">
        <ElementContent el={el} scale={scale} />
      </div>
      <div className="absolute -inset-[3px] rounded-[3px] border-[1.5px] border-dashed border-selection" />
    </div>
  )
})
