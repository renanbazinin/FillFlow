import { useState } from 'react'
import { Kbd } from '../../components/ui/controls'
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/menu'
import { cn } from '../../lib/utils/misc'
import { TOOL_BY_ID } from '../../model/tools'
import { useEditor } from '../../store/editor'
import { SHAPE_TOOLS, isShapeTool, useLastShape, type ShapeTool } from './shapeTools'
import { ToolButton } from './ToolButton'
import { usePointerAwareClose } from './usePointerAwareClose'

/** Dock button for rectangle / ellipse / line, choosing from a small popover. */
export function ShapesButton() {
  const tool = useEditor((s) => s.tool)
  const locked = useEditor((s) => s.toolLocked)
  const last = useLastShape()
  const [open, setOpen] = useState(false)
  const closeHandlers = usePointerAwareClose()
  const active = isShapeTool(tool)
  const current = active ? tool : last

  const pick = (id: ShapeTool) => {
    useEditor.getState().setTool(id)
    setOpen(false)
  }

  return (
    <span className="relative inline-flex">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <ToolButton
            tool={{ label: 'Shapes', hint: 'Rectangle, ellipse or line', icon: TOOL_BY_ID[current].icon }}
            active={active}
            badge={active && locked}
            aria-haspopup="dialog"
            // Like the other tools, a double-click keeps the (current) shape tool on.
            onDoubleClick={() => {
              useEditor.getState().setTool(current, { locked: true })
              setOpen(false)
            }}
          />
        </PopoverTrigger>
        <PopoverContent side="top" sideOffset={12} className="w-56 p-1" {...closeHandlers}>
          <div className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Shapes</div>
          {SHAPE_TOOLS.map((id) => {
            const def = TOOL_BY_ID[id]
            const Icon = def.icon
            const selected = tool === id
            return (
              <button
                key={id}
                type="button"
                aria-pressed={selected}
                onClick={() => pick(id)}
                className={cn(
                  'flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] text-fg transition-colors hover:bg-surface-3 pointer-coarse:h-11',
                  selected && 'bg-accent-soft text-accent-ink hover:bg-accent-soft',
                )}
              >
                <Icon className={cn('size-4', selected ? 'text-accent-ink' : 'text-fg-muted')} />
                <span className="flex-1">{def.label}</span>
                {def.shortcut && <Kbd>{def.shortcut}</Kbd>}
              </button>
            )
          })}
        </PopoverContent>
      </Popover>
      {/* Corner caret: this button opens a choice. */}
      <svg
        aria-hidden
        viewBox="0 0 6 6"
        className={cn('pointer-events-none absolute bottom-[7px] right-[7px] size-[5px]', active ? 'text-accent-fg' : 'text-fg-subtle')}
      >
        <path d="M6 0V6H0Z" fill="currentColor" />
      </svg>
    </span>
  )
}
