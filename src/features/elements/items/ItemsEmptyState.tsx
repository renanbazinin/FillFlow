import { Check, Pencil, Signature, Type } from 'lucide-react'
import { Kbd } from '../../../components/ui/controls'
import { TOOL_BY_ID } from '../../../model/tools'
import type { ToolId } from '../../../model/types'
import { viewer } from '../../viewer/viewerApi'
import { activateTool } from '../state/tools'
import { closePanelOnSmallScreens } from './panel'

const QUICK: { tool: ToolId; icon: typeof Type; text: string }[] = [
  { tool: 'text', icon: Type, text: 'Type anywhere on the page' },
  { tool: 'check', icon: Check, text: 'Tick boxes with a checkmark' },
  { tool: 'signature', icon: Signature, text: 'Draw, type or upload it' },
  { tool: 'ink', icon: Pencil, text: 'Freehand pen' },
]

/** Shown when nothing has been placed yet: what the panel is for and how to start. */
export function ItemsEmptyState() {
  return (
    <div data-items-panel="" className="flex flex-col items-center px-5 pb-6 pt-10 text-center">
      <div className="relative mb-5 h-16 w-20" aria-hidden>
        <span className="absolute left-1 top-3 flex size-11 -rotate-6 items-center justify-center rounded-xl border border-line bg-surface-2 text-fg-subtle shadow-xs">
          <Type className="size-5" />
        </span>
        <span className="absolute right-1 top-0 flex size-11 rotate-6 items-center justify-center rounded-xl border border-line bg-surface-2 text-fg-subtle shadow-xs">
          <Signature className="size-5" />
        </span>
        <span className="absolute left-1/2 top-5 flex size-11 -translate-x-1/2 items-center justify-center rounded-xl border border-line bg-surface text-accent-ink shadow-float">
          <Check className="size-5" strokeWidth={2.5} />
        </span>
      </div>
      <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-fg">No items yet</h3>
      <p className="mt-1 max-w-64 text-[13px] leading-5 text-fg-muted">Text, checkmarks, signatures and drawings you add to the document will be listed here.</p>
      <div className="mt-6 grid w-full gap-1">
        {QUICK.map(({ tool, icon: Icon, text }) => {
          const def = TOOL_BY_ID[tool]
          return (
            <button
              key={tool}
              type="button"
              onClick={(e) => {
                activateTool(tool)
                closePanelOnSmallScreens()
                // Chosen from the keyboard: on to the pages, where Enter adds the item.
                if (e.detail === 0) viewer.getScrollContainer()?.focus({ preventScroll: true })
              }}
              className="group flex items-center gap-3 rounded-xl border border-transparent px-3 py-2 text-left transition-colors hover:border-line hover:bg-surface-2"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-ink">
                <Icon className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium text-fg">{def.label}</span>
                <span className="block truncate text-[12px] text-fg-muted">{text}</span>
              </span>
              {def.shortcut && <Kbd className="pointer-coarse:hidden">{def.shortcut}</Kbd>}
            </button>
          )
        })}
      </div>
      <p className="mt-4 max-w-64 text-[12px] leading-5 text-fg-subtle pointer-coarse:hidden">
        From the keyboard: pick any tool but Draw, press <Kbd>Enter</Kbd> to add one in the middle of the page, then move it with the arrow keys.
      </p>
    </div>
  )
}
