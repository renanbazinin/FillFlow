import { memo } from 'react'
import { fieldLabel, radioOptions } from '../../../lib/pdf/forms/labels'
import { cn } from '../../../lib/utils/misc'
import { MARK_PATHS, MARK_VIEWBOX } from '../../../model/elements'
import { fieldBoxClass, rectStyle } from '../fieldStyles'
import { CONTROL_ATTR, findControl } from '../navigation'
import { setFieldValue, useControlEvents, useFieldValue, useIsActiveField } from '../useField'
import type { ControlProps } from './types'

/** Tiny boxes are hard to hit with a finger: grow the hit area (not the visuals) on touch screens. */
const TOUCH_TARGET = "pointer-coarse:before:absolute pointer-coarse:before:-inset-[7px] pointer-coarse:before:content-['']"

/** Space / Enter activate the button; keep them away from global shortcuts (e.g. Space-to-pan). */
function stopActivationKeys(e: React.KeyboardEvent) {
  if (e.key === ' ' || e.key === 'Enter') e.stopPropagation()
}

export const CheckboxControl = memo(function CheckboxControl({ field, widget, scale, interactive }: ControlProps) {
  const checked = useFieldValue(field) === true
  const active = useIsActiveField(field.name)
  const events = useControlEvents(field)
  const readOnly = field.readOnly
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={fieldLabel(field)}
      aria-readonly={readOnly || undefined}
      aria-required={field.required || undefined}
      {...{ [CONTROL_ATTR]: '' }}
      data-form-field={field.name}
      data-form-widget={widget.id}
      tabIndex={interactive && !readOnly ? 0 : -1}
      className={cn(
        fieldBoxClass({ interactive, active, filled: checked, required: field.required, readOnly }, 'visible'),
        'flex items-center justify-center rounded-[2px] p-0',
        TOUCH_TARGET,
        !interactive && 'pointer-events-none',
        readOnly && 'cursor-default',
      )}
      style={rectStyle(widget.rect, scale)}
      onClick={() => !readOnly && setFieldValue(field.name, !checked)}
      onFocus={events.onFocus}
      onBlur={events.onBlur}
      onKeyDown={(e) => {
        stopActivationKeys(e)
        events.onKeyDown(e)
      }}
    >
      {checked && (
        <svg viewBox={`0 0 ${MARK_VIEWBOX} ${MARK_VIEWBOX}`} className="pointer-events-none size-[86%]" aria-hidden>
          <path d={MARK_PATHS.check} fill="#000" />
        </svg>
      )}
    </button>
  )
})

/** One radio option (a PDF radio group has one widget per option). Roving tabindex per group. */
export const RadioControl = memo(function RadioControl({ field, widget, scale, interactive }: ControlProps) {
  const value = useFieldValue(field)
  const active = useIsActiveField(field.name)
  const events = useControlEvents(field)
  const readOnly = field.readOnly
  const selected = value !== '' && value === widget.exportValue
  const anySelected = field.widgets.some((w) => w.exportValue === value)
  const inTabOrder = selected || (!anySelected && field.widgets[0]?.id === widget.id)

  const move = (step: 1 | -1) => {
    const options = field.widgets
    const i = options.findIndex((w) => w.id === widget.id)
    const next = options[(i + step + options.length) % options.length]
    if (!next) return
    if (!readOnly) setFieldValue(field.name, next.exportValue ?? '')
    findControl(field, next)?.focus({ preventScroll: false })
  }

  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={`${fieldLabel(field)}: ${radioOptions(field).find((o) => o.value === (widget.exportValue ?? ''))?.label}`}
      aria-readonly={readOnly || undefined}
      {...{ [CONTROL_ATTR]: '' }}
      data-form-field={field.name}
      data-form-widget={widget.id}
      tabIndex={interactive && !readOnly && inTabOrder ? 0 : -1}
      className={cn(
        fieldBoxClass({ interactive, active, filled: anySelected, required: field.required, readOnly }, 'visible'),
        'flex items-center justify-center rounded-full p-0',
        TOUCH_TARGET,
        !interactive && 'pointer-events-none',
        readOnly && 'cursor-default',
      )}
      style={rectStyle(widget.rect, scale)}
      onClick={() => !readOnly && setFieldValue(field.name, widget.exportValue ?? '')}
      onFocus={events.onFocus}
      onBlur={events.onBlur}
      onKeyDown={(e) => {
        stopActivationKeys(e)
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
          e.preventDefault()
          e.stopPropagation()
          move(e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1)
          return
        }
        events.onKeyDown(e)
      }}
    >
      {selected && <span className="pointer-events-none block size-[48%] rounded-full bg-black" />}
    </button>
  )
})
