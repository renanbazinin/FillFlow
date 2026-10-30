import { memo, useCallback, useState } from 'react'
import type { PDFDocumentProxy } from '../../lib/pdf/pdfjs'
import type { PageInfo } from '../../model/types'
import { ElementLayer } from '../elements/ElementLayer'
import { FormFieldLayer } from '../forms/FormFieldLayer'
import { PAGE_LABEL_HEIGHT } from './constants'
import { useViewerContext } from './context'
import { PageCanvas } from './PageCanvas'
import { frameSize } from './viewMath'

interface PageViewProps {
  info: PageInfo
  pdf: PDFDocumentProxy
  /** CSS px per point. */
  scale: number
  pageCount: number
  /** Small documents keep every page's layers mounted; large ones only near the viewport. */
  alwaysMountLayers: boolean
}

/**
 * One page: a white frame laid out at full size (so scroll metrics are exact even before it
 * renders), holding the bitmap, then the form layer, then the element layer.
 */
export const PageView = memo(function PageView({ info, pdf, scale, pageCount, alwaysMountLayers }: PageViewProps) {
  const { controller, visibility } = useViewerContext()
  const [near, setNear] = useState(false)
  const index = info.index

  const frameRef = useCallback(
    (el: HTMLDivElement | null) => {
      if (!el) return
      controller.registerFrame(index, el)
      const stopObserving = visibility.observe(el, setNear)
      return () => {
        stopObserving()
        controller.unregisterFrame(index, el)
      }
    },
    [controller, visibility, index],
  )

  const { width, height } = frameSize(info, scale)
  const showLayers = alwaysMountLayers || near

  return (
    <div className="flex shrink-0 flex-col items-center">
      <div
        ref={frameRef}
        data-page-index={index}
        role="group"
        aria-label={`Page ${index + 1} of ${pageCount}`}
        className="relative shrink-0 bg-white shadow-page"
        style={{ width, height }}
      >
        <PageCanvas pdf={pdf} info={info} near={near} />
        {showLayers && <FormFieldLayer page={info} scale={scale} />}
        {showLayers && <ElementLayer page={info} scale={scale} />}
      </div>
      <div
        aria-hidden
        className="flex select-none items-center justify-center text-[11px] font-medium leading-none tabular-nums text-fg-subtle"
        style={{ height: PAGE_LABEL_HEIGHT }}
      >
        {index + 1}
      </div>
    </div>
  )
})
