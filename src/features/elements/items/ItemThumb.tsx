import { memo } from 'react'
import { Eraser } from 'lucide-react'
import { WHITEOUT_COLOR } from '../../../model/elements'
import { cssFontFamily } from '../../../model/fonts'
import type { Element } from '../../../model/types'
import { useEditor } from '../../../store/editor'
import { strokesToPath } from '../lib/ink'
import { MarkGlyph } from '../render/ElementContent'
import { inkPixelStrokes } from '../render/helpers'

const TILE = 28

/**
 * A tiny, true-to-color preview of an element on a white "paper" tile. Forced colors mode (Windows
 * Contrast themes) leaves it so, as it does the page: the tile would turn black in a dark palette
 * and hide dark ink.
 */
export const ItemThumb = memo(function ItemThumb({ el }: { el: Element }) {
  return (
    <span
      aria-hidden
      className="relative flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-md border border-black/10 bg-white shadow-[0_1px_1px_rgb(16_24_40/0.06)] forced-color-adjust-none dark:border-white/10"
    >
      <ThumbContent el={el} />
    </span>
  )
})

function ThumbContent({ el }: { el: Element }) {
  switch (el.kind) {
    case 'text':
      return (
        <span
          className="text-[12px] leading-none"
          style={{ fontFamily: cssFontFamily(el.fontId), fontWeight: el.bold ? 700 : 400, color: isWhite(el.color) ? '#8590a2' : el.color }}
        >
          Aa
        </span>
      )
    case 'mark':
      return <MarkGlyph shape={el.shape} color={isWhite(el.color) ? '#8590a2' : el.color} className="block size-5" />
    case 'image':
      return <ImageThumb assetId={el.assetId} opacity={el.opacity} />
    case 'shape':
      return <ShapeThumb el={el} />
    case 'ink':
      return <InkThumb el={el} />
  }
}

function isWhite(c: string | null) {
  return !!c && /^#?f{3}(f{3})?$/i.test(c)
}

function ImageThumb({ assetId, opacity }: { assetId: string; opacity: number }) {
  const src = useEditor((s) => s.assets[assetId]?.dataUrl)
  if (!src) return null
  return <img src={src} alt="" draggable={false} className="max-h-[22px] max-w-[24px] object-contain" style={{ opacity }} />
}

function fit(width: number, height: number, max = 20) {
  const k = Math.min(max / Math.max(width, 1), max / Math.max(height, 1))
  return { w: Math.max(width * k, 1), h: Math.max(height * k, 1) }
}

function ShapeThumb({ el }: { el: Extract<Element, { kind: 'shape' }> }) {
  if (el.fillColor === WHITEOUT_COLOR && !el.strokeColor) return <Eraser className="size-4 text-[#8590a2]" />
  const stroke = el.strokeColor ?? 'none'
  if (el.shape === 'line') {
    const { w, h } = fit(el.width, el.height)
    const [x1, y1, x2, y2] = el.flip ? [0, h, w, 0] : [0, 0, w, h]
    return (
      <svg width={TILE - 8} height={TILE - 8} viewBox={`${-(20 - w) / 2} ${-(20 - h) / 2} 20 20`} className="overflow-visible">
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={stroke} strokeWidth={2} strokeLinecap="round" />
      </svg>
    )
  }
  const { w, h } = fit(el.width, el.height, 18)
  const sw = el.strokeColor ? 1.5 : 0
  // Full strength: a 40% highlight would be nearly invisible at this size.
  const common = { fill: el.fillColor ?? 'none', stroke, strokeWidth: sw }
  return (
    <svg width={w} height={h} className="overflow-visible">
      {el.shape === 'ellipse' ? (
        <ellipse cx={w / 2} cy={h / 2} rx={Math.max(0, (w - sw) / 2)} ry={Math.max(0, (h - sw) / 2)} {...common} />
      ) : (
        <rect x={sw / 2} y={sw / 2} width={Math.max(0, w - sw)} height={Math.max(0, h - sw)} rx={1} {...common} />
      )}
    </svg>
  )
}

function InkThumb({ el }: { el: Extract<Element, { kind: 'ink' }> }) {
  const { w, h } = fit(el.width, el.height, 20)
  const k = w / Math.max(el.width, 1)
  return (
    <svg width={w} height={h} className="overflow-visible">
      <path
        d={strokesToPath(inkPixelStrokes(el, k))}
        fill="none"
        stroke={el.color}
        strokeWidth={Math.max(1, Math.min(2.5, el.strokeWidth * k * 2))}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
