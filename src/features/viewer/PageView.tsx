import { memo, useCallback, useState } from 'react'
import { useDir, useT } from '../../i18n'
import type { PDFDocumentProxy } from '../../lib/pdf/pdfjs'
import type { PageInfo } from '../../model/types'
import { useEditor } from '../../store/editor'
import { ElementLayer } from '../elements/ElementLayer'
import { useElementsUi } from '../elements/state/ui'
import { FormFieldLayer } from '../forms/FormFieldLayer'
import { PAGE_LABEL_HEIGHT } from './constants'
import { useViewerContext } from './context'
import { PageCanvas } from './PageCanvas'
import { editingPage, selectionPages } from './pagesInUse'
import { frameSize } from './viewMath'

interface PageViewProps {
  info: PageInfo
  pdf: PDFDocumentProxy
  /** CSS px per point. */
  scale: number
  pageCount: number
  /** Small documents keep every page's layers mounted; large ones only near the viewport (or in use). */
  alwaysMountLayers: boolean
}

/**
 * One page: a white frame laid out at full size (so scroll metrics are exact even before it
 * renders), holding the bitmap, then the form layer, then the element layer.
 */
export const PageView = memo(function PageView({ info, pdf, scale, pageCount, alwaysMountLayers }: PageViewProps) {
  const { controller, visibility } = useViewerContext()
  const [near, setNear] = useState(false)
  // Left the near range with the keyboard focus inside (e.g. a form field being typed into).
  const [holdsFocus, setHoldsFocus] = useState(false)
  const index = info.index
  const editing = useEditor((s) => editingPage(s) === index)
  // A drag moves the selection. Asked on its pages only, so a drag starting doesn't re-render them all.
  const selected = useEditor((s) => selectionPages(s).has(index))
  const dragging = useElementsUi((s) => selected && s.interaction === 'move')
  const t = useT()
  const dir = useDir()

  const frameRef = useCallback(
    (el: HTMLDivElement | null) => {
      if (!el) return
      controller.registerFrame(index, el)
      const stopObserving = visibility.observe(el, (isNear) => {
        setNear(isNear)
        setHoldsFocus(!isNear && el.contains(document.activeElement))
      })
      // Let go once the focus has moved elsewhere, checked after it lands (a window switch leaves it here).
      let frame = 0
      const onFocusOut = () => {
        cancelAnimationFrame(frame)
        frame = requestAnimationFrame(() => {
          if (!el.contains(document.activeElement)) setHoldsFocus(false)
        })
      }
      el.addEventListener('focusout', onFocusOut)
      return () => {
        cancelAnimationFrame(frame)
        el.removeEventListener('focusout', onFocusOut)
        stopObserving()
        controller.unregisterFrame(index, el)
      }
    },
    [controller, visibility, index],
  )

  const { width, height } = frameSize(info, scale)
  // Layers in use stay, however far the page is scrolled: unmounting them would end a text edit or
  // a drag halfway, or drop the focus so that the next keys trigger page shortcuts.
  const showLayers = alwaysMountLayers || near || editing || dragging || holdsFocus

  return (
    <div className="flex shrink-0 flex-col items-center">
      <div
        ref={frameRef}
        data-page-index={index}
        role="group"
        aria-label={t.editor.viewer.page(index + 1, pageCount)}
        className="relative shrink-0 bg-white shadow-page"
        style={{ width, height }}
      >
        <PageCanvas pdf={pdf} info={info} near={near} />
        {showLayers && <FormFieldLayer page={info} scale={scale} />}
        {showLayers && <ElementLayer page={info} scale={scale} />}
      </div>
      {/* Interface text among the (left-to-right) pages: in the interface's direction. */}
      <div
        aria-hidden
        dir={dir}
        className="flex select-none items-center justify-center text-[11px] font-medium leading-none tabular-nums text-fg-subtle"
        style={{ height: PAGE_LABEL_HEIGHT }}
      >
        {index + 1}
      </div>
    </div>
  )
})
