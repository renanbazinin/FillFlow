import { useRef, useState, type ComponentProps, type KeyboardEvent, type ReactNode } from 'react'
import { Blend, Minus, Plus } from 'lucide-react'
import { ColorSwatches, Separator, Slider } from '../../../components/ui/controls'
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '../../../components/ui/menu'
import { Tooltip } from '../../../components/ui/tooltip'
import { useT } from '../../../i18n'
import { INK_COLORS } from '../../../model/elements'
import { clamp, cn } from '../../../lib/utils/misc'
import { keepEditorFocus, preventFocusWhileEditing } from './focus'
import { POPOVER_FIT, useAwayPopover } from './popoverSide'

export function ToolbarSeparator({ className }: { className?: string }) {
  return <Separator orientation="vertical" className={cn('mx-1 h-5', className)} />
}

/** A compact trigger button used by the toolbar popovers (40px on touch, like the toolbar's other buttons). */
export function TriggerButton({ label, children, className, ...props }: { label: string; children: ReactNode; className?: string } & ComponentProps<'button'>) {
  return (
    <button
      type="button"
      aria-label={label}
      className={cn(
        'inline-flex h-8 min-w-8 shrink-0 items-center justify-center gap-1 rounded-lg px-1.5 text-fg-muted transition-colors hover:bg-surface-3 hover:text-fg data-[state=open]:bg-surface-3 data-[state=open]:text-fg pointer-coarse:h-10 pointer-coarse:min-w-10',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}

function Swatch({ value, variant }: { value: string | null; variant: 'fill' | 'stroke' | 'text' }) {
  if (variant === 'text') {
    return (
      <span className="relative flex size-5 flex-col items-center justify-center">
        <span className="text-[14px] font-semibold leading-none text-fg">A</span>
        <span className="mt-0.5 h-[3px] w-4 rounded-full ring-1 ring-black/15 dark:ring-white/40" style={{ background: value ?? 'transparent' }} />
      </span>
    )
  }
  if (value === null) {
    return (
      <span className="relative size-[18px] overflow-hidden rounded-full border border-line-strong bg-surface">
        <span className="absolute left-1/2 top-1/2 h-px w-[140%] -translate-x-1/2 -translate-y-1/2 -rotate-45 bg-danger" />
      </span>
    )
  }
  if (variant === 'stroke') {
    return (
      <span
        className="flex size-[18px] items-center justify-center rounded-full outline outline-1 -outline-offset-1 outline-black/15 dark:outline-white/35"
        style={{ boxShadow: `inset 0 0 0 4px ${value}` }}
      >
        <span className="size-2.5 rounded-full ring-1 ring-black/10 dark:ring-white/30" />
      </span>
    )
  }
  return <span className="size-[18px] rounded-full ring-1 ring-inset ring-black/15 dark:ring-white/35" style={{ background: value }} />
}

/** Swatch button opening a color palette popover. */
export function ColorButton({
  label,
  value,
  onChange,
  allowNone,
  variant = 'fill',
  colors = INK_COLORS,
}: {
  label: string
  value: string | null
  onChange: (color: string | null) => void
  allowNone?: boolean
  variant?: 'fill' | 'stroke' | 'text'
  colors?: readonly string[]
}) {
  const trigger = useRef<HTMLButtonElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const away = useAwayPopover(trigger, content)
  return (
    <Popover {...away.root}>
      <PopoverAnchor virtualRef={away.virtualRef} />
      <Tooltip content={label}>
        <PopoverTrigger asChild>
          <TriggerButton ref={trigger} label={label}>
            <Swatch value={value} variant={variant} />
          </TriggerButton>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent
        ref={content}
        side={away.side}
        // Named as written ("Text color"), not as its caption shows it: browsers read that out in capitals.
        aria-label={label}
        className={cn('w-auto', POPOVER_FIT)}
        onMouseDown={keepEditorFocus}
        onOpenAutoFocus={preventFocusWhileEditing}
        onCloseAutoFocus={preventFocusWhileEditing}
      >
        <div className="mb-2 px-0.5 text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">{label}</div>
        <ColorSwatches value={value} onChange={onChange} colors={colors} allowNone={allowNone} label={label} />
      </PopoverContent>
    </Popover>
  )
}

const fmt = (n: number) => (Math.round(n * 10) / 10).toString()

/**
 * − value + stepper. Unlike a live-parsed field, typing only applies on Enter/blur, so a value
 * can pass through out-of-range digits ("1" → "14") without being clamped mid-way. On touch it
 * grows so its buttons and field get the toolbar's 40px (inside the border). − is at the start, +
 * at the end (mirrored right to left, like the UI kit's NumberStepper).
 */
export function SizeField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  locked = false,
  className,
}: {
  label: string
  value: number
  onChange: (value: number) => void
  min: number
  max: number
  step?: number
  /** Every item it applies to is locked (they keep their size): shown disabled. */
  locked?: boolean
  className?: string
}) {
  const t = useT()
  const [draft, setDraft] = useState<string | null>(null)
  const set = (v: number) => onChange(clamp(Math.round(v * 100) / 100, min, max))
  const commit = () => {
    if (draft === null) return
    const n = parseFloat(draft.replace(',', '.'))
    setDraft(null)
    if (Number.isFinite(n)) set(n)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      commit()
      e.currentTarget.blur()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      setDraft(null)
      e.currentTarget.blur()
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      e.stopPropagation()
      setDraft(null)
      set(value + (e.key === 'ArrowUp' ? step : -step) * (e.shiftKey ? 10 : 1))
    }
  }
  return (
    <div
      className={cn('inline-flex h-8 shrink-0 items-center rounded-lg border border-line bg-surface pointer-coarse:h-[42px]', className)}
      role="group"
      aria-label={label}
      title={locked ? t.elements.toolbar.unlockToChange(label) : undefined}
    >
      <button
        type="button"
        aria-label={t.shell.ui.decrease(label)}
        onClick={() => set(value - step)}
        disabled={locked || value <= min}
        className="inline-flex h-full w-7 items-center justify-center rounded-s-lg text-fg-muted hover:bg-surface-3 hover:text-fg disabled:opacity-40 pointer-coarse:w-10"
      >
        <Minus className="size-3.5" />
      </button>
      <input
        aria-label={label}
        inputMode="decimal"
        value={draft ?? fmt(value)}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={commit}
        onKeyDown={onKeyDown}
        disabled={locked}
        className="h-full w-9 bg-transparent text-center text-[13px] font-medium tabular-nums text-fg outline-none disabled:opacity-40 pointer-coarse:w-10"
      />
      <button
        type="button"
        aria-label={t.shell.ui.increase(label)}
        onClick={() => set(value + step)}
        disabled={locked || value >= max}
        className="inline-flex h-full w-7 items-center justify-center rounded-e-lg text-fg-muted hover:bg-surface-3 hover:text-fg disabled:opacity-40 pointer-coarse:w-10"
      >
        <Plus className="size-3.5" />
      </button>
    </div>
  )
}

