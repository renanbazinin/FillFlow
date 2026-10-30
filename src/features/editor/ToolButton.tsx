import type { ComponentProps } from 'react'
import { cn } from '../../lib/utils/misc'
import { Tooltip } from '../../components/ui/tooltip'
import type { ToolDef } from '../../model/tools'

export interface ToolButtonProps extends Omit<ComponentProps<'button'>, 'children'> {
  tool: Pick<ToolDef, 'label' | 'hint' | 'shortcut' | 'icon'>
  active?: boolean
  /** Small dot/badge in the corner (e.g. "tool locked"). */
  badge?: boolean
  /** Show the text label under the icon (wide docks). */
  showLabel?: boolean
  tooltipSide?: 'top' | 'bottom' | 'left' | 'right'
}

/**
 * The square tool button used by the tool dock. Shared so the signature/image buttons (which
 * open popovers) look identical to plain tools. Forwards refs/props, so it can be used as a
 * Radix `asChild` trigger.
 */
export function ToolButton({ tool, active, badge, showLabel, tooltipSide = 'top', className, ...props }: ToolButtonProps) {
  const Icon = tool.icon
  return (
    <Tooltip content={<span>{tool.label}<span className="ml-1.5 font-normal opacity-70">{tool.hint}</span></span>} shortcut={tool.shortcut} side={tooltipSide}>
      <button
        type="button"
        aria-label={tool.label}
        aria-pressed={active}
        className={cn(
          'relative inline-flex shrink-0 select-none flex-col items-center justify-center gap-0.5 rounded-xl text-fg-muted transition-[background-color,color,transform] duration-150 hover:bg-surface-3 hover:text-fg active:scale-[0.96]',
          showLabel ? 'h-12 min-w-12 px-1.5' : 'size-10',
          active && 'bg-accent text-accent-fg shadow-xs hover:bg-accent hover:text-accent-fg',
          className,
        )}
        {...props}
      >
        <Icon className="size-[18px]" strokeWidth={active ? 2.25 : 2} />
        {showLabel && <span className="text-[10px] font-medium leading-none">{tool.label}</span>}
        {badge && <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-current" />}
      </button>
    </Tooltip>
  )
}
