import { useRef, type ReactNode } from 'react'
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

const WIDTHS = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }

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
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-[80] bg-overlay backdrop-blur-[2px] data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out" />
        <RDialog.Content
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
          <div className={cn('flex items-start gap-4 px-5 pb-2 pt-5 sm:px-6', hideTitle && 'sr-only')}>
            <div className="min-w-0 flex-1">
              <RDialog.Title className="text-[17px] font-semibold tracking-[-0.01em]">{title}</RDialog.Title>
              {description ? (
                <RDialog.Description className="mt-1 text-sm text-fg-muted">{description}</RDialog.Description>
              ) : (
                <RDialog.Description className="sr-only">{typeof title === 'string' ? title : 'Dialog'}</RDialog.Description>
              )}
            </div>
            <RDialog.Close
              className="-mr-2 -mt-1 inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-fg-subtle transition-colors hover:bg-surface-3 hover:text-fg"
              aria-label="Close"
            >
              <X className="size-4" />
            </RDialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-2 scrollbar-thin sm:px-6">{children}</div>
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
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-[70] bg-overlay data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out" />
        <RDialog.Content
          ref={contentRef}
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
            side === 'right' && 'inset-y-0 right-0 w-[min(88vw,360px)] border-l border-line data-[state=open]:animate-slide-in-right',
            side === 'left' && 'inset-y-0 left-0 w-[min(80vw,300px)] border-r border-line data-[state=open]:animate-slide-in-left',
            side === 'bottom' && 'inset-x-0 bottom-0 max-h-[80dvh] rounded-t-2xl border-t border-line data-[state=open]:animate-slide-up',
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
