import { CircleCheck, CornerDownRight, RotateCcw } from 'lucide-react'
import { Button, IconButton } from '../../../components/ui/button'
import { Segmented } from '../../../components/ui/controls'
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
  return <span className="ml-0.5 tabular-nums text-fg-subtle forced-colors:text-current">{n}</span>
}

/** Progress summary, filter and actions; sticks to the top of the panel's scroll area. */
export function ProgressHeader({ progress, filter, onFilter, emptyCount, dirty, onNext, onReset }: Props) {
  const { total, filled, required, requiredFilled } = progress
  const pct = total ? Math.round((filled / total) * 100) : 0
  const requiredLeft = required - requiredFilled
  const complete = total > 0 && filled === total

  return (
    <div className="sticky top-0 z-10 border-b border-line bg-surface px-4 pb-3 pt-3.5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[13px] font-semibold text-fg">
          <span className="tabular-nums">{filled}</span> of <span className="tabular-nums">{total}</span> filled
        </p>
        {required > 0 && (
          <p className={cn('flex items-center gap-1 text-[12px]', requiredLeft ? 'text-fg-muted' : 'text-success')}>
            {requiredLeft ? (
              <>
                <span className="text-danger">*</span>
                <span className="tabular-nums">{requiredLeft}</span> required left
              </>
            ) : (
              <>
                <CircleCheck className="size-3.5" /> Required done
              </>
            )}
          </p>
        )}
      </div>
      <div
        role="progressbar"
        aria-label="Form progress"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={filled}
        aria-valuetext={`${filled} of ${total} fields filled`}
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
          label="Show fields"
          value={filter}
          onValueChange={onFilter}
          className="min-w-0 flex-1 [&>*]:flex-1"
          options={[
            { value: 'all', label: 'All' },
            { value: 'required', label: <>Required{required > 0 && <Count n={required} />}</> },
            { value: 'empty', label: <>Empty{emptyCount > 0 && <Count n={emptyCount} />}</> },
          ]}
        />
        <IconButton label="Reset form" icon={<RotateCcw />} size="icon-sm" variant="ghost" disabled={!dirty} onClick={onReset} />
      </div>
      <Button variant="soft" size="sm" className="mt-2 w-full" disabled={!emptyCount} onClick={onNext}>
        {emptyCount ? <CornerDownRight /> : <CircleCheck />}
        {emptyCount ? 'Next empty field' : 'All fields filled'}
      </Button>
    </div>
  )
}
