import { Check, Pencil, Signature, Type } from 'lucide-react'
import { Kbd } from '../../../components/ui/controls'
import { richText, useT, type Messages } from '../../../i18n'
import { TOOL_BY_ID } from '../../../model/tools'
import { viewer } from '../../viewer/viewerApi'
import { activateTool } from '../state/tools'
import { closePanelOnSmallScreens } from './panel'

/** The tools offered to start with; what each is for is `elements.panel.empty.quick[tool]`. */
const QUICK: { tool: keyof Messages['elements']['panel']['empty']['quick']; icon: typeof Type }[] = [
  { tool: 'text', icon: Type },
  { tool: 'check', icon: Check },
  { tool: 'signature', icon: Signature },
  { tool: 'ink', icon: Pencil },
]

/** Shown when nothing has been placed yet: what the panel is for and how to start. */
export function ItemsEmptyState() {
  const t = useT()
  const m = t.elements.panel.empty
  return (
    <div data-items-panel="" className="flex flex-col items-center px-5 pb-6 pt-10 text-center">
      {/* A fan of cards, mirrored right to left (the text card first, at the start). */}
      <div className="relative mb-5 h-16 w-20" aria-hidden>
        <span className="absolute start-1 top-3 flex size-11 -rotate-6 items-center justify-center rounded-xl border border-line bg-surface-2 text-fg-subtle shadow-xs rtl:rotate-6">
          <Type className="size-5" />
        </span>
        <span className="absolute end-1 top-0 flex size-11 rotate-6 items-center justify-center rounded-xl border border-line bg-surface-2 text-fg-subtle shadow-xs rtl:-rotate-6">
          <Signature className="size-5" />
        </span>
        <span className="absolute left-1/2 top-5 flex size-11 -translate-x-1/2 items-center justify-center rounded-xl border border-line bg-surface text-accent-ink shadow-float">
          <Check className="size-5" strokeWidth={2.5} />
        </span>
      </div>
      <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-fg">{m.title}</h3>
      <p className="mt-1 max-w-64 text-[13px] leading-5 text-fg-muted">{m.body}</p>
      <div className="mt-6 grid w-full gap-1">
        {QUICK.map(({ tool, icon: Icon }) => {
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
              className="group flex items-center gap-3 rounded-xl border border-transparent px-3 py-2 text-start transition-colors hover:border-line hover:bg-surface-2"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-ink">
                <Icon className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium text-fg">{def.label}</span>
                <span className="block truncate text-[12px] text-fg-muted">{m.quick[tool]}</span>
              </span>
              {def.shortcut && <Kbd className="pointer-coarse:hidden">{def.shortcut}</Kbd>}
            </button>
          )
        })}
      </div>
      <p className="mt-4 max-w-64 text-[12px] leading-5 text-fg-subtle pointer-coarse:hidden">{richText(m.keyboard, { enter: <Kbd>Enter</Kbd> })}</p>
    </div>
  )
}
