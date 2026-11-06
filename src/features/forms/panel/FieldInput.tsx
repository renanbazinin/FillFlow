import { useId, useLayoutEffect, useRef, type ReactNode } from 'react'
import { Checkbox, RadioGroup } from 'radix-ui'
import { Check, ChevronDown, CircleCheck, Lock, Signature } from 'lucide-react'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/controls'
import { useDir, useT, type Direction } from '../../../i18n'
import { fieldLabel } from '../../../lib/pdf/forms/labels'
import { firstStrongDirection } from '../../../lib/text/direction'
import { cn } from '../../../lib/utils/misc'
import type { FormField } from '../../../model/types'
import { useEditor } from '../../../store/editor'
import { primaryWidget, revealField } from '../navigation'
import { requestSignatureFor } from '../signatureTarget'
import { setFieldValue, useComboText, useFieldLabel, useFieldSigned, useFieldValue, useRadioOptions } from '../useField'

/** Like Input: the ring shows focus, and forced colors mode (which drops rings) an outline. */
const FIELD =
  'w-full rounded-lg border border-control bg-surface text-sm text-fg shadow-xs transition-[border-color,box-shadow] placeholder:text-fg-subtle hover:border-fg-subtle focus:border-accent focus:ring-3 focus:ring-accent/20 focus:outline-hidden disabled:opacity-60'

/** A read-only field: muted, with no hover emphasis. Set by prop: every <select> matches `:read-only`. */
const LOCKED = 'bg-surface-2 text-fg-muted hover:border-control'

/**
 * Which way a box of people's text reads: the way its text does, and with no letter in it yet (empty,
 * or digits only) the interface's way, so the caret and placeholder start on the interface's side.
 */
function textDir(text: string, ui: Direction): Direction {
  return firstStrongDirection(text) ?? ui
}

/**
 * A field's label: the PDF's words, in their own direction (`labelId` lets a group of choices be named
 * by them), then the required star and the read-only lock.
 */
function Label({ htmlFor, labelId, field, aside }: { htmlFor?: string; labelId?: string; field: FormField; aside?: ReactNode }) {
  const t = useT()
  const Tag = htmlFor ? 'label' : 'div'
  return (
    <div className="mb-1.5 flex min-w-0 items-baseline gap-2">
      <Tag htmlFor={htmlFor} className="min-w-0 flex-1 text-[12.5px] font-medium leading-snug text-fg-muted">
        <bdi id={labelId} className="break-words [overflow-wrap:anywhere]">
          {fieldLabel(field)}
        </bdi>
        {field.required && (
          <span className="ms-0.5 text-danger" aria-hidden>
            *
          </span>
        )}
        {field.readOnly && (
          <>
            <Lock aria-hidden className="ms-1 inline size-3 -translate-y-px text-fg-subtle" />
            <span className="sr-only"> {t.forms.panel.readOnly}</span>
          </>
        )}
      </Tag>
      {aside}
    </div>
  )
}

