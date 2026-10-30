import { memo } from 'react'
import { Signature } from 'lucide-react'
import { fieldLabel } from '../../../lib/pdf/forms/labels'
import { cn } from '../../../lib/utils/misc'
import { useEditor } from '../../../store/editor'
import { rectStyle } from '../fieldStyles'
import { CONTROL_ATTR } from '../navigation'
import { requestSignatureFor } from '../signatureTarget'
import { widgetSigned } from '../signed'
import { useControlEvents, useIsActiveField } from '../useField'
import type { ControlProps } from './types'

/** A dashed "Sign here" target; once a signature sits inside it, only a hover outline remains. */
export const SignatureControl = memo(function SignatureControl({ field, widget, scale, interactive }: ControlProps) {
  const signed = useEditor((s) => widgetSigned(s.elements, widget))
  const active = useIsActiveField(field.name)
  const events = useControlEvents(field)
  const w = widget.rect.width * scale
  const h = widget.rect.height * scale
  const icon = Math.max(10, Math.min(h * 0.5, 20))
  const text = Math.max(9, Math.min(h * 0.32, 13))
  const showText = w >= icon + text * 5.5 && h >= text * 1.4
  const label = fieldLabel(field)

  return (
    <button
      type="button"
      {...{ [CONTROL_ATTR]: '' }}
      data-form-field={field.name}
      data-form-widget={widget.id}
      aria-label={signed ? `${label}: signed — sign again` : `${label}: sign here`}
      tabIndex={interactive && !field.readOnly ? 0 : -1}
      disabled={field.readOnly}
      className={cn(
        'absolute flex items-center justify-center gap-[0.4em] overflow-hidden whitespace-nowrap rounded-[3px] border border-dashed p-0 font-sans font-semibold leading-none transition-[background-color,border-color] duration-100 [color-scheme:light]',
        'outline-0 outline-offset-1 outline-selection focus-visible:outline-2',
        signed
          ? 'border-transparent bg-transparent hover:border-selection/40'
          : 'border-selection/55 bg-selection/[0.06] text-selection hover:border-selection/80 hover:bg-selection/[0.11]',
        active && !signed && 'border-selection/80 bg-selection/[0.11] outline-2',
        interactive ? 'pointer-events-auto' : 'pointer-events-none',
      )}
      style={{ ...rectStyle(widget.rect, scale), fontSize: text }}
      onClick={() => requestSignatureFor(widget.page, widget.rect)}
      onFocus={events.onFocus}
      onBlur={events.onBlur}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') e.stopPropagation()
        events.onKeyDown(e)
      }}
    >
      {!signed && (
        <>
          <Signature aria-hidden strokeWidth={2.25} style={{ width: icon, height: icon }} className="shrink-0" />
          {showText && <span>Sign here</span>}
        </>
      )}
    </button>
  )
})
