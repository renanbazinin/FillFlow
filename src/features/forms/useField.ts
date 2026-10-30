import { useCallback } from 'react'
import { coerceValue } from '../../lib/pdf/forms/values'
import { isMac } from '../../lib/utils/misc'
import type { FormField, FormValue } from '../../model/types'
import { useEditor } from '../../store/editor'
import { focusAdjacentField } from './navigation'
import { fieldSigned } from './signed'

/** The field's current value, coerced to the shape its type expects. */
export function useFieldValue(field: FormField): FormValue {
  const raw = useEditor((s) => s.formValues[field.name])
  return coerceValue(field, raw === undefined ? field.defaultValue : raw)
}

export function useIsActiveField(name: string): boolean {
  return useEditor((s) => s.activeFieldName === name)
}

/** Writes a value; consecutive edits of the same field collapse into one undo step. */
export function setFieldValue(name: string, value: FormValue): void {
  useEditor.getState().setFormValue(name, value, { coalesce: `field:${name}` })
}

export function useFieldSigned(field: FormField): boolean {
  return useEditor((s) => fieldSigned(s.elements, field))
}

/**
 * Focus bookkeeping and keyboard behaviour shared by every on-page control:
 * focus/blur keep `activeFieldName` in sync, ⌘/Ctrl+Z/Y route to the editor's undo history
 * (instead of the input's private one), Enter (single-line) moves to the next field, and
 * Escape leaves the field.
 */
export function useControlEvents(field: FormField, opts: { enterAdvances?: boolean } = {}) {
  const enterAdvances = opts.enterAdvances ?? false
  const onFocus = useCallback(() => useEditor.getState().setActiveField(field.name), [field.name])
  const onBlur = useCallback(() => {
    const s = useEditor.getState()
    if (s.activeFieldName === field.name) s.setActiveField(null)
  }, [field.name])
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLElement>) => {
      const mod = isMac ? e.metaKey : e.ctrlKey
      const key = e.key.toLowerCase()
      if (mod && !e.altKey && (key === 'z' || key === 'y')) {
        e.preventDefault()
        e.stopPropagation()
        const s = useEditor.getState()
        if (key === 'y' || e.shiftKey) s.redo()
        else s.undo()
        return
      }
      if (e.key === 'Escape') {
        e.stopPropagation()
        e.currentTarget.blur()
        return
      }
      if (e.key === 'Enter' && enterAdvances && !e.nativeEvent.isComposing) {
        e.preventDefault()
        e.stopPropagation()
        focusAdjacentField(field.name, e.shiftKey ? -1 : 1)
      }
    },
    [field.name, enterAdvances],
  )
  return { onFocus, onBlur, onKeyDown }
}
