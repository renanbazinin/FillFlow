import { memo, useEffect } from 'react'
import { visualTextRotation } from '../../lib/pdf/formFields'
import type { PageInfo } from '../../model/types'
import { useEditor } from '../../store/editor'
import { ensureFormFonts } from './measure'
import { DropdownControl, ListboxControl } from './onpage/ChoiceControls'
import { SignatureControl } from './onpage/SignatureControl'
import { TextControl } from './onpage/TextControl'
import { CheckboxControl, RadioControl } from './onpage/ToggleControls'
import type { ControlProps } from './onpage/types'
import { widgetsOnPage } from './pageWidgets'
import { useNativeHistoryGuard } from './useField'

const FieldControl = memo(function FieldControl(props: ControlProps) {
  switch (props.field.type) {
    case 'text':
      return <TextControl {...props} />
    case 'checkbox':
      return <CheckboxControl {...props} />
    case 'radio':
      return <RadioControl {...props} />
    case 'dropdown':
      return <DropdownControl {...props} />
    case 'listbox':
      return <ListboxControl {...props} />
    case 'signature':
      return <SignatureControl {...props} />
    default:
      return null
  }
})

/**
 * Absolutely positioned over one page (inset-0, below the element layer). Renders an
 * interactive control for every AcroForm widget on the page, bound to `formValues`.
 * Controls are inert unless the Select tool is active; DOM order is reading order, so Tab
 * walks the form top-to-bottom, left-to-right.
 */
export const FormFieldLayer = memo(function FormFieldLayer({ page, scale }: { page: PageInfo; scale: number }) {
  const fields = useEditor((s) => s.doc?.formFields)
  const interactive = useEditor((s) => s.tool === 'select')
  const items = widgetsOnPage(fields, page.index)
  useNativeHistoryGuard(items.length > 0)

  useEffect(() => {
    if (items.length) ensureFormFonts()
  }, [items.length])

  if (!items.length) return null
  return (
    <div className="pointer-events-none absolute inset-0 overflow-clip" data-form-layer={page.index}>
      {items.map(({ field, widget }) => (
        <FieldControl
          key={widget.id}
          field={field}
          widget={widget}
          scale={scale}
          interactive={interactive}
          rotation={visualTextRotation(widget, page.rotation)}
        />
      ))}
    </div>
  )
})
