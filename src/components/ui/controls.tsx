import { useId, type ComponentProps, type ReactNode } from 'react'
import { Slider as RSlider, Switch as RSwitch, ToggleGroup, Separator as RSeparator } from 'radix-ui'
import { Check, Minus, Plus } from 'lucide-react'
import { clamp, cn } from '../../lib/utils/misc'

export function Kbd({ className, ...props }: ComponentProps<'kbd'>) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded border border-line-strong bg-surface-2 px-1 font-sans text-[11px] font-medium text-fg-muted',
        className,
      )}
      {...props}
    />
  )
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn('size-4 animate-spin', className)} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

export function Separator({ orientation = 'horizontal', className }: { orientation?: 'horizontal' | 'vertical'; className?: string }) {
  return (
    <RSeparator.Root
      orientation={orientation}
      className={cn('shrink-0 bg-line', orientation === 'horizontal' ? 'h-px w-full' : 'h-5 w-px', className)}
    />
  )
}

export interface SwitchProps {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  label?: ReactNode
  description?: ReactNode
  disabled?: boolean
  className?: string
}

export function Switch({ checked, onCheckedChange, label, description, disabled, className }: SwitchProps) {
  const id = useId()
  return (
    <div className={cn('flex items-start justify-between gap-4', className)}>
      {(label || description) && (
        <label htmlFor={id} className="min-w-0 flex-1 select-none">
          {label && <div className="text-sm font-medium text-fg">{label}</div>}
          {description && <div className="mt-0.5 text-[13px] text-fg-muted">{description}</div>}
        </label>
      )}
      <RSwitch.Root
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        className="relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full bg-line-strong transition-colors data-[state=checked]:bg-accent disabled:opacity-50"
      >
        <RSwitch.Thumb className="block size-4 translate-x-0.5 rounded-full bg-white shadow-xs transition-transform data-[state=checked]:translate-x-[18px]" />
      </RSwitch.Root>
    </div>
  )
}

export interface SliderProps {
  value: number
  onValueChange: (value: number) => void
  /** Fires once when the user releases the thumb. */
  onValueCommit?: (value: number) => void
  min: number
  max: number
  step?: number
  label?: string
  className?: string
}

export function Slider({ value, onValueChange, onValueCommit, min, max, step = 1, label, className }: SliderProps) {
  return (
    <RSlider.Root
      value={[value]}
      onValueChange={(v) => onValueChange(v[0])}
      onValueCommit={(v) => onValueCommit?.(v[0])}
      min={min}
      max={max}
      step={step}
      aria-label={label}
      className={cn('relative flex h-5 w-full touch-none select-none items-center', className)}
    >
      <RSlider.Track className="relative h-1 grow overflow-hidden rounded-full bg-line-strong">
        <RSlider.Range className="absolute h-full bg-accent" />
      </RSlider.Track>
      <RSlider.Thumb className="block size-4 rounded-full border-2 border-accent bg-white shadow-xs focus-visible:outline-2" />
    </RSlider.Root>
  )
}

export interface SegmentedOption<T extends string> {
  value: T
  label: ReactNode
  /** Accessible label when `label` is an icon. */
  ariaLabel?: string
}

