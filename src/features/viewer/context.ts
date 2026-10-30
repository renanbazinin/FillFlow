import { createContext, useContext, useSyncExternalStore } from 'react'
import type { ViewerController, RenderSettings } from './controller'
import type { VisibilityRegistry } from './visibility'

export interface ViewerContextValue {
  controller: ViewerController
  /** Reports pages within ~1.5 viewport heights of the visible area. */
  visibility: VisibilityRegistry
}

export const ViewerContext = createContext<ViewerContextValue | null>(null)

export function useViewerContext(): ViewerContextValue {
  const ctx = useContext(ViewerContext)
  if (!ctx) throw new Error('useViewerContext must be used inside <Viewer>')
  return ctx
}

/** Scale/ratio page bitmaps should currently be rendered at (lags the live zoom during gestures). */
export function useRenderSettings(controller: ViewerController): RenderSettings {
  return useSyncExternalStore(controller.subscribeRender, controller.getRenderSettings)
}
