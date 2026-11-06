import { useEffect } from 'react'
import { Toaster, type ToasterProps } from 'sonner'
import { ConfirmHost } from './components/ui/confirm'
import { TooltipProvider } from './components/ui/tooltip'
import { EditorScreen } from './features/editor/EditorScreen'
import { LoadOverlay } from './features/editor/LoadOverlay'
import { useMediaQuery } from './features/editor/useMediaQuery'
import { FileDropOverlay } from './features/home/FileDropOverlay'
import { HomeScreen } from './features/home/HomeScreen'
import { STAYING_TOASTER } from './components/ui/toasts'
import { useTheme } from './lib/theme'
import { useEditor } from './store/editor'

/** Just under the editor's top bar, which is 3.5rem tall below the safe area (see TopBar). */
const UNDER_TOP_BAR = 'calc(3.5rem + env(safe-area-inset-top) + 12px)'

/** A phone held sideways: the pages get little height between the top bar and the tool dock. */
const SHORT_SCREEN = '(max-height: 500px)'

const TOAST_OPTIONS: ToasterProps['toastOptions'] = {
  // Toasts float above modals, which turn off pointer events on the rest of the page:
  // keep them pressable instead of letting taps fall through to what's underneath. One that is
  // leaving (dismissed, still fading out) lets them through: they're meant for what's underneath.
  className:
    '!rounded-xl !border-line !bg-surface !text-fg !shadow-float !font-sans pointer-events-auto data-[removed=true]:pointer-events-none',
  classNames: {
    title: '!text-[13.5px] !font-medium',
    description: '!text-[12.5px] !text-fg-muted',
    actionButton: '!h-7 !rounded-lg !bg-accent !px-2.5 !text-[12.5px] !font-medium !text-accent-fg hover:!bg-accent-hover',
    cancelButton: '!h-7 !rounded-lg !bg-surface-3 !px-2.5 !text-[12.5px] !font-medium !text-fg',
    success: '[&_[data-icon]]:!text-success',
    error: '[&_[data-icon]]:!text-danger',
    warning: '[&_[data-icon]]:!text-warning',
    info: '[&_[data-icon]]:!text-accent-ink',
  },
}

export default function App() {
  const hasDoc = useEditor((s) => s.doc !== null)
  const short = useMediaQuery(SHORT_SCREEN)
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
        // In the editor, stay clear of the tool dock (floating, or a bar along the bottom on phones)
        // and its hint chip. On a short screen that would put toasts mid-screen, over the pages and
        // the selection toolbar: they sit just above the dock there, over the hint.
        offset={hasDoc ? (short ? 80 : 128) : 24}
        mobileOffset={hasDoc ? { bottom: short ? 68 : 112 } : { bottom: 16 }}
        gap={10}
        toastOptions={TOAST_OPTIONS}
      />
      {/* The messages that stay until acted on, in a stack of their own just under the top bar: at the
          bottom they would cover the popovers that open above the tool dock. Menus and popovers from
          the top bar open over them (z-90); dialogs, sheets and the Opening… card stay below. */}
      <Toaster
        id={STAYING_TOASTER}
        containerAriaLabel="Alerts"
        theme={resolved}
        position="top-center"
        offset={{ top: UNDER_TOP_BAR }}
        mobileOffset={{ top: UNDER_TOP_BAR }}
        gap={10}
        style={{ zIndex: 89 }}
        toastOptions={TOAST_OPTIONS}
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