/** Labeled slider row used inside toolbar popovers. */
export function SliderRow({
  label,
  value,
  display,
  onChange,
  min,
  max,
  step,
}: {
  label: string
  value: number
  display: string
  onChange: (v: number) => void
  min: number
  max: number
  step: number
}) {
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between text-[13px]">
        <span className="font-medium text-fg-muted">{label}</span>
        {/* A measurement ("2.5 pt", "1.20×") reads left to right in a right-to-left interface too. */}
        <span dir="ltr" className="tabular-nums text-fg">
          {display}
        </span>
      </div>
      <Slider value={value} onValueChange={onChange} min={min} max={max} step={step} label={label} />
    </div>
  )
}

/** Opacity (0–1) behind a "100%" button. */
export function OpacityButton({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const t = useT()
  const m = t.elements.toolbar
  const pct = Math.round(value * 100)
  const trigger = useRef<HTMLButtonElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const away = useAwayPopover(trigger, content)
  return (
    <Popover {...away.root}>
      <PopoverAnchor virtualRef={away.virtualRef} />
      <Tooltip content={m.opacity}>
        <PopoverTrigger asChild>
          <TriggerButton ref={trigger} label={m.opacityValue(pct)} className="px-2 text-[12px] font-medium tabular-nums">
            <Blend className="size-4" />
            {pct}%
          </TriggerButton>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent
        ref={content}
        side={away.side}
        aria-label={m.opacity}
        className={cn('w-56', POPOVER_FIT)}
        onOpenAutoFocus={preventFocusWhileEditing}
        onCloseAutoFocus={preventFocusWhileEditing}
      >
        <SliderRow label={m.opacity} value={pct} display={`${pct}%`} onChange={(v) => onChange(v / 100)} min={5} max={100} step={1} />
      </PopoverContent>
    </Popover>
  )
}
