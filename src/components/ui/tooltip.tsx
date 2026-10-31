import type { FocusEvent, ReactNode } from 'react'
import { Tooltip as RTooltip } from 'radix-ui'
import { Kbd } from './controls'

/**
 * Radix opens a tooltip whenever its trigger gains focus without a press. Focus handed back by
 * script after a click or tap (a dialog or menu closing) isn't :focus-visible: no tooltip then.
 */
function keyboardFocusOnly(e: FocusEvent<HTMLElement>) {
  if (!e.currentTarget.matches(':focus-visible')) e.preventDefault()
}

export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <RTooltip.Provider delayDuration={450} skipDelayDuration={250}>
      {children}
    </RTooltip.Provider>
  )
}

export interface TooltipProps {
  content: ReactNode
  /** Keyboard shortcut shown next to the label, e.g. "V" or "Ctrl+Z". */
  shortcut?: string
  side?: 'top' | 'bottom' | 'left' | 'right'
  align?: 'start' | 'center' | 'end'
  children: ReactNode
  disabled?: boolean
}

/** Wraps a single focusable child. */
export function Tooltip({ content, shortcut, side = 'bottom', align = 'center', children, disabled }: TooltipProps) {
  if (disabled || !content) return <>{children}</>
  return (
    <RTooltip.Root>
      <RTooltip.Trigger asChild onFocus={keyboardFocusOnly}>
        {children}
      </RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content
          side={side}
          align={align}
          sideOffset={8}
          collisionPadding={8}
          className="z-[100] flex max-w-xs items-center gap-2 rounded-lg bg-[#0e1726] px-2.5 py-1.5 text-xs font-medium text-white shadow-float data-[state=delayed-open]:animate-fade-in dark:bg-[#e8ebf1] dark:text-[#0e1726]"
        >
          <span>{content}</span>
          {shortcut && <Kbd className="border-white/20 bg-white/10 text-white/80 dark:border-black/15 dark:bg-black/5 dark:text-black/60">{shortcut}</Kbd>}
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  )
}
