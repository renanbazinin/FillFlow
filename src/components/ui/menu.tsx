import type { ComponentProps, ReactNode } from 'react'
import { DropdownMenu, Popover as RPopover } from 'radix-ui'
import { Check } from 'lucide-react'
import { cn } from '../../lib/utils/misc'

const PANEL =
  'z-[90] rounded-xl border border-line bg-surface p-1 text-fg shadow-float outline-none data-[state=open]:animate-scale-in'

// --- Dropdown menu ---------------------------------------------------------

export const Menu = DropdownMenu.Root
export const MenuTrigger = DropdownMenu.Trigger

export function MenuContent({ className, sideOffset = 6, align = 'end', ...props }: ComponentProps<typeof DropdownMenu.Content>) {
  return (
    <DropdownMenu.Portal>
      {/* No taller than the room left on screen (Radix measures it): on short screens the menu scrolls. */}
      <DropdownMenu.Content
        sideOffset={sideOffset}
        align={align}
        collisionPadding={8}
        className={cn(
          PANEL,
          'max-h-(--radix-dropdown-menu-content-available-height) min-w-52 overflow-y-auto overscroll-contain scrollbar-thin',
          className,
        )}
        {...props}
      />
    </DropdownMenu.Portal>
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
        className,
      )}
      {...props}
    >
      {icon}
      <span className="flex-1">{children}</span>
      {shortcut && <span className="text-xs text-fg-subtle">{shortcut}</span>}
    </DropdownMenu.Item>
  )
}

export function MenuCheckboxItem({ className, children, ...props }: ComponentProps<typeof DropdownMenu.CheckboxItem>) {
  return (
    <DropdownMenu.CheckboxItem
      className={cn(
        'flex h-8 cursor-pointer select-none items-center gap-2.5 rounded-lg px-2.5 text-[13px] outline-none data-[highlighted]:bg-surface-3',
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
  return <DropdownMenu.Separator className={cn('-mx-1 my-1 h-px bg-line', className)} {...props} />
}

// --- Popover ---------------------------------------------------------------

export const Popover = RPopover.Root
export const PopoverTrigger = RPopover.Trigger
export const PopoverAnchor = RPopover.Anchor
export const PopoverClose = RPopover.Close

export function PopoverContent({ className, sideOffset = 8, align = 'center', ...props }: ComponentProps<typeof RPopover.Content>) {
  return (
    <RPopover.Portal>
      <RPopover.Content sideOffset={sideOffset} align={align} collisionPadding={8} className={cn(PANEL, 'p-3', className)} {...props} />
    </RPopover.Portal>
  )
}
