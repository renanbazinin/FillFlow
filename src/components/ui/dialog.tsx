import { useRef, type FocusEvent, type ReactNode } from 'react'
import { Dialog as RDialog } from 'radix-ui'
import { X } from 'lucide-react'
import { cn } from '../../lib/utils/misc'
import { isToastTarget, onModalClose, onModalOpen } from './modal'

export interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  /** Footer row (right-aligned buttons). */
  footer?: ReactNode
  /** Width preset. */
  size?: 'sm' | 'md' | 'lg' | 'xl'
  /** Hide the title visually (still announced to screen readers). */
  hideTitle?: boolean
  className?: string
  /** Prevent closing by clicking outside (e.g. while busy). */
  dismissible?: boolean
  onOpenAutoFocus?: (e: Event) => void
  onCloseAutoFocus?: (e: Event) => void
}

/** The card's width (as a bottom sheet, on small screens, it takes the whole width). */
const WIDTHS = { sm: 'sm:max-w-sm', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl', xl: 'sm:max-w-4xl' }

/**
 * A modal's backdrop fades in and out. While it fades out it lets presses through (Radix sets its
 * pointer-events inline, hence the !): a click or tap right after the modal closes is meant for
 * the page.
 */
const OVERLAY_FADE = 'data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out data-[state=closed]:!pointer-events-none'

/**
 * Radix's focus trap moves focus to the modal itself when anything inside it is removed while
 * nothing has focus, which is also the case for a moment while focus moves from one control to
 * another. A control that removes something as it loses focus (the form panel's current-field
 * marker) would then cancel the browser's own move: a click, tap or Tab would land on the modal
 * (moving focus on in code afterwards still loses the caret where it was clicked, Tab's select-all
 * and drag selection). So while focus moves from one control to another inside, the modal can't
 * take focus; it can again once the next control has it. Spread on the modal's content.
 */
function useKeepFocusMoves() {
  const restore = useRef<(() => void) | null>(null)
  return {
    onBlurCapture: (e: FocusEvent<HTMLElement>) => {
      const content = e.currentTarget
      const next = e.relatedTarget
      if (restore.current || !next || next === content || !content.contains(next)) return
      content.removeAttribute('tabindex')
      const timer = window.setTimeout(() => {
        restore.current?.()
        // The move didn't happen after all (the control went away or can't take focus now): focus
        // went nowhere, so do what the trap would have done.
        if (document.activeElement === document.body && content.isConnected) content.focus({ preventScroll: true })
      })
      restore.current = () => {
        window.clearTimeout(timer)
        restore.current = null
        if (!content.hasAttribute('tabindex')) content.setAttribute('tabindex', '-1')
      }
    },
    onFocusCapture: () => restore.current?.(),
  }
}

/** Centered modal dialog (bottom sheet on small screens). */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = 'md',
  hideTitle,
  className,
  dismissible = true,
  onOpenAutoFocus,
  onCloseAutoFocus,
}: DialogProps) {
  const focusMoves = useKeepFocusMoves()
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className={cn('fixed inset-0 z-[80] bg-overlay backdrop-blur-[2px]', OVERLAY_FADE)} />
        <RDialog.Content
          {...focusMoves}
          onOpenAutoFocus={(e) => {
            onModalOpen(e)
            onOpenAutoFocus?.(e)
          }}
          onCloseAutoFocus={(e) => {
            onCloseAutoFocus?.(e)
            onModalClose(e)
          }}
          onPointerDownOutside={(e) => (!dismissible || isToastTarget(e)) && e.preventDefault()}
          onEscapeKeyDown={(e) => !dismissible && e.preventDefault()}
          className={cn(
            'fixed z-[81] flex max-h-[min(92dvh,900px)] w-full flex-col overflow-hidden border border-line bg-surface text-fg shadow-overlay outline-none',
            // mobile: bottom sheet; ≥sm: centered card
            'inset-x-0 bottom-0 rounded-t-2xl data-[state=open]:animate-slide-up',
            'sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:data-[state=open]:animate-scale-in',
            WIDTHS[size],
            className,
          )}
        >
          {/* With no body, the header keeps the body's room above the footer itself. */}
          <div className={cn('flex items-start gap-4 px-5 pt-5 sm:px-6', children ? 'pb-2' : 'pb-5', hideTitle && 'sr-only')}>
            <div className="min-w-0 flex-1">
              <RDialog.Title className="text-[17px] font-semibold tracking-[-0.01em]">{title}</RDialog.Title>
              {description ? (
                <RDialog.Description className="mt-1 text-sm text-fg-muted">{description}</RDialog.Description>
              ) : (
                <RDialog.Description className="sr-only">{typeof title === 'string' ? title : 'Dialog'}</RDialog.Description>
              )}
            </div>
            {/* 40px on touch screens, grown evenly around the same icon spot. */}
            <RDialog.Close
              className="-mr-2 -mt-1 inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-fg-subtle transition-colors hover:bg-surface-3 hover:text-fg pointer-coarse:-mr-3 pointer-coarse:-mt-2 pointer-coarse:size-10"
              aria-label="Close"
            >
              <X className="size-4" />
            </RDialog.Close>
          </div>
          {children && <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-2 scrollbar-thin sm:px-6">{children}</div>}
          {footer && (
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-surface-2 px-5 pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] sm:px-6">
              {footer}
            </div>
          )}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  )
}

export interface SheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  side?: 'left' | 'right' | 'bottom'
  title: string
  children: ReactNode
  className?: string
}

/** Slide-over panel (used for side panels on small screens). */
export function Sheet({ open, onOpenChange, side = 'right', title, children, className }: SheetProps) {
  const contentRef = useRef<HTMLDivElement>(null)
  const focusMoves = useKeepFocusMoves()
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className={cn('fixed inset-0 z-[70] bg-overlay', OVERLAY_FADE)} />
        <RDialog.Content
          ref={contentRef}
          {...focusMoves}
          // The sheet itself takes focus on open (no ring or tooltip on its first control);
          // Tab moves on into it.
          onOpenAutoFocus={(e) => {
            onModalOpen(e)
            e.preventDefault()
            contentRef.current?.focus()
          }}
          onCloseAutoFocus={onModalClose}
          onPointerDownOutside={(e) => isToastTarget(e) && e.preventDefault()}
          className={cn(
            'fixed z-[71] flex flex-col bg-surface text-fg shadow-overlay outline-none',
            // The side at the screen's edge is padded with its safe-area inset (a phone held sideways:
            // notch, rounded corners). A side sheet grows by it: the width it is given stays usable.
            side === 'right' && 'inset-y-0 right-0 box-content w-[min(88vw,360px)] border-l border-line pr-safe data-[state=open]:animate-slide-in-right',
            side === 'left' && 'inset-y-0 left-0 box-content w-[min(80vw,300px)] border-r border-line pl-safe data-[state=open]:animate-slide-in-left',
            side === 'bottom' && 'inset-x-0 bottom-0 max-h-[80dvh] rounded-t-2xl border-t border-line pl-safe pr-safe data-[state=open]:animate-slide-up',
            className,
          )}
        >
          <RDialog.Title className="sr-only">{title}</RDialog.Title>
          <RDialog.Description className="sr-only">{title}</RDialog.Description>
          {children}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  )
}
