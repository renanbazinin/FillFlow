import { memo, useId, type CSSProperties } from 'react'
import { ChevronDown } from 'lucide-react'
import { fieldLabel } from '../../../lib/pdf/forms/labels'
import { cn } from '../../../lib/utils/misc'
import { cssFontFamily } from '../../../model/fonts'
import { fieldBoxClass, frameRect, frameStyle, rectStyle } from '../fieldStyles'
import { LINE_HEIGHT, inputScale, textLook } from '../look'
import { useFormFontsReady } from '../measure'
import { CONTROL_ATTR } from '../navigation'
import { setFieldValue, useControlEvents, useFieldValue, useIsActiveField } from '../useField'
import type { ControlProps } from './types'

function baseStyle(fontPx: number, k: number, color: string): CSSProperties {
  return {
    position: 'absolute',
    left: 0,
    top: 0,
    margin: 0,
    border: 0,
    borderRadius: 0,
    outline: 'none',
    background: 'transparent',
    appearance: 'none',
    color,
    fontFamily: cssFontFamily('sans'),
    fontSize: fontPx * k,
    fontKerning: 'none',
    transform: k !== 1 ? `scale(${1 / k})` : undefined,
    transformOrigin: '0 0',
  }
}

/** Combo box: a styled native <select>, or <input list> for combos that accept typed text. */
export const DropdownControl = memo(function DropdownControl({ field, widget, scale, interactive, rotation }: ControlProps) {
  const value = String(useFieldValue(field))
  const active = useIsActiveField(field.name)
  useFormFontsReady()
  const events = useControlEvents(field, { enterAdvances: true })
  const listId = useId()
  const options = field.options ?? []
  const label = options.find((o) => o.value === value)?.label ?? value
  const frame = frameRect(widget.rect, rotation)
  const look = textLook(field, frame, label, { singleLine: true })
  const fontPx = look.fontSize * scale
  const k = inputScale(fontPx)
  const width = frame.width * scale
  const height = frame.height * scale
  const chevron = Math.max(8, Math.min(height * 0.55, 16))
  const readOnly = field.readOnly
  const pad = look.padding * scale * k
  const style: CSSProperties = {
    ...baseStyle(fontPx, k, look.color),
    width: width * k,
    height: height * k,
    paddingTop: 0,
    paddingBottom: 0,
    paddingLeft: pad,
    paddingRight: interactive && !readOnly ? (chevron + 4) * k : pad,
    lineHeight: 'normal',
    cursor: readOnly ? 'default' : 'pointer',
  }
  const common = {
    [CONTROL_ATTR]: '',
    'aria-label': fieldLabel(field),
    'aria-required': field.required || undefined,
    tabIndex: interactive && !readOnly ? 0 : -1,
    dir: 'auto',
    style,
    ...events,
  }
  const needsBlank = !options.some((o) => o.value === '')
  const custom = value !== '' && !options.some((o) => o.value === value)

  return (
    <div
      data-form-field={field.name}
      data-form-widget={widget.id}
      className={cn(
        fieldBoxClass({ interactive, active, filled: value !== '', required: field.required, readOnly }),
        'group overflow-clip',
        !interactive && 'pointer-events-none',
      )}
      style={rectStyle(widget.rect, scale)}
    >
      <div className="overflow-clip" style={frameStyle(widget.rect, scale, rotation)}>
        {field.editable ? (
          <>
            <input
              {...common}
              type="text"
              readOnly={readOnly}
              list={listId}
              autoComplete="off"
              value={label}
              onChange={(e) => {
                const typed = e.target.value
                setFieldValue(field.name, options.find((o) => o.label === typed)?.value ?? typed)
              }}
            />
            <datalist id={listId}>
              {options.map((o, i) => (
                <option key={i} value={o.label} />
              ))}
            </datalist>
          </>
        ) : (
          <select {...common} disabled={readOnly} value={value} onChange={(e) => setFieldValue(field.name, e.target.value)}>
            {needsBlank && <option value="" />}
            {custom && <option value={value}>{value}</option>}
            {options.map((o, i) => (
              <option key={i} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        )}
        {interactive && !readOnly && (
          <ChevronDown
            aria-hidden
            strokeWidth={2.25}
            className="pointer-events-none absolute right-[3px] top-1/2 -translate-y-1/2 text-selection/70 opacity-70 transition-opacity group-hover:opacity-100"
            style={{ width: chevron, height: chevron }}
          />
        )}
      </div>
    </div>
  )
})

/** List box: a native list (multi-select toggles with a plain click, no Ctrl needed). */
export const ListboxControl = memo(function ListboxControl({ field, widget, scale, interactive, rotation }: ControlProps) {
  const raw = useFieldValue(field)
  const value = Array.isArray(raw) ? raw : []
  const active = useIsActiveField(field.name)
  const events = useControlEvents(field)
  const frame = frameRect(widget.rect, rotation)
  const look = textLook(field, frame, '')
  const fontPx = look.fontSize * scale
  const k = inputScale(fontPx)
  const options = field.options ?? []
  const multi = !!field.multiSelect
  const readOnly = field.readOnly
  const style: CSSProperties = {
    ...baseStyle(fontPx, k, look.color),
    width: frame.width * scale * k,
    height: frame.height * scale * k,
    lineHeight: LINE_HEIGHT,
    paddingTop: look.padding * scale * k,
    paddingBottom: look.padding * scale * k,
    paddingLeft: 0,
    paddingRight: 0,
    overflowY: 'auto',
    scrollbarWidth: 'none',
  }
  const toggle = (v: string) => {
    if (readOnly) return
    setFieldValue(field.name, value.includes(v) ? value.filter((x) => x !== v) : [...value, v])
  }

  return (
    <div
      data-form-field={field.name}
      data-form-widget={widget.id}
      className={cn(
        fieldBoxClass({ interactive, active, filled: value.length > 0, required: field.required, readOnly }),
        'overflow-clip',
        !interactive && 'pointer-events-none',
      )}
      style={rectStyle(widget.rect, scale)}
    >
      <div className="overflow-clip" style={frameStyle(widget.rect, scale, rotation)}>
        <select
          {...{ [CONTROL_ATTR]: '' }}
          aria-label={fieldLabel(field)}
          aria-required={field.required || undefined}
          tabIndex={interactive && !readOnly ? 0 : -1}
          multiple={multi}
          size={Math.max(2, options.length)}
          disabled={readOnly}
          dir="auto"
          style={style}
          value={multi ? value : (value[0] ?? '')}
          onChange={(e) => {
            if (multi) setFieldValue(field.name, Array.from(e.target.selectedOptions, (o) => o.value))
            else setFieldValue(field.name, e.target.value ? [e.target.value] : [])
          }}
          {...events}
        >
          {options.map((o, i) => (
            <option
              key={i}
              value={o.value}
              style={{ paddingLeft: look.padding * scale * k, paddingRight: look.padding * scale * k }}
              onMouseDown={
                multi
                  ? (e) => {
                      // Toggle on plain click instead of replacing the selection.
                      e.preventDefault()
                      ;(e.currentTarget.parentElement as HTMLSelectElement | null)?.focus()
                      toggle(o.value)
                    }
                  : undefined
              }
            >
              {o.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
})
