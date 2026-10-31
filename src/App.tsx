import { useEffect } from 'react'
import { Toaster } from 'sonner'
import { ConfirmHost } from './components/ui/confirm'
import { TooltipProvider } from './components/ui/tooltip'
import { EditorScreen } from './features/editor/EditorScreen'
import { LoadOverlay } from './features/editor/LoadOverlay'
import { FileDropOverlay } from './features/home/FileDropOverlay'
import { HomeScreen } from './features/home/HomeScreen'
import { useTheme } from './lib/theme'
import { useEditor } from './store/editor'

export default function App() {
  const hasDoc = useEditor((s) => s.doc !== null)
  const { resolved } = useTheme()
  useBrowserChromeColor(hasDoc, resolved)
  return (
    <TooltipProvider>
      {hasDoc ? <EditorScreen /> : <HomeScreen />}
      <LoadOverlay />
      <FileDropOverlay />
      <ConfirmHost />
      <Toaster
        theme={resolved}
        position="bottom-center"
        // In the editor, stay clear of the floating tool dock and its hint chip.
        offset={hasDoc ? 128 : 24}
        mobileOffset={hasDoc ? { bottom: 112 } : { bottom: 16 }}
        gap={10}
        toastOptions={{
          // Toasts float above modals, which turn off pointer events on the rest of the page:
          // keep them pressable instead of letting taps fall through to what's underneath.
          className: '!rounded-xl !border-line !bg-surface !text-fg !shadow-float !font-sans pointer-events-auto',
          classNames: {
            title: '!text-[13.5px] !font-medium',
            description: '!text-[12.5px] !text-fg-muted',
            actionButton:
              '!h-7 !rounded-lg !bg-accent !px-2.5 !text-[12.5px] !font-medium !text-accent-fg hover:!bg-accent-hover',
            cancelButton: '!h-7 !rounded-lg !bg-surface-3 !px-2.5 !text-[12.5px] !font-medium !text-fg',
            success: '[&_[data-icon]]:!text-success',
            error: '[&_[data-icon]]:!text-danger',
            warning: '[&_[data-icon]]:!text-warning',
            info: '[&_[data-icon]]:!text-accent-ink',
          },
        }}
      />
    </TooltipProvider>
  )
}

/** Tints the mobile browser UI to match the top of the current screen in the active theme. */
function useBrowserChromeColor(hasDoc: boolean, resolved: 'light' | 'dark') {
  useEffect(() => {
    const color = getComputedStyle(document.documentElement)
      .getPropertyValue(hasDoc ? '--ff-surface' : '--ff-canvas')
      .trim()
    if (!color) return
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', color))
  }, [hasDoc, resolved])
}
