import { useId, type ComponentProps, type ReactNode } from 'react'
import { Slider as RSlider, Switch as RSwitch, ToggleGroup, Separator as RSeparator } from 'radix-ui'
import { Check, Minus, Plus } from 'lucide-react'
import { useT, type Messages } from '../../i18n'
import { clamp, cn } from '../../lib/utils/misc'

/** A key cap. Keys read left to right in a right-to-left interface too ("⇧⌘Z", "Ctrl+Z"). */
export function Kbd({ className, ...props }: ComponentProps<'kbd'>) {
  return (
    <kbd
      dir="ltr"
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
      className={cn('shrink-0 bg-line forced-colors:bg-[CanvasText]', orientation === 'horizontal' ? 'h-px w-full' : 'h-5 w-px', className)}
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
      {/* The track's edge shows where the switch is (and stays drawn in forced colors mode, which
          drops fills: there the state is drawn in the system highlight colors). On touch screens
          an invisible margin makes it a 40px target. */}
      <RSwitch.Root
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        className="relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-control bg-line-strong transition-colors data-[state=checked]:border-accent data-[state=checked]:bg-accent disabled:opacity-50 forced-colors:data-[state=checked]:border-[Highlight] forced-colors:data-[state=checked]:bg-[Highlight] pointer-coarse:before:absolute pointer-coarse:before:-inset-3 pointer-coarse:before:content-['']"
      >
        {/* Off at the start, on at the end: it moves right, or left in a right-to-left interface. */}
        <RSwitch.Thumb className="ms-px block size-4 rounded-full bg-white shadow-xs transition-[margin-inline-start] data-[state=checked]:ms-[17px] forced-colors:bg-[CanvasText] forced-colors:data-[state=checked]:bg-[HighlightText]" />
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
      // A press anywhere along it moves the thumb there: on touch screens the band is a 40px target.
      className={cn('relative flex h-5 w-full touch-none select-none items-center pointer-coarse:h-10', className)}
    >
      <RSlider.Track className="relative h-1 grow overflow-hidden rounded-full bg-line-strong forced-colors:bg-[CanvasText]">
        <RSlider.Range className="absolute h-full bg-accent forced-colors:bg-[Highlight]" />
      </RSlider.Track>
      {/* The thumb is the slider (role="slider"): the name goes on it. */}
      <RSlider.Thumb aria-label={label} className="block size-4 rounded-full border-2 border-accent bg-white shadow-xs focus-visible:outline-2" />
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
            // Forced colors mode drops the fill and shadow: index.css draws the chosen option
            // (data-state=on) in the system highlight colors.
            'inline-flex items-center justify-center gap-1.5 rounded-md font-medium text-fg-muted transition-colors hover:text-fg data-[state=on]:bg-surface data-[state=on]:text-fg data-[state=on]:shadow-xs [&_svg]:size-4',
            size === 'sm' ? 'h-7 min-w-7 px-2 text-xs' : 'h-8 min-w-8 px-3 text-[13px]',
            'pointer-coarse:h-10 pointer-coarse:min-w-10',
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
  const t = useT()
  const set = (v: number) => onChange(clamp(Math.round(v * 100) / 100, min, max))
  return (
    // Touch screens: the 40px height is inside the border, so the − and + buttons are 40px targets.
    <div
      className={cn('inline-flex h-8 items-center rounded-lg border border-control bg-surface pointer-coarse:box-content pointer-coarse:h-10', className)}
      role="group"
      aria-label={label}
    >
      <button
        type="button"
        aria-label={t.shell.ui.decrease(label)}
        onClick={() => set(value - step)}
        disabled={value <= min}
        className="inline-flex h-full w-7 items-center justify-center rounded-s-lg text-fg-muted hover:bg-surface-3 hover:text-fg disabled:opacity-40 pointer-coarse:w-10"
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
        aria-label={t.shell.ui.increase(label)}
        onClick={() => set(value + step)}
        disabled={value >= max}
        className="inline-flex h-full w-7 items-center justify-center rounded-e-lg text-fg-muted hover:bg-surface-3 hover:text-fg disabled:opacity-40 pointer-coarse:w-10"
      >
        <Plus className="size-3.5" />
      </button>
    </div>
  )
}

/** Plain names of the app's palette colors (model/elements.ts), read out for their swatches. */
const COLOR_NAMES: Record<string, keyof Messages['shell']['ui']['colors']> = {
  '#111827': 'black',
  '#1d4ed8': 'blue',
  '#c81e1e': 'red',
  '#047857': 'green',
  '#7c3aed': 'purple',
  '#ffffff': 'white',
  '#fde047': 'yellow',
}

/** A color's plain name; a color the palette doesn't name (a custom one) by its hex code. */
function colorName(hex: string, t: Messages): string {
  const name = COLOR_NAMES[hex.toLowerCase()]
  return name ? t.shell.ui.colors[name] : hex
}

/**
 * A round swatch (with a 1px border). On touch screens an invisible margin makes it a 40px target;
 * the row's gaps are twice that margin, so neighbouring targets meet without overlapping. Forced
 * colors mode (Windows Contrast themes) would blank it: its color is its content, so it keeps it
 * there, edged in the text color; the chosen one is ringed in the system highlight color.
 */
const SWATCH =
  "relative rounded-full border ring-offset-2 ring-offset-surface transition-shadow forced-color-adjust-none forced-colors:border-[CanvasText] forced-colors:ring-[Highlight] forced-colors:ring-offset-[Canvas] forced-colors:focus-visible:outline-[Highlight] pointer-coarse:before:absolute pointer-coarse:before:content-['']"

// The margin is measured from inside the border.
const SWATCH_SIZES = {
  sm: { swatch: 'size-5 pointer-coarse:before:-inset-[11px]', gap: 'pointer-coarse:gap-5' },
  md: { swatch: 'size-6 pointer-coarse:before:-inset-[9px]', gap: 'pointer-coarse:gap-4' },
}

/** A swatch's edge: ≥ 3:1 against the popover where its own color isn't (white on white, black on dark). */
const swatchEdge = (color: string) => (isLight(color) ? 'border-control dark:border-white/15' : 'border-black/10 dark:border-control')

/** Row of color swatches plus an optional custom color picker. */
export function ColorSwatches({
  value,
  onChange,
  colors,
  allowCustom = true,
  allowNone = false,
  size = 'md',
  label,
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
  const t = useT()
  const dim = SWATCH_SIZES[size]
  const isCustom = value !== null && !colors.some((c) => c.toLowerCase() === value.toLowerCase())
  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', dim.gap, className)} role="radiogroup" aria-label={label ?? t.shell.ui.color}>
      {allowNone && (
        <button
          type="button"
          role="radio"
          aria-checked={value === null}
          aria-label={t.shell.ui.noColor}
          onClick={() => onChange(null)}
          className={cn(dim.swatch, SWATCH, 'border-control bg-surface', value === null && 'ring-2 ring-accent')}
        >
          {/* A slash across the circle, edge to edge. */}
          <span className="absolute left-1/2 top-1/2 h-px w-full -translate-x-1/2 -translate-y-1/2 -rotate-45 bg-danger" />
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
            aria-label={colorName(c, t)}
            onClick={() => onChange(c)}
            className={cn(dim.swatch, SWATCH, 'inline-flex items-center justify-center', swatchEdge(c), selected && 'ring-2 ring-accent')}
            style={{ background: c }}
          >
            {selected && <Check className={cn('size-3', isLight(c) ? 'text-black/70' : 'text-white')} strokeWidth={3} />}
          </button>
        )
      })}
      {allowCustom && (
        <label
          className={cn(
            dim.swatch,
            SWATCH,
            'inline-flex items-center justify-center',
            isCustom && value ? swatchEdge(value) : 'border-black/10 dark:border-white/15',
            isCustom && 'ring-2 ring-accent',
          )}
          style={{ background: isCustom && value ? value : 'conic-gradient(#f43f5e, #f59e0b, #84cc16, #06b6d4, #6366f1, #d946ef, #f43f5e)' }}
          aria-label={t.shell.ui.customColor}
        >
          <input
            type="color"
            value={value ?? '#000000'}
            onChange={(e) => onChange(e.target.value)}
            // size-full: a color input keeps its own (wider) size otherwise.
            className="absolute inset-0 size-full cursor-pointer opacity-0"
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
        // focus:outline-hidden: the ring shows focus, and forced colors mode (which drops rings) an outline.
        'h-9 w-full rounded-lg border border-control bg-surface px-3 text-sm text-fg shadow-xs transition-[border-color,box-shadow] placeholder:text-fg-subtle hover:border-fg-subtle focus:border-accent focus:ring-3 focus:ring-accent/20 focus:outline-hidden disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

export function FieldLabel({ className, ...props }: ComponentProps<'label'>) {
  return <label className={cn('mb-1.5 block text-[13px] font-medium text-fg-muted', className)} {...props} />
}
