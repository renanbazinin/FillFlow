import { Lock } from 'lucide-react'
import { Kbd } from '../../components/ui/controls'
import { useT } from '../../i18n'
import { cn } from '../../lib/utils/misc'
import { TOOL_BY_ID } from '../../model/tools'
import { useEditor } from '../../store/editor'
import { toolHint } from './hintText'
import { useMediaQuery } from './useMediaQuery'

/** Small chip above the dock explaining the active creation tool. */
export function ToolHint({ className }: { className?: string }) {
  const tool = useEditor((s) => s.tool)
  const locked = useEditor((s) => s.toolLocked)
  const armed = useEditor((s) => s.placingAssetId !== null)
  const touch = useMediaQuery('(pointer: coarse)')
  const t = useT()
  const hint = toolHint(tool, { armed, touch })
  const Icon = TOOL_BY_ID[tool]?.icon

  return (
    // The live region stays mounted so screen readers announce each new hint.
    <div role="status" aria-live="polite" className={cn('pointer-events-none flex justify-center', className)}>
      {hint && (
        <div
          key={`${tool}:${armed}`}
          className="flex max-w-[calc(100vw-24px)] items-center gap-2 rounded-full border border-line bg-surface/95 py-1.5 ps-2.5 pe-3 text-[12.5px] shadow-float backdrop-blur-xl animate-slide-up"
        >
          {Icon && <Icon className="size-3.5 shrink-0 text-accent-ink" strokeWidth={2.25} />}
          <span className="truncate font-medium text-fg">{hint.text}</span>
          {locked && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent-soft px-1.5 py-px text-[11px] font-medium text-accent-ink">
              <Lock className="size-2.5" strokeWidth={2.5} />
              {t.editor.hint.staysOn}
            </span>
          )}
          {/* "Enter to add · Esc to finish": each key as a key cap, then what it does. */}
          {hint.keys.map(({ key, action }) => (
            <span key={key} className="flex shrink-0 items-center gap-1.5 text-fg-subtle">
              <span aria-hidden>·</span>
              <Kbd className="h-[18px] min-w-[18px] text-[10.5px]">{key}</Kbd>
              <span>{action}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