function AutoTextarea(props: React.ComponentProps<'textarea'>) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight + 2, 200)}px`
  }, [props.value])
  return (
    <textarea
      ref={ref}
      rows={2}
      {...props}
      className={cn(FIELD, 'block min-h-[60px] resize-none px-3 py-2 leading-relaxed scrollbar-thin', props.readOnly && LOCKED, props.className)}
    />
  )
}

function TextInput({ field }: { field: FormField }) {
  const id = useId()
  const value = String(useFieldValue(field))
  const ui = useDir()
  const counter =
    field.maxLength && !field.readOnly ? (
      <span className={cn('shrink-0 text-[11px] tabular-nums text-fg-subtle', value.length >= field.maxLength && 'text-warning')}>
        {value.length}/{field.maxLength}
      </span>
    ) : null
  const common = {
    id,
    value,
    dir: textDir(value, ui),
    readOnly: field.readOnly,
    maxLength: field.maxLength,
    'aria-required': field.required || undefined,
    autoComplete: field.password ? 'new-password' : 'off',
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setFieldValue(field.name, e.target.value),
  }
  return (
    <>
      <Label htmlFor={id} field={field} aside={counter} />
      {field.multiline && !field.password ? (
        <AutoTextarea {...common} />
      ) : (
        <Input
          {...common}
          type={field.password ? 'password' : 'text'}
          className={cn(field.readOnly && LOCKED, field.comb && 'font-mono tracking-[0.2em]')}
        />
      )}
    </>
  )
}

function CheckboxInput({ field }: { field: FormField }) {
  const id = useId()
  const checked = useFieldValue(field) === true
  const label = useFieldLabel(field)
  return (
    <div className="flex items-start gap-2.5 py-0.5">
      <Checkbox.Root
        id={id}
        checked={checked}
        disabled={field.readOnly}
        aria-required={field.required || undefined}
        onCheckedChange={(c) => setFieldValue(field.name, c === true)}
        className="mt-px flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border border-control bg-surface shadow-xs transition-colors hover:border-fg-subtle disabled:opacity-60 data-[state=checked]:border-accent data-[state=checked]:bg-accent forced-colors:data-[state=checked]:border-[Highlight] forced-colors:data-[state=checked]:bg-[Highlight]"
      >
        <Checkbox.Indicator>
          <Check className="size-3.5 text-accent-fg forced-colors:text-[HighlightText]" strokeWidth={3} />
        </Checkbox.Indicator>
      </Checkbox.Root>
      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer select-none text-[13px] leading-[18px] text-fg">
        <bdi className="[overflow-wrap:anywhere]">{label}</bdi>
        {field.required && <span className="ms-0.5 text-danger">*</span>}
      </label>
    </div>
  )
}

/**
 * An option chip. Forced colors mode (Windows contrast themes) drops its fill: a chosen one is drawn
 * in the system highlight colors, which its circle, dot and check follow.
 */
const CHIP =
  'inline-flex min-h-8 max-w-full items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-1 text-start text-[13px] text-fg shadow-xs transition-colors hover:border-line-strong disabled:opacity-60 data-[state=checked]:border-accent data-[state=checked]:bg-accent-soft data-[state=checked]:text-accent-ink forced-colors:focus-visible:outline-[Highlight] forced-colors:data-[state=checked]:system-highlight forced-colors:data-[state=checked]:border-[Highlight]'

/** The radio circle of a chip (with `group` on the chip) and its dot. */
const CHIP_RADIO =
  'flex size-3.5 shrink-0 items-center justify-center rounded-full border border-control bg-surface group-data-[state=checked]:border-accent forced-colors:group-data-[state=checked]:border-[HighlightText] forced-colors:group-data-[state=checked]:bg-transparent'
const CHIP_DOT = 'size-1.5 rounded-full bg-accent forced-colors:bg-[HighlightText]'

function RadioInput({ field }: { field: FormField }) {
  const labelId = useId()
  const value = String(useFieldValue(field))
  const options = useRadioOptions(field)
  return (
    <>
      <Label field={field} labelId={labelId} />
      <RadioGroup.Root
        value={value}
        onValueChange={(v) => setFieldValue(field.name, v)}
        disabled={field.readOnly}
        aria-labelledby={labelId}
        aria-required={field.required || undefined}
        className="flex flex-wrap gap-1.5"
      >
        {options.map((o) => (
          <RadioGroup.Item key={o.value} value={o.value} className={cn(CHIP, 'group')}>
            <span className={CHIP_RADIO}>
              <RadioGroup.Indicator className={CHIP_DOT} />
            </span>
            <span className="truncate" dir="auto">
              {o.label}
            </span>
          </RadioGroup.Item>
        ))}
      </RadioGroup.Root>
    </>
  )
}

function DropdownInput({ field }: { field: FormField }) {
  const id = useId()
  const listId = useId()
  const t = useT()
  const ui = useDir()
  const value = String(useFieldValue(field))
  const combo = useComboText(field, value)
  const options = field.options ?? []
  const custom = value !== '' && !options.some((o) => o.value === value)
  if (field.editable) {
    return (
      <>
        <Label htmlFor={id} field={field} />
        <Input
          id={id}
          list={listId}
          dir={textDir(combo.text, ui)}
          value={combo.text}
          readOnly={field.readOnly}
          placeholder={t.forms.panel.chooseOrType}
          autoComplete="off"
          className={field.readOnly ? LOCKED : undefined}
          onChange={(e) => combo.change(e.target.value)}
          onBlur={combo.endEdit}
        />
        <datalist id={listId}>
          {options.map((o, i) => (
            <option key={i} value={o.label} />
          ))}
        </datalist>
      </>
    )
  }
  return (
    <>
      <Label htmlFor={id} field={field} />
      <div className="relative">
        {/* The box reads the interface's way, so its text keeps clear of the arrow at its end; the
            choices are the PDF's words. */}
        <select
          id={id}
          dir={ui}
          value={value}
          disabled={field.readOnly}
          aria-required={field.required || undefined}
          onChange={(e) => setFieldValue(field.name, e.target.value)}
          className={cn(FIELD, 'h-9 cursor-pointer appearance-none ps-3 pe-9', value === '' && 'text-fg-subtle', field.readOnly && LOCKED)}
        >
          <option value="">{t.forms.panel.select}</option>
          {custom && <option value={value}>{value}</option>}
          {options.map((o, i) => (
            <option key={i} value={o.value} className="text-fg">
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown aria-hidden className="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" />
      </div>
    </>
  )
}

function ListboxInput({ field }: { field: FormField }) {
  const labelId = useId()
  const t = useT()
  const raw = useFieldValue(field)
  const value = Array.isArray(raw) ? raw : []
  const options = field.options ?? []
  if (!field.multiSelect) {
    return (
      <>
        <Label field={field} labelId={labelId} />
        <RadioGroup.Root
          value={value[0] ?? ''}
          onValueChange={(v) => setFieldValue(field.name, [v])}
          disabled={field.readOnly}
          aria-labelledby={labelId}
          className="flex flex-wrap gap-1.5"
        >
          {options.map((o, i) => (
            <RadioGroup.Item key={i} value={o.value} className={cn(CHIP, 'group')}>
              <span className={CHIP_RADIO}>
                <RadioGroup.Indicator className={CHIP_DOT} />
              </span>
              <span className="truncate" dir="auto">
                {o.label}
              </span>
            </RadioGroup.Item>
          ))}
        </RadioGroup.Root>
      </>
    )
  }
  return (
    <>
      <Label field={field} labelId={labelId} aside={<span className="shrink-0 text-[11px] text-fg-subtle">{t.forms.panel.pickAny}</span>} />
      <div role="group" aria-labelledby={labelId} className="flex flex-wrap gap-1.5">
        {options.map((o, i) => {
          const on = value.includes(o.value)
          return (
            <Checkbox.Root
              key={i}
              checked={on}
              disabled={field.readOnly}
              onCheckedChange={(c) => setFieldValue(field.name, c === true ? [...value, o.value] : value.filter((v) => v !== o.value))}
              className={CHIP}
            >
              <span
                className={cn(
                  'flex size-3.5 shrink-0 items-center justify-center rounded-[4px] border',
                  on ? 'border-accent bg-accent forced-colors:border-[HighlightText] forced-colors:bg-transparent' : 'border-control bg-surface',
                )}
              >
                <Checkbox.Indicator>
                  <Check className="size-2.5 text-accent-fg forced-colors:text-[HighlightText]" strokeWidth={3.5} />
                </Checkbox.Indicator>
              </span>
              <span className="truncate" dir="auto">
                {o.label}
              </span>
            </Checkbox.Root>
          )
        })}
      </div>
    </>
  )
}

function SignatureInput({ field }: { field: FormField }) {
  const signed = useFieldSigned(field)
  const t = useT()
  const m = t.forms.panel
  return (
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] font-medium leading-snug text-fg-muted [overflow-wrap:anywhere]">
          <bdi>{fieldLabel(field)}</bdi>
          {field.required && <span className="ms-0.5 text-danger">*</span>}
        </div>
        <div className={cn('mt-0.5 flex items-center gap-1 text-xs', signed ? 'text-success' : 'text-fg-subtle')}>
          {signed && <CircleCheck className="size-3.5" />}
          {signed ? m.signed : m.notSigned}
        </div>
      </div>
      <Button
        size="sm"
        variant={signed ? 'secondary' : 'primary'}
        disabled={field.readOnly}
        onClick={(e) => {
          const widget = primaryWidget(field)
          if (!widget) return
          revealField(field)
          // In the small-screen sheet, get out of the way so the signature lands in view.
          if (e.currentTarget.closest('[role="dialog"]')) useEditor.getState().setRightPanelOpen(false)
          requestSignatureFor(widget.page, widget.rect)
        }}
      >
        <Signature />
        {signed ? m.signAgain : m.sign}
      </Button>
    </div>
  )
}

/** The label + inline control for one field in the form panel, bound to the same value as the page. */
export function FieldInput({ field }: { field: FormField }) {
  switch (field.type) {
    case 'text':
      return <TextInput field={field} />
    case 'checkbox':
      return <CheckboxInput field={field} />
    case 'radio':
      return <RadioInput field={field} />
    case 'dropdown':
      return <DropdownInput field={field} />
    case 'listbox':
      return <ListboxInput field={field} />
    case 'signature':
      return <SignatureInput field={field} />
    default:
      return null
  }
}
