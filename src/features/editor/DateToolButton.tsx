import { useRef, useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/menu'
import { dismissPassingToasts } from '../../components/ui/toasts'
import { cn } from '../../lib/utils/misc'
import { TOOL_BY_ID } from '../../model/tools'
import type { DateFormat } from '../../model/types'
import { useEditor } from '../../store/editor'
import { viewer } from '../viewer/viewerApi'
import { dateFormatChoices } from './dateFormats'
import { ChoiceCaret, ToolButton } from './ToolButton'
import { usePointerAwareClose } from './usePointerAwareClose'

/**
 * Dock button for the Date tool. A press arms the tool, as for the other tools, and offers the
 * date formats, each shown as today's date: the next click on a page inserts it in the format
 * marked, and a pick is remembered for next time. The D key arms the tool without the list.
 */
export function DateToolButton() {
  const active = useEditor((s) => s.tool === 'date')
  const locked = useEditor((s) => s.tool === 'date' && s.toolLocked)
  const format = useEditor((s) => s.styles.dateFormat)
  const [open, setOpen] = useState(false)
  const closeHandlers = usePointerAwareClose()
  /** The last format was picked from the keyboard. */
  const keyed = useRef(false)

  const toggle = (next: boolean) => {
    if (next) {
      // The list opens where passing toasts sit, and any left up would cover it: clear them (the
      // messages that stay until acted on sit under the top bar, and stay).
      dismissPassingToasts()
      // Already on (maybe kept on by a double-click): leave it as it is.
      const s = useEditor.getState()
      if (s.tool !== 'date') s.setTool('date')
    }
    setOpen(next)
  }

  const pick = (f: DateFormat, byKeyboard: boolean) => {
    keyed.current = byKeyboard
    useEditor.getState().setStyle('dateFormat', f)
    setOpen(false)
  }

  return (
    <span className="relative inline-flex">
      <Popover open={open} onOpenChange={toggle}>
        <PopoverTrigger asChild>
          <ToolButton
            tool={TOOL_BY_ID.date}
            active={active}
            badge={locked}
            aria-haspopup="dialog"
            // Like the other tools, a double-click keeps the tool on.
            onDoubleClick={() => {
              useEditor.getState().setTool('date', { locked: true })
              setOpen(false)
            }}
          />
        </PopoverTrigger>
        <PopoverContent
          side="top"
          sideOffset={12}
          aria-label="Date format"
          className="w-60 p-1"
          {...closeHandlers}
          onCloseAutoFocus={(e) => {
            closeHandlers.onCloseAutoFocus(e)
            if (!keyed.current) return
            // Picked from the keyboard: on to the pages, where Enter adds the date. Back on the
            // button, Enter would open this list again.
            keyed.current = false
            e.preventDefault()
            viewer.getScrollContainer()?.focus({ preventScroll: true })
          }}
          // Start on the format in use: Enter keeps it, rather than switching to the first one.
          onOpenAutoFocus={(e) => {
            const current = e.target instanceof Element ? e.target.querySelector<HTMLElement>('[aria-pressed="true"]') : null
            if (!current) return
            e.preventDefault()
            current.focus()
          }}
        >
          <div className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Date format</div>
          {dateFormatChoices(new Date()).map(({ format: f, example, pattern }) => {
            const selected = f === format
            return (
              <button
                key={f}
                type="button"
                aria-pressed={selected}
                // Read as "05/11/2026 (DD/MM/YYYY)", not as one run of characters.
                aria-label={pattern ? `${example} (${pattern})` : undefined}
                // Pressing Enter or Space on a button fires a click with no click count.
                onClick={(e) => pick(f, e.detail === 0)}
                className={cn(
                  'flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] text-fg transition-colors hover:bg-surface-3 pointer-coarse:h-11',
                  selected && 'bg-accent-soft text-accent-ink hover:bg-accent-soft',
                )}
              >
                <span className="flex-1 tabular-nums">{example}</span>
                {pattern && <span className={cn('text-[11px] tabular-nums', selected ? 'text-accent-ink' : 'text-fg-subtle')}>{pattern}</span>}
              </button>
            )
          })}
        </PopoverContent>
      </Popover>
      <ChoiceCaret active={active} />
    </span>
  )
}
