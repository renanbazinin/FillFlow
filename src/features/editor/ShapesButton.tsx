import { useRef, useState } from 'react'
import { Kbd } from '../../components/ui/controls'
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/menu'
import { dismissPassingToasts } from '../../components/ui/toasts'
import { useT } from '../../i18n'
import { cn } from '../../lib/utils/misc'
import { TOOL_BY_ID } from '../../model/tools'
import { useEditor } from '../../store/editor'
import { viewer } from '../viewer/viewerApi'
import { SHAPE_TOOLS, isShapeTool, useLastShape, type ShapeTool } from './shapeTools'
import { ChoiceCaret, ToolButton } from './ToolButton'
import { usePointerAwareClose } from './usePointerAwareClose'

/** Dock button for rectangle / ellipse / line, choosing from a small popover. */
export function ShapesButton() {
  const tool = useEditor((s) => s.tool)
  const locked = useEditor((s) => s.toolLocked)
  const last = useLastShape()
  const t = useT()
  const [open, setOpen] = useState(false)
  const closeHandlers = usePointerAwareClose()
  /** The last shape was picked from the keyboard. */
  const keyed = useRef(false)
  const active = isShapeTool(tool)
  const current = active ? tool : last

  const pick = (id: ShapeTool, byKeyboard: boolean) => {
    keyed.current = byKeyboard
    useEditor.getState().setTool(id)
    setOpen(false)
  }

  const toggle = (next: boolean) => {
    // The popover opens where passing toasts sit, and any left up would cover its items: clear them
    // (the messages that stay until acted on sit under the top bar, and stay).
    if (next) dismissPassingToasts()
    setOpen(next)
  }

  return (
    <span className="relative inline-flex">
      <Popover open={open} onOpenChange={toggle}>
        <PopoverTrigger asChild>
          <ToolButton
            tool={{ label: t.editor.dock.shapes, hint: t.editor.dock.shapesHint, icon: TOOL_BY_ID[current].icon }}
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
        <PopoverContent
          side="top"
          sideOffset={12}
          aria-label={t.editor.dock.shapes}
          className="w-56 p-1"
          {...closeHandlers}
          onCloseAutoFocus={(e) => {
            closeHandlers.onCloseAutoFocus(e)
            if (!keyed.current) return
            // Picked from the keyboard: on to the pages, where Enter adds the shape. Back on the
            // button, Enter would open this list again.
            keyed.current = false
            e.preventDefault()
            viewer.getScrollContainer()?.focus({ preventScroll: true })
          }}
        >
          <div className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">{t.editor.dock.shapes}</div>
          {SHAPE_TOOLS.map((id) => {
            const def = TOOL_BY_ID[id]
            const Icon = def.icon
            const selected = tool === id
            return (
              <button
                key={id}
                type="button"
                aria-pressed={selected}
                // Pressing Enter or Space on a button fires a click with no click count.
                onClick={(e) => pick(id, e.detail === 0)}
                className={cn(
                  'flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-start text-[13px] text-fg transition-colors hover:bg-surface-3 pointer-coarse:h-11',
                  selected && 'bg-accent-soft text-accent-ink hover:bg-accent-soft',
                )}
              >
                <Icon className={cn('size-4', selected ? 'text-accent-ink' : 'text-fg-muted')} />
                <span className="flex-1">{def.label}</span>
                {/* A key means nothing on a touch screen. */}
                {def.shortcut && <Kbd className="pointer-coarse:hidden">{def.shortcut}</Kbd>}
              </button>
            )
          })}
        </PopoverContent>
      </Popover>
      <ChoiceCaret active={active} />
    </span>
  )
}
