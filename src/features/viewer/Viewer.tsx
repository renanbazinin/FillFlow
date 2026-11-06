import { useCallback, useLayoutEffect, useMemo, useState, type CSSProperties } from 'react'
import { useT } from '../../i18n'
import { useEditor } from '../../store/editor'
import { cn } from '../../lib/utils/misc'
import { textAtRight } from '../forms/navigation'
import { registerViewer } from './viewerApi'
import {
  ALWAYS_MOUNT_LAYERS_MAX_PAGES,
  DOCK_OVERLAP,
  NEAR_VIEWPORTS,
  PAD_BOTTOM,
  PAD_TOP,
  PAD_X,
  PAGE_GAP,
  horizontalPadding,
} from './constants'
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
 *
 * The pages stay left to right in a right-to-left interface (dir="ltr" on the scroll container):
 * their layout, scrolling and everything on them are as in English. Interface text shown in there
 * takes the interface's direction on its own element.
 */
export function Viewer() {
  const doc = useEditor((s) => s.doc)
  const scale = useEditor((s) => s.scale)
  const t = useT()
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
      const stopRevealing = revealKeyboardFocus(el, controller)
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
        stopRevealing()
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
        aria-label={t.editor.viewer.label}
        dir="ltr"
        tabIndex={0}
        className={cn(
          'relative min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain bg-canvas-dots scrollbar-thin',
          'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
          // Hand tool / Space: grab cursor everywhere on the pages, even over interactive layers.
          'data-pan-ready:cursor-grab [&[data-pan-ready]_*]:cursor-grab!',
          'data-panning:cursor-grabbing data-panning:select-none [&[data-panning]_*]:cursor-grabbing!',
          // Where the tool dock floats over the pages, the browser's own scrolling into view while a
          // text box on them has focus (a form field's, or the one editing a text item: an on-screen
          // keyboard shrinking the page, the caret as it moves, find in page meanwhile) keeps what it
          // reveals above the dock. Only then: a press on a drop-down or a list beside the dock would
          // scroll the pages. Tab has its own reveal.
          'sm:has-[[data-page-index]_:is(input,textarea):focus]:scroll-pb-(--dock-overlap)',
        )}
        style={{ touchAction: 'pan-x pan-y', scrollbarGutter: 'stable', '--dock-overlap': `${DOCK_OVERLAP}px` } as CSSProperties}
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

/**
 * Keyboard focus landing on a form field on a page (Tab, Shift+Tab, arrows in a radio group, a
 * dialog handing focus back): shows all of the field (wider than the view: the end its text sits
 * at), clear of the floating tool dock, as Enter and "Next empty field" do. The browser's own focus
 * scroll counts the strip under the dock as visible, and for a text area it only reveals the
 * caret's line. Focus from a press stays put (the field is where it was pressed: scrolling under
 * the pointer could lose the click), a field the app focuses itself (Enter, "Next empty field") is
 * revealed by it, and one that gets focus back with the window stays where the user left it.
 * Returns the cleanup.
 */
function revealKeyboardFocus(container: HTMLElement, controller: ViewerController): () => void {
  const ac = new AbortController()
  const signal = ac.signal
  // A press focuses on its way down (a tap: after it); the click ends it. A cancelled one focuses nothing.
  let pressing = false
  const press = (down: boolean) => () => {
    pressing = down
  }
  window.addEventListener('pointerdown', press(true), { capture: true, signal })
  for (const type of ['click', 'pointercancel', 'keydown']) window.addEventListener(type, press(false), { capture: true, signal })
  // What had focus when the window lost it: it gets focus back when the window does.
  let left: Element | null = null
  window.addEventListener(
    'blur',
    (e) => {
      if (e.target === window) left = document.activeElement
    },
    { signal },
  )
  container.addEventListener(
    'focusin',
    (e) => {
      const back = e.target === left
      left = null
      const target = e.target instanceof Element ? e.target : null
      const control = target?.closest<HTMLElement>('[data-form-widget]')
      if (pressing || back || !target || !control) return
      const s = useEditor.getState()
      const name = control.dataset.formField
      // This runs before React's focus handlers: a field the app focused is the active field already.
      if (s.activeFieldName === name) return
      const widget = s.doc?.formFields.find((f) => f.name === name)?.widgets.find((w) => w.id === control.dataset.formWidget)
      if (!widget) return
      // Instant, like the browser's own focus scroll (which then has nothing left to do). A field
      // wider than the view is lined up by the edge its text sits at: the right one for right-to-left
      // or right-aligned text.
      controller.scrollToRect(widget.page, widget.rect, { behavior: 'auto', margin: 48, inlineEnd: textAtRight(target) })
    },
    { signal },
  )
  return () => ac.abort()
}
