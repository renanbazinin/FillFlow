import { useEffect, useId, useRef, type CSSProperties, type ReactNode } from 'react'
import { Checkbox, RadioGroup } from 'radix-ui'
import { Check, X } from 'lucide-react'
import { Segmented } from '../../components/ui/controls'
import { Tooltip } from '../../components/ui/tooltip'
import type { SavedSignature } from '../../lib/storage/db'
import { cn } from '../../lib/utils/misc'
import { SIGNATURE_INKS } from './draft'
import { PEN_WIDTHS, type PenWidth } from './strokes'

const INK_NAMES: Record<string, string> = { [SIGNATURE_INKS[0]]: 'Black', [SIGNATURE_INKS[1]]: 'Blue', [SIGNATURE_INKS[2]]: 'Red' }

/** Ink color radio group (black / blue / red). */
export function InkSwatches({ value, onChange, className }: { value: string; onChange: (color: string) => void; className?: string }) {
  return (
    <RadioGroup.Root
      value={value}
      onValueChange={onChange}
      orientation="horizontal"
      aria-label="Ink color"
      className={cn('flex items-center gap-1.5', className)}
    >
      {SIGNATURE_INKS.map((c) => (
        <Tooltip key={c} content={INK_NAMES[c]} side="top">
          <RadioGroup.Item
            value={c}
            aria-label={INK_NAMES[c]}
            className="group inline-flex size-7 items-center justify-center rounded-full transition-transform active:scale-90"
          >
            <span
              className="inline-flex size-[22px] items-center justify-center rounded-full border border-black/10 ring-offset-2 ring-offset-surface transition-shadow group-aria-checked:ring-2 group-aria-checked:ring-accent dark:border-white/30"
              style={{ background: c }}
            >
              <RadioGroup.Indicator>
                <Check className="size-3 text-white" strokeWidth={3} />
              </RadioGroup.Indicator>
            </span>
          </RadioGroup.Item>
        </Tooltip>
      ))}
    </RadioGroup.Root>
  )
}

const PEN_LABELS: Record<PenWidth, string> = { fine: 'Fine pen', medium: 'Medium pen', bold: 'Bold pen' }
const PEN_DOTS: Record<PenWidth, number> = { fine: 4, medium: 6.5, bold: 9.5 }

export function PenWidthPicker({ value, onChange }: { value: PenWidth; onChange: (pen: PenWidth) => void }) {
  return (
    <Segmented
      size="sm"
      value={value}
      onValueChange={onChange}
      options={PEN_WIDTHS.map((w) => ({
        value: w,
        ariaLabel: PEN_LABELS[w],
        label: <span className="rounded-full bg-current" style={{ width: PEN_DOTS[w], height: PEN_DOTS[w] }} />,
      }))}
    />
  )
}

/**
 * One line of text, scaled down (never up) to fit its box. The scale is applied imperatively
 * from a ResizeObserver, which also catches web fonts swapping in.
 */
export function FitText({
  children,
  className,
  style,
  dir,
}: {
  children: ReactNode
  className?: string
  style?: CSSProperties
  dir?: 'auto' | 'ltr' | 'rtl'
}) {
  const outer = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const o = outer.current
    const i = inner.current
    if (!o || !i) return
    const ro = new ResizeObserver(() => {
      const avail = o.clientWidth
      const need = i.offsetWidth
      i.style.transform = need > avail && need > 0 ? `scale(${avail / need})` : ''
    })
    ro.observe(o)
    ro.observe(i)
    return () => ro.disconnect()
  }, [])
  return (
    <div ref={outer} className={cn('flex min-w-0 items-center justify-center overflow-hidden', className)}>
      <span ref={inner} dir={dir} className="inline-block origin-center whitespace-pre leading-[1.35]" style={style}>
        {children}
      </span>
    </div>
  )
}

export function SaveCheckbox({ checked, onCheckedChange, className }: { checked: boolean; onCheckedChange: (v: boolean) => void; className?: string }) {
  const id = useId()
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Checkbox.Root
        id={id}
        checked={checked}
        onCheckedChange={(v) => onCheckedChange(v === true)}
        className="inline-flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border border-line-strong bg-surface shadow-xs transition-colors data-[state=checked]:border-accent data-[state=checked]:bg-accent"
      >
        <Checkbox.Indicator className="animate-scale-in">
          <Check className="size-3 text-accent-fg" strokeWidth={3.25} />
        </Checkbox.Indicator>
      </Checkbox.Root>
      <label htmlFor={id} className="select-none text-[13px] font-medium text-fg-muted">
        Save for next time
      </label>
    </div>
  )
}

const savedDate = (ts: number) => new Date(ts).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' })

/** A saved signature on a white "paper" tile; click to use, × to delete. */
export function SavedTile({
  item,
  onUse,
  onDelete,
  className,
}: {
  item: SavedSignature
  onUse: () => void
  onDelete?: () => void
  className?: string
}) {
  const noun = item.role === 'signature' ? 'signature' : 'initials'
  return (
    <div data-saved-tile className={cn('group/tile relative', className)}>
      <button
        type="button"
        onClick={onUse}
        aria-label={`Place ${noun} saved ${savedDate(item.createdAt)}`}
        className="flex size-full items-center justify-center overflow-hidden rounded-lg border border-line bg-white px-3 py-2 shadow-xs transition-[border-color,box-shadow,transform] duration-150 hover:border-accent/70 hover:shadow-float active:scale-[0.98]"
      >
        <img src={item.asset.dataUrl} alt="" draggable={false} className="pointer-events-none max-h-full max-w-full select-none object-contain" />
      </button>
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          aria-label={`Delete ${noun} saved ${savedDate(item.createdAt)}`}
          className="absolute right-1 top-1 inline-flex size-6 items-center justify-center rounded-full border border-line bg-surface text-fg-muted opacity-0 shadow-xs transition-[opacity,color,border-color] duration-150 hover:border-danger/40 hover:text-danger focus-visible:opacity-100 group-hover/tile:opacity-100 group-focus-within/tile:opacity-100 [@media(hover:none)]:opacity-100"
        >
          <X className="size-3.5" strokeWidth={2.25} />
        </button>
      )}
    </div>
  )
}
