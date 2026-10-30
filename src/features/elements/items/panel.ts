import { useEditor } from '../../../store/editor'

/** On phones the right panel covers the document: close it so the picked item is visible. */
export function closePanelOnSmallScreens(): void {
  if (typeof window === 'undefined' || !window.matchMedia('(max-width: 767px)').matches) return
  useEditor.getState().setRightPanelOpen(false)
}
