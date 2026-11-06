import { memo } from 'react'
import type { StyleDefaults } from '../../../model/types'
import { ElementContent } from '../render/ElementContent'
import { isHighlight } from '../render/helpers'
import { boxShape, lineShape } from './place'
import type { Draft } from './types'

/** Live preview of a shape being dragged out — drawn by the same renderer as the result. */
export const ShapeDraft = memo(function ShapeDraft({ draft, page, scale, styles }: { draft: Draft; page: number; scale: number; styles: StyleDefaults }) {
  const el = draft.kind === 'box' ? boxShape(page, draft.tool, draft.rect, styles) : lineShape(page, draft.a, draft.b, styles)
  const whiteout = draft.kind === 'box' && draft.tool === 'whiteout'
  return (
    <div
      className="pointer-events-none absolute z-[24]"
      style={{
        left: el.x * scale,
        top: el.y * scale,
        width: el.width * scale,
        height: el.height * scale,
        mixBlendMode: isHighlight(el) ? 'multiply' : undefined,
      }}
      aria-hidden
    >
      <ElementContent el={el} scale={scale} />
      {whiteout && <div className="absolute inset-0 border border-dashed border-black/30" />}
    </div>
  )
})
