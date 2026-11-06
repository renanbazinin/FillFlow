import { CircleCheck, CornerDownRight, RotateCcw } from 'lucide-react'
import { Button, IconButton } from '../../../components/ui/button'
import { Segmented } from '../../../components/ui/controls'
import { richText, useT } from '../../../i18n'
import { cn } from '../../../lib/utils/misc'
import type { FieldFilter, FormProgress } from '../progress'

interface Props {
  progress: FormProgress
  filter: FieldFilter
  onFilter: (f: FieldFilter) => void
  emptyCount: number
  dirty: boolean
  onNext: () => void
  onReset: () => void
}

/** A filter's count. On a chosen filter in forced colors mode, it takes the system highlight text color. */
function Count({ n }: { n: number }) {
  return <span className="ms-0.5 tabular-nums text-fg-subtle forced-colors:text-current">{n}</span>
}

/** Progress summary, filter and actions; sticks to the top of the panel's scroll area. */
export function ProgressHeader({ progress, filter, onFilter, emptyCount, dirty, onNext, onReset }: Props) {
  const t = useT()
  const m = t.forms.progress
  const { total, filled, required, requiredFilled } = progress
  const pct = total ? Math.round((filled / total) * 100) : 0
  const requiredLeft = required - requiredFilled
  const complete = total > 0 && filled === total

  return (
    <div className="sticky top-0 z-10 border-b border-line bg-surface px-4 pb-3 pt-3.5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[13px] font-semibold text-fg">
          {richText(m.filled(filled), {
            filled: <span className="tabular-nums">{filled}</span>,
            total: <span className="tabular-nums">{total}</span>,
          })}
        </p>
        {required > 0 && (
          <p className={cn('flex items-center gap-1 text-[12px]', requiredLeft ? 'text-fg-muted' : 'text-success')}>
            {requiredLeft ? (
              <>
                <span className="text-danger">*</span>
                {richText(m.requiredLeft(requiredLeft), { count: <span className="tabular-nums">{requiredLeft}</span> })}
              </>
            ) : (
              <>
                <CircleCheck className="size-3.5" /> {m.requiredDone}
              </>
            )}
          </p>
        )}
      </div>
      {/* The bar fills from the start: from the right in a right-to-left interface. */}
      <div
        role="progressbar"
        aria-label={m.bar}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={filled}
        aria-valuetext={m.barValue(filled, total)}
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3 forced-colors:border"
      >
        <div
          className={cn(
            'h-full rounded-full transition-[width,background-color] duration-300 ease-out forced-colors:bg-[Highlight]',
            complete ? 'bg-success' : 'bg-accent',
          )}
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="mt-3 flex items-center gap-2">
        <Segmented<FieldFilter>
          size="sm"
          label={m.filter}
          value={filter}
          onValueChange={onFilter}
          className="min-w-0 flex-1 [&>*]:flex-1"
          options={[
            { value: 'all', label: m.all },
            { value: 'required', label: <>{m.required}{required > 0 && <Count n={required} />}</> },
            { value: 'empty', label: <>{m.empty}{emptyCount > 0 && <Count n={emptyCount} />}</> },
          ]}
        />
        <IconButton label={m.reset} icon={<RotateCcw />} size="icon-sm" variant="ghost" disabled={!dirty} onClick={onReset} />
      </div>
      <Button variant="soft" size="sm" className="mt-2 w-full" disabled={!emptyCount} onClick={onNext}>
        {/* On to the next field: the arrow turns the way the interface reads. */}
        {emptyCount ? <CornerDownRight className="rtl:-scale-x-100" /> : <CircleCheck />}
        {emptyCount ? m.next : m.allFilled}
      </Button>
    </div>
  )
}
