import { memo, useMemo } from 'react'
import { MARK_PATHS, MARK_VIEWBOX } from '../../../model/elements'
import type { Element, ImageElement, InkElement, MarkElement, ShapeElement, TextElement } from '../../../model/types'
import { useEditor } from '../../../store/editor'
import { strokesToPath } from '../lib/ink'
import { inkPixelStrokes } from './helpers'
import { textCss, useBaselineShift, useTextLayout } from './textStyle'

/**
 * Visual content of an element, drawn at the origin of a positioned box that is
 * (width × scale) by (height × scale) CSS px. Follows the rendering conventions in
 * model/types.ts exactly, because the exporter draws the same geometry into the PDF.
 */
export const ElementContent = memo(function ElementContent({ el, scale }: { el: Element; scale: number }) {
  switch (el.kind) {
    case 'text':
      return <TextContent el={el} scale={scale} />
    case 'mark':
      return <MarkContent el={el} />
    case 'image':
      return <ImageContent el={el} />
    case 'shape':
      return <ShapeContent el={el} scale={scale} />
    case 'ink':
      return <InkContent el={el} scale={scale} />
  }
})

function TextContent({ el, scale }: { el: TextElement; scale: number }) {
  const layout = useTextLayout(el)
  const css = textCss(el, scale)
  const lh = layout.lineHeightPt * scale
  // Puts each line's baseline exactly where the PDF export draws it.
  const shift = useBaselineShift(el, scale)
  return (
    <>
      {layout.lines.map((line, i) => (
        <div key={i} dir="auto" className="absolute" style={{ ...css, left: line.x * scale, top: i * lh + shift, height: lh }}>
          {line.text}
        </div>
      ))}
    </>
  )
}

export function MarkGlyph({ shape, color, className }: { shape: MarkElement['shape']; color: string; className?: string }) {
  return (
    <svg viewBox={`0 0 ${MARK_VIEWBOX} ${MARK_VIEWBOX}`} preserveAspectRatio="none" className={className ?? 'block size-full'} aria-hidden>
      <path d={MARK_PATHS[shape]} fill={color} />
    </svg>
  )
}

function MarkContent({ el }: { el: MarkElement }) {
  return <MarkGlyph shape={el.shape} color={el.color} />
}

function ImageContent({ el }: { el: ImageElement }) {
  const src = useEditor((s) => s.assets[el.assetId]?.dataUrl)
  if (!src) return <div className="size-full rounded-[2px] border border-dashed border-black/20 bg-black/[0.03]" />
  return (
    <img
      src={src}
      alt=""
      draggable={false}
      className="block size-full max-w-none select-none"
      style={{ opacity: el.opacity, objectFit: 'fill' }}
    />
  )
}

function ShapeContent({ el, scale }: { el: ShapeElement; scale: number }) {
  const w = el.width * scale
  const h = el.height * scale
  // Painted like the export: a border needs a color and a width, and only a border insets the
  // shape (without one, the fill covers the whole box). A rect/ellipse border wider than half the
  // box is drawn at half its smaller side, so the shape shows solid instead of vanishing (SVG skips
  // a zero-size rect).
  const strokeColor = el.strokeColor && el.strokeWidth > 0 ? el.strokeColor : null
  const sw = strokeColor ? (el.shape === 'line' ? el.strokeWidth : Math.min(el.strokeWidth, el.width / 2, el.height / 2)) * scale : 0
  const stroke = strokeColor ?? 'none'
  let shape
  if (el.shape === 'line') {
    const [x1, y1, x2, y2] = el.flip ? [0, h, w, 0] : [0, 0, w, h]
    shape = <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
  } else if (el.shape === 'ellipse') {
    shape = (
      <ellipse
        cx={w / 2}
        cy={h / 2}
        rx={Math.max(0, (w - sw) / 2)}
        ry={Math.max(0, (h - sw) / 2)}
        fill={el.fillColor ?? 'none'}
        stroke={stroke}
        strokeWidth={sw}
      />
    )
  } else {
    shape = (
      <rect
        x={sw / 2}
        y={sw / 2}
        width={Math.max(0, w - sw)}
        height={Math.max(0, h - sw)}
        fill={el.fillColor ?? 'none'}
        stroke={stroke}
        strokeWidth={sw}
      />
    )
  }
  return (
    // A zero-sized <svg> isn't rendered at all (straight lines have width or height 0).
    <svg width={Math.max(w, 1)} height={Math.max(h, 1)} className="absolute left-0 top-0 block overflow-visible" style={{ opacity: el.opacity }} aria-hidden>
      {shape}
    </svg>
  )
}

function InkContent({ el, scale }: { el: InkElement; scale: number }) {
  const { strokes, width, height } = el
  const d = useMemo(() => strokesToPath(inkPixelStrokes({ strokes, width, height }, scale)), [strokes, width, height, scale])
  return (
    <svg width={Math.max(width * scale, 1)} height={Math.max(height * scale, 1)} className="absolute left-0 top-0 block overflow-visible" aria-hidden>
      <path d={d} fill="none" stroke={el.color} strokeWidth={el.strokeWidth * scale} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
