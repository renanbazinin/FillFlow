import { useEffect, useId, useRef, type CSSProperties, type MouseEvent, type ReactNode } from 'react'
import { Checkbox, RadioGroup } from 'radix-ui'
import { Check, X } from 'lucide-react'
import { Segmented } from '../../components/ui/controls'
import { Tooltip } from '../../components/ui/tooltip'
import { useLocale, useT, type Locale, type Messages } from '../../i18n'
import type { SavedSignature } from '../../lib/storage/db'
import { cn } from '../../lib/utils/misc'
import { SIGNATURE_INKS } from './draft'
import { PEN_WIDTHS, type PenWidth } from './strokes'

/** The inks' names: the palette's own (black, blue, red). */
const INK_NAMES: Record<string, keyof Messages['shell']['ui']['colors']> = {
  [SIGNATURE_INKS[0]]: 'black',
  [SIGNATURE_INKS[1]]: 'blue',
  [SIGNATURE_INKS[2]]: 'red',
}

/** Ink color radio group (black / blue / red). Arrow keys follow the row as it reads. */
export function InkSwatches({ value, onChange, className }: { value: string; onChange: (color: string) => void; className?: string }) {
  const t = useT()
  return (
    <RadioGroup.Root
      value={value}
      onValueChange={onChange}
      orientation="horizontal"
      aria-label={t.signature.inkColor}
      className={cn('flex items-center gap-1.5 pointer-coarse:gap-0', className)}
    >
      {SIGNATURE_INKS.map((c) => (
        <Tooltip key={c} content={t.shell.ui.colors[INK_NAMES[c]]} side="top">
          <RadioGroup.Item
            value={c}
            aria-label={t.shell.ui.colors[INK_NAMES[c]]}
            className="group inline-flex size-7 items-center justify-center rounded-full transition-transform active:scale-90 pointer-coarse:size-10"
          >
            {/* Forced colors mode (Windows Contrast themes) would fill it with the page color: it keeps
                its ink, with an edge, and the chosen one is ringed in the highlight color. */}
            <span
              className="inline-flex size-[22px] items-center justify-center rounded-full border border-black/10 ring-offset-2 ring-offset-surface transition-shadow group-aria-checked:ring-2 group-aria-checked:ring-accent forced-color-adjust-none dark:border-white/30 forced-colors:border-[CanvasText] forced-colors:ring-offset-[Canvas] forced-colors:group-aria-checked:ring-[Highlight]"
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

const PEN_DOTS: Record<PenWidth, number> = { fine: 4, medium: 6.5, bold: 9.5 }

export function PenWidthPicker({ value, onChange }: { value: PenWidth; onChange: (pen: PenWidth) => void }) {
  const t = useT()
  return (
    <Segmented
      size="sm"
      label={t.signature.pen.label}
      value={value}
      onValueChange={onChange}
      options={PEN_WIDTHS.map((w) => ({
        value: w,
        ariaLabel: t.signature.pen[w],
        // The option's text color. Forced colors mode would fill it with the page color: there it takes
        // the system's button text color (the chosen option's highlight text color, from index.css).
        label: (
          <span
            className="rounded-full bg-current forced-color-adjust-none forced-colors:text-[ButtonText]"
            style={{ width: PEN_DOTS[w], height: PEN_DOTS[w] }}
          />
        ),
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
  const t = useT()
  return (
    // Touch screens: the box and its label are 40px tall targets, without taking more room (the
    // box's grows from inside its 1px border).
    <div className={cn('flex items-center gap-2', className)}>
      <Checkbox.Root
        id={id}
        checked={checked}
        onCheckedChange={(v) => onCheckedChange(v === true)}
        className="relative inline-flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border border-control bg-surface shadow-xs transition-colors hover:border-fg-subtle data-[state=checked]:border-accent data-[state=checked]:bg-accent forced-colors:data-[state=checked]:border-[Highlight] forced-colors:data-[state=checked]:bg-[Highlight] pointer-coarse:before:absolute pointer-coarse:before:-inset-[12px] pointer-coarse:before:content-['']"
      >
        <Checkbox.Indicator className="animate-scale-in">
          <Check className="size-3 text-accent-fg forced-colors:text-[HighlightText]" strokeWidth={3.25} />
        </Checkbox.Indicator>
      </Checkbox.Root>
      <label htmlFor={id} className="select-none text-[13px] font-medium text-fg-muted pointer-coarse:-my-2.5 pointer-coarse:py-2.5">
        {t.signature.saveForNextTime}
      </label>
    </div>
  )
}

/** The day it was saved, the interface language's way ("Mar 5, 2026", "5 במרץ 2026"). */
const savedDate = (ts: number, locale: Locale) => new Date(ts).toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' })

/**
 * A saved signature on a white "paper" tile; click to use, × to delete. On touch screens the × is a
 * 40px target (grown from inside its 1px border), all of it in the tile's corner: nothing around the
 * tile can cut it off. The × sits in the corner at the end (top right, or top left in a right-to-left
 * interface).
 */
export function SavedTile({
  item,
  onUse,
  onDelete,
  className,
}: {
  item: SavedSignature
  onUse: (e: MouseEvent<HTMLButtonElement>) => void
  onDelete?: () => void
  className?: string
}) {
  const t = useT()
  const locale = useLocale()
  const date = savedDate(item.createdAt, locale)
  return (
    <div data-saved-tile className={cn('group/tile relative', className)}>
      {/* White paper in every theme, forced colors mode included (a dark page color would hide dark ink). */}
      <button
        type="button"
        onClick={onUse}
        aria-label={t.signature.saved.place[item.role](date)}
        className="flex size-full items-center justify-center overflow-hidden rounded-lg border border-line bg-white px-3 py-2 shadow-xs transition-[border-color,box-shadow,transform] duration-150 forced-color-adjust-none hover:border-accent/70 hover:shadow-float active:scale-[0.98]"
      >
        <img src={item.asset.dataUrl} alt="" draggable={false} className="pointer-events-none max-h-full max-w-full select-none object-contain" />
      </button>
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          aria-label={t.signature.saved.remove[item.role](date)}
          // On touch screens the target grows 5px out of the corner and 13px into the tile.
          className="absolute end-1 top-1 inline-flex size-6 items-center justify-center rounded-full border border-line bg-surface text-fg-muted opacity-0 shadow-xs transition-[opacity,color,border-color] duration-150 hover:border-danger/40 hover:text-danger focus-visible:opacity-100 group-hover/tile:opacity-100 group-focus-within/tile:opacity-100 [@media(hover:none)]:opacity-100 pointer-coarse:before:absolute pointer-coarse:before:-top-[5px] pointer-coarse:before:-end-[5px] pointer-coarse:before:-bottom-[13px] pointer-coarse:before:-start-[13px] pointer-coarse:before:content-['']"
        >
          <X className="size-3.5" strokeWidth={2.25} />
        </button>
      )}
    </div>
  )
}