/** Single-choice segmented control. */
export function Segmented<T extends string>({
  value,
  onValueChange,
  options,
  size = 'md',
  label,
  className,
}: {
  value: T
  onValueChange: (value: T) => void
  options: SegmentedOption<T>[]
  size?: 'sm' | 'md'
  /** Accessible name of the group ("Text alignment"…). */
  label?: string
  className?: string
}) {
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      aria-label={label}
      onValueChange={(v) => v && onValueChange(v as T)}
      className={cn('inline-flex items-center gap-0.5 rounded-lg bg-surface-3 p-0.5', className)}
    >
      {options.map((o) => (
        <ToggleGroup.Item
          key={o.value}
          value={o.value}
          aria-label={o.ariaLabel}
          className={cn(
            'inline-flex items-center justify-center gap-1.5 rounded-md font-medium text-fg-muted transition-colors hover:text-fg data-[state=on]:bg-surface data-[state=on]:text-fg data-[state=on]:shadow-xs [&_svg]:size-4',
            size === 'sm' ? 'h-7 min-w-7 px-2 text-xs' : 'h-8 min-w-8 px-3 text-[13px]',
          )}
        >
          {o.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  )
}

/** Compact − value + stepper (font size etc.). */
export function NumberStepper({
  value,
  onChange,
  min,
  max,
  step = 1,
  label,
  format = (v) => String(v),
  className,
}: {
  value: number
  onChange: (value: number) => void
  min: number
  max: number
  step?: number
  label: string
  format?: (v: number) => string
  className?: string
}) {
  const set = (v: number) => onChange(clamp(Math.round(v * 100) / 100, min, max))
  return (
    <div className={cn('inline-flex h-8 items-center rounded-lg border border-line bg-surface', className)} role="group" aria-label={label}>
      <button
        type="button"
        aria-label={`Decrease ${label.toLowerCase()}`}
        onClick={() => set(value - step)}
        disabled={value <= min}
        className="inline-flex h-full w-7 items-center justify-center rounded-l-lg text-fg-muted hover:bg-surface-3 hover:text-fg disabled:opacity-40"
      >
        <Minus className="size-3.5" />
      </button>
      <input
        aria-label={label}
        inputMode="decimal"
        value={format(value)}
        onChange={(e) => {
          const n = parseFloat(e.target.value)
          if (!Number.isNaN(n)) set(n)
        }}
        onFocus={(e) => e.currentTarget.select()}
        className="h-full w-9 bg-transparent text-center text-[13px] font-medium tabular-nums text-fg outline-none"
      />
      <button
        type="button"
        aria-label={`Increase ${label.toLowerCase()}`}
        onClick={() => set(value + step)}
        disabled={value >= max}
        className="inline-flex h-full w-7 items-center justify-center rounded-r-lg text-fg-muted hover:bg-surface-3 hover:text-fg disabled:opacity-40"
      >
        <Plus className="size-3.5" />
      </button>
    </div>
  )
}

/** Row of color swatches plus an optional custom color picker. */
export function ColorSwatches({
  value,
  onChange,
  colors,
  allowCustom = true,
  allowNone = false,
  size = 'md',
  label = 'Color',
  className,
}: {
  value: string | null
  onChange: (color: string | null) => void
  colors: readonly string[]
  allowCustom?: boolean
  allowNone?: boolean
  size?: 'sm' | 'md'
  /** Accessible name of the group ("Text color", "Fill"…). */
  label?: string
  className?: string
}) {
  const dim = size === 'sm' ? 'size-5' : 'size-6'
  const isCustom = value !== null && !colors.some((c) => c.toLowerCase() === value.toLowerCase())
  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)} role="radiogroup" aria-label={label}>
      {allowNone && (
        <button
          type="button"
          role="radio"
          aria-checked={value === null}
          aria-label="No color"
          onClick={() => onChange(null)}
          className={cn(
            dim,
            'relative overflow-hidden rounded-full border border-line-strong bg-surface ring-offset-2 ring-offset-surface transition-shadow',
            value === null && 'ring-2 ring-accent',
          )}
        >
          <span className="absolute left-1/2 top-1/2 h-px w-[140%] -translate-x-1/2 -translate-y-1/2 -rotate-45 bg-danger" />
        </button>
      )}
      {colors.map((c) => {
        const selected = value?.toLowerCase() === c.toLowerCase()
        return (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={c}
            onClick={() => onChange(c)}
            className={cn(
              dim,
              'inline-flex items-center justify-center rounded-full border border-black/10 ring-offset-2 ring-offset-surface transition-shadow dark:border-white/15',
              selected && 'ring-2 ring-accent',
            )}
            style={{ background: c }}
          >
            {selected && <Check className={cn('size-3', isLight(c) ? 'text-black/70' : 'text-white')} strokeWidth={3} />}
          </button>
        )
      })}
      {allowCustom && (
        <label
          className={cn(
            dim,
            'relative inline-flex items-center justify-center overflow-hidden rounded-full border border-black/10 ring-offset-2 ring-offset-surface dark:border-white/15',
            isCustom && 'ring-2 ring-accent',
          )}
          style={{ background: isCustom && value ? value : 'conic-gradient(#f43f5e, #f59e0b, #84cc16, #06b6d4, #6366f1, #d946ef, #f43f5e)' }}
          aria-label="Custom color"
        >
          <input
            type="color"
            value={value ?? '#000000'}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 cursor-pointer opacity-0"
          />
        </label>
      )}
    </div>
  )
}

function isLight(hex: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return false
  const n = parseInt(m[1], 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return 0.299 * r + 0.587 * g + 0.114 * b > 186
}

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'h-9 w-full rounded-lg border border-line bg-surface px-3 text-sm text-fg shadow-xs outline-none transition-[border-color,box-shadow] placeholder:text-fg-subtle hover:border-line-strong focus:border-accent focus:ring-3 focus:ring-accent/20 disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

export function FieldLabel({ className, ...props }: ComponentProps<'label'>) {
  return <label className={cn('mb-1.5 block text-[13px] font-medium text-fg-muted', className)} {...props} />
}
