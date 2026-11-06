import { memo, useEffect, useLayoutEffect, useRef } from 'react'
import { TriangleAlert } from 'lucide-react'
import { useDir, useT } from '../../i18n'
import type { PDFDocumentProxy } from '../../lib/pdf/pdfjs'
import type { PageInfo } from '../../model/types'
import { useRenderSettings, useViewerContext } from './context'
import { PageRenderer } from './pageRenderer'

/** Faint "text lines" drawn with one element (a background layer per bar), so placeholders stay cheap. */
const SKELETON_BARS: [left: number, top: number, width: number, height: number][] = [
  [9, 7.5, 38, 2.2],
  [9, 13.5, 82, 1.1],
  [9, 16.5, 78, 1.1],
  [9, 19.5, 80, 1.1],
  [9, 22.5, 52, 1.1],
  [9, 29, 82, 1.1],
  [9, 32, 74, 1.1],
  [9, 35, 79, 1.1],
  [9, 38, 41, 1.1],
  [9, 45, 36, 9],
  [50, 45, 41, 1.1],
  [50, 48, 37, 1.1],
  [50, 51, 39, 1.1],
  [9, 61, 82, 1.1],
  [9, 64, 76, 1.1],
  [9, 67, 63, 1.1],
]

/** background-position % aligns the same fraction of image and box, hence the conversion. */
const toPosition = (offset: number, size: number) => (size >= 100 ? 0 : (offset / (100 - size)) * 100)

const SKELETON_STYLE = {
  backgroundImage: SKELETON_BARS.map(() => 'linear-gradient(rgb(15 23 42 / 0.055), rgb(15 23 42 / 0.055))').join(','),
  backgroundSize: SKELETON_BARS.map(([, , w, h]) => `${w}% ${h}%`).join(','),
  backgroundPosition: SKELETON_BARS.map(([l, t, w, h]) => `${toPosition(l, w)}% ${toPosition(t, h)}%`).join(','),
  backgroundRepeat: 'no-repeat',
}

interface PageCanvasProps {
  pdf: PDFDocumentProxy
  info: PageInfo
  near: boolean
}

/**
 * The pdf.js bitmap of one page (plus its placeholder). Purely visual and click-through: the
 * form/element layers stacked above it handle all interaction.
 */
export const PageCanvas = memo(function PageCanvas({ pdf, info, near }: PageCanvasProps) {
  const { controller } = useViewerContext()
  const settings = useRenderSettings(controller)
  const t = useT()
  const dir = useDir()
  const rootRef = useRef<HTMLDivElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<PageRenderer | null>(null)

  useLayoutEffect(() => {
    const root = rootRef.current
    const host = hostRef.current
    if (!root || !host) return
    const renderer = new PageRenderer(root, host, controller)
    rendererRef.current = renderer
    return () => {
      renderer.destroy()
      rendererRef.current = null
    }
  }, [controller])

  useEffect(() => {
    rendererRef.current?.update({ pdf, info, near, scale: settings.scale, dpr: settings.dpr })
  }, [pdf, info, near, settings])

  return (
    <div ref={rootRef} aria-hidden className="group/canvas pointer-events-none absolute inset-0 select-none overflow-hidden">
      <div className="absolute inset-0 group-data-[state=ready]/canvas:hidden" style={SKELETON_STYLE}>
        <div className="absolute inset-0 hidden animate-shimmer bg-[linear-gradient(100deg,transparent_35%,rgb(15_23_42/0.045)_50%,transparent_65%)] bg-[length:200%_100%] group-data-[state=loading]/canvas:block" />
      </div>
      <div ref={hostRef} className="absolute inset-0" />
      {/* Interface text on a (left-to-right) page: in the interface's direction. */}
      <div
        dir={dir}
        className="absolute inset-0 hidden flex-col items-center gap-2 bg-white px-4 pt-[12%] text-center text-[13px] text-black/50 group-data-[state=error]/canvas:flex"
      >
        <TriangleAlert className="size-5 text-black/35" aria-hidden />
        {t.editor.viewer.renderError}
      </div>
    </div>
  )
})
