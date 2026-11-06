import type { ComponentProps, ReactNode } from 'react'
import { Slot } from 'radix-ui'
import { cn } from '../../lib/utils/misc'
import { Tooltip } from './tooltip'

// Filled variants are drawn with a border in forced colors mode (Windows Contrast themes), which
// drops their fill.
const VARIANTS = {
  primary:
    'bg-accent text-accent-fg shadow-xs hover:bg-accent-hover active:brightness-95 disabled:opacity-50 forced-colors:border',
  secondary:
    'bg-surface text-fg border border-line shadow-xs hover:bg-surface-2 hover:border-line-strong active:bg-surface-3 disabled:opacity-50',
  ghost: 'text-fg-muted hover:text-fg hover:bg-surface-3 active:bg-line disabled:opacity-40',
  soft: 'bg-accent-soft text-accent-ink hover:brightness-95 dark:hover:brightness-125 disabled:opacity-50 forced-colors:border',
  danger: 'bg-danger text-white shadow-xs hover:brightness-110 active:brightness-95 disabled:opacity-50 forced-colors:border',
  'danger-ghost': 'text-danger hover:bg-danger-soft disabled:opacity-40',
} as const

const SIZES = {
  xs: 'h-7 px-2 text-xs gap-1 rounded-md',
  sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-lg',
  md: 'h-9 px-3.5 text-sm gap-2 rounded-lg',
  lg: 'h-11 px-5 text-[15px] gap-2 rounded-xl',
  icon: 'size-9 rounded-lg',
  'icon-sm': 'size-8 rounded-lg',
  'icon-xs': 'size-7 rounded-md',
} as const

export type ButtonVariant = keyof typeof VARIANTS
export type ButtonSize = keyof typeof SIZES

export interface ButtonProps extends ComponentProps<'button'> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Render the child element instead of a <button> (e.g. a <label> or <a>). */
  asChild?: boolean
}

export function Button({ variant = 'secondary', size = 'md', asChild, className, type, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : 'button'
  return (
    <Comp
      type={asChild ? undefined : (type ?? 'button')}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap font-medium transition-[background-color,border-color,color,box-shadow,filter] duration-150 disabled:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
        // Touch screens: no target under 40×40 (also when the caller sets a smaller size).
        'min-tap-size',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  )
}

export interface IconButtonProps extends Omit<ButtonProps, 'children'> {
  /** Accessible label; also the tooltip text. */
  label: string
  icon: ReactNode
  shortcut?: string
  /** Pressed/toggled state (adds aria-pressed and an active style). */
  active?: boolean
  tooltipSide?: 'top' | 'bottom' | 'left' | 'right'
  /** Set false to suppress the tooltip (label is still used for a11y). */
  tooltip?: boolean
}

export function IconButton({
  label,
  icon,
  shortcut,
  active,
  tooltipSide = 'bottom',
  tooltip = true,
  variant = 'ghost',
  size = 'icon',
  className,
  ...props
}: IconButtonProps) {
  const button = (
    <Button
      aria-label={label}
      aria-pressed={active === undefined ? undefined : active}
      variant={variant}
      size={size}
      className={cn(active && 'bg-accent-soft text-accent-ink hover:bg-accent-soft hover:text-accent-ink', className)}
      {...props}
    >
      {icon}
    </Button>
  )
  if (!tooltip) return button
  return (
    <Tooltip content={label} shortcut={shortcut} side={tooltipSide}>
      {button}
    </Tooltip>
  )
}
