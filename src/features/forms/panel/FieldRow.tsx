import { memo, useEffect, useRef } from 'react'
import { cn } from '../../../lib/utils/misc'
import { scrollBehavior } from '../../../lib/utils/motion'
import type { FormField } from '../../../model/types'
import { useEditor } from '../../../store/editor'
import { revealField } from '../navigation'
import { routeHistoryKeys, useIsActiveField } from '../useField'
import { FieldInput } from './FieldInput'

/**
 * One field in the panel. Focusing anything inside makes it the active field and scrolls the
 * page to it; when a field becomes active from the page, the row scrolls into view. ⌘/Ctrl+Z/Y
 * in any of its controls undo and redo like on the page.
 */
export const FieldRow = memo(function FieldRow({ field }: { field: FormField }) {
  const active = useIsActiveField(field.name)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (active && el && !el.contains(document.activeElement)) el.scrollIntoView({ block: 'nearest', behavior: scrollBehavior() })
  }, [active])

  return (
    <div
      ref={ref}
      data-panel-field={field.name}
      className={cn(
        'relative rounded-xl px-3 py-2.5 transition-colors duration-150',
        active ? 'bg-accent-soft' : 'hover:bg-surface-2',
      )}
      onFocusCapture={() => {
        if (useEditor.getState().activeFieldName !== field.name) revealField(field)
      }}
      onBlurCapture={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
        const s = useEditor.getState()
        if (s.activeFieldName === field.name) s.setActiveField(null)
      }}
      onKeyDown={routeHistoryKeys}
    >
      {active && <span aria-hidden className="absolute inset-y-2.5 left-0 w-[3px] rounded-full bg-accent forced-colors:bg-[Highlight]" />}
      <FieldInput field={field} />
    </div>
  )
})
