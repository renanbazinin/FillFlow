import { useState, type ComponentProps, type ReactNode } from 'react'
import { DropdownMenu, Popover as RPopover } from 'radix-ui'
import { Check } from 'lucide-react'
import { cn } from '../../lib/utils/misc'

const PANEL =
  'z-[90] rounded-xl border border-line bg-surface p-1 text-fg shadow-float outline-none data-[state=open]:animate-scale-in'

/**
 * Room a menu or popover keeps from the screen's edges: 8px, or the safe area on that side where
 * that is wider (a phone's notch and rounded corners when held sideways, its home bar), as the
 * edge-to-edge bars do (pr-safe-2…). Read once, as it opens.
 */
function useEdgePadding() {
  const [padding] = useState(() => {
    const style = getComputedStyle(document.documentElement)
    const side = (name: string) => Math.max(8, parseFloat(style.getPropertyValue(`--ff-safe-${name}`)) || 0)
    return { top: side('top'), right: side('right'), bottom: side('bottom'), left: side('left') }
  })
  return padding
}

/**
 * Shared by every kind of menu row: 44px tall on touch screens. In forced colors mode (Windows
 * Contrast themes) the highlighted row is drawn in the system highlight colors, and icons follow
 * the text color.
 */
const ROW = 'pointer-coarse:h-11 forced-colors:data-[highlighted]:system-highlight forced-colors:[&_svg]:text-current'

// --- Dropdown menu ---------------------------------------------------------

export const Menu = DropdownMenu.Root
export const MenuTrigger = DropdownMenu.Trigger

export function MenuContent(props: ComponentProps<typeof DropdownMenu.Content>) {
  return (
    <DropdownMenu.Portal>
      <MenuPanel {...props} />
    </DropdownMenu.Portal>
  )
}

/** The open menu (the portal renders it only then). */
function MenuPanel({ className, sideOffset = 6, align = 'end', ...props }: ComponentProps<typeof DropdownMenu.Content>) {
  const padding = useEdgePadding()
  return (
    // No taller than the room left on screen (Radix measures it): on short screens the menu scrolls.
    <DropdownMenu.Content
      sideOffset={sideOffset}
      align={align}
      collisionPadding={padding}
      className={cn(
        PANEL,
        'max-h-(--radix-dropdown-menu-content-available-height) min-w-52 overflow-y-auto overscroll-contain scrollbar-thin',
        className,
      )}
      {...props}
    />
  )
}

export function MenuItem({
  className,
  icon,
  shortcut,
  danger,
  children,
  ...props
}: ComponentProps<typeof DropdownMenu.Item> & { icon?: ReactNode; shortcut?: string; danger?: boolean }) {
  return (
    <DropdownMenu.Item
      className={cn(
        'flex h-8 cursor-pointer select-none items-center gap-2.5 rounded-lg px-2.5 text-[13px] outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-40 data-[highlighted]:bg-surface-3 [&_svg]:size-4 [&_svg]:text-fg-muted',
        danger && 'text-danger data-[highlighted]:bg-danger-soft [&_svg]:text-danger',
        ROW,
        className,
      )}
      {...props}
    >
      {icon}
      <span className="flex-1">{children}</span>
      {shortcut && <MenuShortcut>{shortcut}</MenuShortcut>}
    </DropdownMenu.Item>
  )
}

/** A row's keyboard shortcut ("Ctrl+O"); not shown on touch screens, where it means nothing. */
export function MenuShortcut({ className, ...props }: ComponentProps<'span'>) {
  return <span className={cn('text-xs text-fg-subtle pointer-coarse:hidden forced-colors:text-current', className)} {...props} />
}

export function MenuCheckboxItem({ className, children, ...props }: ComponentProps<typeof DropdownMenu.CheckboxItem>) {
  return (
    <DropdownMenu.CheckboxItem
      className={cn(
        'flex h-8 cursor-pointer select-none items-center gap-2.5 rounded-lg px-2.5 text-[13px] outline-none data-[highlighted]:bg-surface-3',
        ROW,
        className,
      )}
      {...props}
    >
      <span className="flex size-4 items-center justify-center">
        <DropdownMenu.ItemIndicator>
          <Check className="size-4 text-accent-ink" />
        </DropdownMenu.ItemIndicator>
      </span>
      {children}
    </DropdownMenu.CheckboxItem>
  )
}

export const MenuRadioGroup = DropdownMenu.RadioGroup

export function MenuRadioItem({ className, children, ...props }: ComponentProps<typeof DropdownMenu.RadioItem>) {
  return (
    <DropdownMenu.RadioItem
      className={cn(
        'flex h-8 cursor-pointer select-none items-center gap-2.5 rounded-lg px-2.5 text-[13px] outline-none data-[highlighted]:bg-surface-3',
        ROW,
        className,
      )}
      {...props}
    >
      <span className="flex size-4 items-center justify-center">
        <DropdownMenu.ItemIndicator>
          <Check className="size-4 text-accent-ink" />
        </DropdownMenu.ItemIndicator>
      </span>
      {children}
    </DropdownMenu.RadioItem>
  )
}

export function MenuLabel({ className, ...props }: ComponentProps<typeof DropdownMenu.Label>) {
  return <DropdownMenu.Label className={cn('px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-fg-subtle', className)} {...props} />
}

export function MenuSeparator({ className, ...props }: ComponentProps<typeof DropdownMenu.Separator>) {
  return <DropdownMenu.Separator className={cn('-mx-1 my-1 h-px bg-line forced-colors:bg-[CanvasText]', className)} {...props} />
}

// --- Popover ---------------------------------------------------------------

export const Popover = RPopover.Root
export const PopoverTrigger = RPopover.Trigger
export const PopoverAnchor = RPopover.Anchor
export const PopoverClose = RPopover.Close

export function PopoverContent(props: ComponentProps<typeof RPopover.Content>) {
  return (
    <RPopover.Portal>
      <PopoverPanel {...props} />
    </RPopover.Portal>
  )
}

/** The open popover (the portal renders it only then). */
function PopoverPanel({ className, sideOffset = 8, align = 'center', ...props }: ComponentProps<typeof RPopover.Content>) {
  const padding = useEdgePadding()
  return (
    // No wider than the room on screen between the edge paddings (Radix measures it): on a narrow
    // phone a row of swatches wraps rather than running off the screen.
    <RPopover.Content
      sideOffset={sideOffset}
      align={align}
      collisionPadding={padding}
      className={cn(PANEL, 'max-w-(--radix-popover-content-available-width) p-3', className)}
      {...props}
    />
  )
}
