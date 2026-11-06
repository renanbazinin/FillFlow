import { useEffect } from 'react'
import { OPEN_OVERLAY } from '../../components/ui/modal'
import { isEditableTarget, isMac } from '../../lib/utils/misc'
import { useEditor } from '../../store/editor'
import { chooseAndOpenPdf } from '../home/openFile'
import { viewer } from '../viewer/viewerApi'
import { shellCommandFor, type ShellCommand } from './shortcuts'

const MODAL_OPEN = '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]'

/**
 * Whether an open overlay keeps `cmd` from running. Dialogs (sheets and popovers too) stop every
 * command. So does an open menu, except zooming (the menu's own zoom steps keep it open): what the
 * others open would land under the menu, which then stays stuck open over it.
 */
function blockedByOverlay(cmd: ShellCommand): boolean {
  const zoom = cmd === 'zoomIn' || cmd === 'zoomOut' || cmd === 'fitWidth'
  return document.querySelector(zoom ? MODAL_OPEN : OPEN_OVERLAY) !== null
}

/**
 * Shell-level shortcuts. In the editor: ⌘/Ctrl+S download, ⌘/Ctrl+O open, ? shortcuts, and
 * ⌘/Ctrl +/−/0 zoom (only if the viewer didn't already handle the key). On the home screen
 * (`scope: 'home'`) only ⌘/Ctrl+O applies.
 */
export function useShellShortcuts(scope: 'editor' | 'home' = 'editor'): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const cmd = shellCommandFor(e, isMac)
      if (!cmd || e.defaultPrevented) return
      if (scope === 'home' && cmd !== 'open') return
      // Never let the browser's own "Save page" / "Open file" dialogs take over the editor.
      if (cmd === 'download' || cmd === 'open') e.preventDefault()
      if (e.repeat && cmd !== 'zoomIn' && cmd !== 'zoomOut') return
      const state = useEditor.getState()
      if (state.load.status !== 'idle' || blockedByOverlay(cmd)) return
      if (cmd === 'help' && isEditableTarget(e.target)) return
      e.preventDefault()
      switch (cmd) {
        case 'download':
          if (state.doc) state.openDialog('export')
          break
        case 'open':
          void chooseAndOpenPdf()
          break
        case 'help':
          state.openDialog('shortcuts')
          break
        case 'zoomIn':
          viewer.zoomIn()
          break
        case 'zoomOut':
          viewer.zoomOut()
          break
        case 'fitWidth':
          viewer.fitWidth()
          break
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [scope])
}
