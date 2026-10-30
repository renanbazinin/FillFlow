import { useCallback, useLayoutEffect, useMemo, useState } from 'react'
import { useEditor } from '../../store/editor'
import { cn } from '../../lib/utils/misc'
import { registerViewer } from './viewerApi'
import { ALWAYS_MOUNT_LAYERS_MAX_PAGES, NEAR_VIEWPORTS, PAD_BOTTOM, PAD_TOP, PAD_X, PAGE_GAP, horizontalPadding } from './constants'
import { ViewerContext, type ViewerContextValue } from './context'
import { ViewerController } from './controller'
import { watchDevicePixelRatio } from './devicePixelRatio'
import { PageView } from './PageView'
import { VisibilityRegistry } from './visibility'

/**
 * The scrollable document area (the editor's main flex-1 region; this element IS the scroll
 * container). Pages are stacked and centered; each renders lazily. Zoom: Ctrl/⌘ + wheel or
 * trackpad pinch (around the cursor), two-finger touch pinch, Ctrl/⌘ + = − 0. Pan: hand tool,
 * Space + drag, middle-mouse drag. Exposes the imperative API in `viewerApi.ts`.
 *
 * Attributes on the scroll container for other layers: `data-pan-ready` (hand tool or Space held),
 * `data-panning` (dragging), `data-pinching` (two-finger touch gesture), `data-zooming`
 * (continuous zoom in progress).
 */
export function Viewer() {
  const doc = useEditor((s) => s.doc)
  const scale = useEditor((s) => s.scale)
  const [controller] = useState(() => new ViewerController())
  const [visibility] = useState(() => new VisibilityRegistry(`${NEAR_VIEWPORTS * 100}% 100%`))
  const context = useMemo<ViewerContextValue>(() => ({ controller, visibility }), [controller, visibility])
  const [padX, setPadX] = useState(PAD_X)

  const containerRef = useCallback(
    (el: HTMLDivElement | null) => {
      if (!el) return
      controller.attach(el)
      visibility.setRoot(el)
      const unbind = controller.bindEvents()
      const stopDpr = watchDevicePixelRatio((dpr) => controller.setDevicePixelRatio(dpr))
      const resize = new ResizeObserver(() => {
        setPadX(horizontalPadding(el.clientWidth))
        controller.onResize()
      })
      resize.observe(el)
      registerViewer(controller)
      return () => {
        registerViewer(null)
        resize.disconnect()
        stopDpr()
        unbind()
        visibility.disconnect()
        controller.detach()
      }
    },
    [controller, visibility],
  )

  // A different document: back to the top, fit mode re-applied, gesture state forgotten.
  useLayoutEffect(() => {
    if (doc) controller.resetForDocument(doc.pages)
  }, [controller, doc])

  // Runs after the pages were laid out at the new scale: keeps the zoom anchor in place.
  useLayoutEffect(() => {
    controller.commitScale(scale)
  }, [controller, scale])

  const pages = doc?.pages
  const alwaysMountLayers = (pages?.length ?? 0) <= ALWAYS_MOUNT_LAYERS_MAX_PAGES

  return (
    <ViewerContext value={context}>
      <div
        ref={containerRef}
        role="region"
        aria-label="Document pages"
        tabIndex={0}
        className={cn(
          'relative min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain bg-canvas-dots scrollbar-thin',
          'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
          // Hand tool / Space: grab cursor everywhere on the pages, even over interactive layers.
          'data-pan-ready:cursor-grab [&[data-pan-ready]_*]:cursor-grab!',
          'data-panning:cursor-grabbing data-panning:select-none [&[data-panning]_*]:cursor-grabbing!',
        )}
        style={{ touchAction: 'pan-x pan-y', scrollbarGutter: 'stable' }}
      >
        <div
          className="relative flex w-max min-w-full flex-col items-center"
          style={{ padding: `${PAD_TOP}px ${padX}px ${PAD_BOTTOM}px`, rowGap: PAGE_GAP }}
        >
          {doc &&
            pages?.map((info) => (
              <PageView
                key={`${doc.id}:${info.index}`}
                info={info}
                pdf={doc.pdf}
                scale={scale}
                pageCount={pages.length}
                alwaysMountLayers={alwaysMountLayers}
              />
            ))}
        </div>
      </div>
    </ViewerContext>
  )
}
