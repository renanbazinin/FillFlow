import { memo } from 'react'
import { cssFontFamily } from '../../../model/fonts'
import type { ImageRole, MarkShape, Point, ToolId } from '../../../model/types'
import { useEditor } from '../../../store/editor'
import { imageRect, markRect } from '../lib/placement'
import { ElementContent, MarkGlyph } from '../render/ElementContent'
import { dateElement, type PageRef } from './place'

/** Semi-transparent preview of what a click will place, following the pointer. */
export const CreationGhost = memo(function CreationGhost({
  tool,
  at,
  page,
  scale,
  overText,
}: {
  tool: ToolId
  at: Point
  page: PageRef
  scale: number
  overText: boolean
}) {
  const styles = useEditor((s) => s.styles)
  const asset = useEditor((s) => (s.placingAssetId ? s.assets[s.placingAssetId] : undefined))

  if (tool === 'text') {
    if (overText) return null
    const t = styles.text
    return (
      <div
        className="pointer-events-none absolute z-[24] flex items-baseline gap-1 rounded-md border border-black/10 bg-white/95 px-1.5 py-0.5 shadow-[0_2px_6px_rgb(16_24_40/0.18)]"
        style={{ left: at.x * scale + 12, top: at.y * scale + 12 }}
        aria-hidden
      >
        <span style={{ fontFamily: cssFontFamily(t.fontId), fontWeight: t.bold ? 700 : 400, color: t.color, fontSize: 13, lineHeight: '16px' }}>Aa</span>
        <span className="text-[10px] font-medium tabular-nums leading-4 text-[#4f5a6b]">{Math.round(t.fontSize * 10) / 10}</span>
      </div>
    )
  }

  if (tool === 'date') {
    const el = dateElement(page, at, styles)
    return (
      <div
        className="pointer-events-none absolute z-[24] opacity-55"
        style={{ left: el.x * scale, top: el.y * scale, width: el.width * scale, height: el.height * scale }}
        aria-hidden
      >
        <ElementContent el={el} scale={scale} />
      </div>
    )
  }

  if (tool === 'check' || tool === 'cross' || tool === 'dot') {
    const r = markRect(at, styles.mark.size, page)
    return (
      <div
        className="pointer-events-none absolute z-[24] opacity-50"
        style={{ left: r.x * scale, top: r.y * scale, width: r.width * scale, height: r.height * scale }}
        aria-hidden
      >
        <MarkGlyph shape={tool as MarkShape} color={styles.mark.color} />
      </div>
    )
  }

  if ((tool === 'signature' || tool === 'initials' || tool === 'image') && asset) {
    const r = imageRect(at, tool as ImageRole, asset.width / (asset.height || 1), page)
    return (
      <div
        className="pointer-events-none absolute z-[24]"
        style={{ left: r.x * scale, top: r.y * scale, width: r.width * scale, height: r.height * scale }}
        aria-hidden
      >
        <img src={asset.dataUrl} alt="" draggable={false} className="block size-full max-w-none opacity-60" />
        <div className="absolute -inset-[3px] rounded-[3px] border border-dashed border-selection/70" />
      </div>
    )
  }
  return null
})
