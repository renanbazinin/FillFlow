import { memo, type CSSProperties } from 'react'
import { cn } from '../../../lib/utils/misc'
import { cssFontFamily } from '../../../model/fonts'
import { fieldBoxClass, frameRect, frameStyle, rectStyle } from '../fieldStyles'
import { LINE_HEIGHT, inputScale, textLook } from '../look'
import { useFormFontsReady } from '../measure'
import { CONTROL_ATTR } from '../navigation'
import { setFieldValue, useControlEvents, useFieldLabel, useFieldValue, useIsActiveField } from '../useField'
import type { ControlProps } from './types'

/** Single-line, multi-line, comb and password text fields, laid out exactly like the export. */
export const TextControl = memo(function TextControl({ field, widget, scale, interactive, rotation }: ControlProps) {
  const value = String(useFieldValue(field))
  const name = useFieldLabel(field)
  const active = useIsActiveField(field.name)
  useFormFontsReady() // re-measure once the field font has loaded
  const events = useControlEvents(field, { enterAdvances: !field.multiline })
  const frame = frameRect(widget.rect, rotation)
  const look = textLook(field, frame, value)

  const width = frame.width * scale
  const height = frame.height * scale
  const fontPx = look.fontSize * scale
  const k = inputScale(fontPx)
  const multiline = !!field.multiline && !field.password
  const comb = look.comb
  const readOnly = field.readOnly

  const style: CSSProperties = {
    position: 'absolute',
    left: 0,
    top: 0,
    width: (comb ? width + comb.cell * scale : width) * k,
    height: height * k,
    transform: k !== 1 ? `scale(${1 / k})` : undefined,
    transformOrigin: '0 0',
    margin: 0,
    border: 0,
    borderRadius: 0,
    outline: 'none',
    background: 'transparent',
    color: look.color,
    fontFamily: cssFontFamily(comb ? 'mono' : 'sans'),
    fontSize: fontPx * k,
    fontWeight: 400,
    fontKerning: 'none',
    fontVariantLigatures: 'none',
    lineHeight: multiline ? LINE_HEIGHT : 'normal',
    letterSpacing: comb ? comb.letterSpacing * scale * k : undefined,
    paddingTop: multiline ? look.padding * scale * k : 0,
    paddingBottom: multiline ? look.padding * scale * k : 0,
    paddingLeft: (comb ? comb.inset : look.padding) * scale * k,
    paddingRight: comb ? 0 : look.padding * scale * k,
    textAlign: comb ? 'left' : field.textAlign === 'center' ? 'center' : field.textAlign === 'right' ? 'right' : 'start',
    resize: 'none',
    overflow: 'hidden',
    cursor: readOnly ? 'default' : undefined,
  }

  const common = {
    [CONTROL_ATTR]: '',
    'aria-label': name,
    'aria-required': field.required || undefined,
    readOnly,
    tabIndex: interactive && !readOnly ? 0 : -1,
    value,
    maxLength: field.maxLength,
    dir: comb ? 'ltr' : 'auto',
    autoComplete: field.password ? 'new-password' : 'off',
    autoCorrect: 'off',
    spellCheck: multiline,
    style,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setFieldValue(field.name, e.target.value),
    ...events,
  }

  // Faint cell dividers so comb fields read as "one character per box".
  const cells: CSSProperties | undefined = comb
    ? {
        backgroundImage: `repeating-linear-gradient(to right, transparent 0 ${comb.cell * scale - 1}px, rgb(37 99 235 / 0.16) ${comb.cell * scale - 1}px ${comb.cell * scale}px)`,
      }
    : undefined

  return (
    <div
      data-form-field={field.name}
      data-form-widget={widget.id}
      className={cn(
        fieldBoxClass({ interactive, active, filled: value.trim() !== '', required: field.required, readOnly }),
        'overflow-clip',
        !interactive && 'pointer-events-none',
        readOnly && interactive && 'pointer-events-auto',
      )}
      style={rectStyle(widget.rect, scale)}
    >
      <div className="overflow-clip" style={{ ...frameStyle(widget.rect, scale, rotation), ...cells }}>
        {multiline ? (
          <textarea {...common} />
        ) : (
          <input {...common} type={field.password ? 'password' : 'text'} enterKeyHint="next" />
        )}
      </div>
    </div>
  )
})
