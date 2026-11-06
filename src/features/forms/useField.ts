import { useCallback, useEffect, useState } from 'react'
import { useLocale } from '../../i18n'
import { fieldLabel, radioOptions } from '../../lib/pdf/forms/labels'
import { coerceValue, storedValue } from '../../lib/pdf/forms/values'
import { isMac } from '../../lib/utils/misc'
import type { FormField, FormFieldOption, FormValue } from '../../model/types'
import { useEditor } from '../../store/editor'
import { shortcutLetter } from '../elements/lib/keys'
import { focusAdjacentField } from './navigation'
import { fieldSigned } from './signed'

/** The field's current value, coerced to the shape its type expects. */
export function useFieldValue(field: FormField): FormValue {
  const raw = useEditor((s) => storedValue(s.formValues, field.name))
  return coerceValue(field, raw === undefined ? field.defaultValue : raw)
}

/**
 * The field's label (see fieldLabel): the PDF's words, or ours for a field it leaves unnamed. Those
 * are in the interface's language, so the caller re-renders when it changes.
 */
export function useFieldLabel(field: FormField): string {
  useLocale()
  return fieldLabel(field)
}

/** A radio field's choices (see radioOptions); one with an empty value is named in the interface's language. */
export function useRadioOptions(field: FormField): FormFieldOption[] {
  useLocale()
  return radioOptions(field)
}

/**
 * The text input of a combo box that accepts typed text. Typed text that matches an option's
 * label selects that option (its export value is stored); while the user types, the input keeps
 * exactly what they typed — typing an export value ("US") must not turn it into the option's
 * label mid-word. Elsewhere (and after blur) the input shows the stored value's label.
 */
export function useComboText(field: FormField, value: string) {
  const [draft, setDraft] = useState<string | null>(null)
  const options = field.options ?? []
  const toValue = (text: string) => options.find((o) => o.label === text)?.value ?? text
  // A draft is stale once the value changed elsewhere (undo, the other control).
  const text = draft !== null && toValue(draft) === value ? draft : (options.find((o) => o.value === value)?.label ?? value)
  return {
    text,
    change(typed: string) {
      setDraft(typed)
      setFieldValue(field.name, toValue(typed))
    },
    endEdit() {
      setDraft(null)
    },
  }
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

type HistoryKeyEvent = Pick<
  React.KeyboardEvent,
  'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'preventDefault' | 'stopPropagation'
> & { nativeEvent: Pick<KeyboardEvent, 'isComposing'> }

/**
 * ⌘/Ctrl+Z, ⌘/Ctrl+Shift+Z and (not on Apple platforms) Ctrl+Y inside a field (on the page or in
 * the form panel) run the editor's undo/redo, like everywhere else. The browser's own undo would
 * change whichever field it last saw typing in, page and panel copies alike. Letters go by
 * physical key where the layout types no Latin letter (Hebrew…). True when the key was handled.
 */
export function routeHistoryKeys(e: HistoryKeyEvent): boolean {
  const mod = isMac ? e.metaKey : e.ctrlKey
  if (!mod || e.altKey || e.nativeEvent.isComposing) return false
  const letter = shortcutLetter(e)
  const redo = (letter === 'z' && e.shiftKey) || (letter === 'y' && !isMac)
  if (letter !== 'z' && !redo) return false
  e.preventDefault()
  e.stopPropagation()
  const s = useEditor.getState()
  if (redo) s.redo()
  else s.undo()
  return true
}

/** A control of a form field, on the page or in the form panel. */
function inField(node: EventTarget | null): boolean {
  return node instanceof Element && node.closest('[data-form-field], [data-panel-field]') !== null
}

/**
 * The browser keeps one undo history for the whole page, so its own undo — ⌘/Ctrl+Z in a box that
 * isn't a field (a text item, the file name…), or a menu's Undo — can reach back into a field: it
 * changes the field behind the editor's back and moves focus into it. Fields undo through the
 * editor only: the browser's undo or redo of a field is cancelled, and from inside a field (its
 * context menu) the editor's runs instead, as with the keys (`routeHistoryKeys`). One already
 * cancelled (by another guard) is left alone.
 */
export function guardNativeHistory(
  e: Pick<InputEvent, 'inputType' | 'target' | 'cancelable' | 'defaultPrevented' | 'preventDefault'>,
  focused: Element | null,
): void {
  if ((e.inputType !== 'historyUndo' && e.inputType !== 'historyRedo') || !e.cancelable || e.defaultPrevented) return
  const fromField = inField(focused)
  if (!fromField && !inField(e.target)) return
  e.preventDefault()
  if (!fromField) return
  const s = useEditor.getState()
  if (e.inputType === 'historyRedo') s.redo()
  else s.undo()
}

/** Keeps the browser's own undo out of the fields while mounted (`guardNativeHistory`). */
export function useNativeHistoryGuard(on = true): void {
  useEffect(() => {
    if (!on) return
    // A native listener: React's onBeforeInput is a stand-in without `inputType`.
    const listener = (e: InputEvent) => guardNativeHistory(e, document.activeElement)
    document.addEventListener('beforeinput', listener, true)
    return () => document.removeEventListener('beforeinput', listener, true)
  }, [on])
}

/**
 * Focus bookkeeping and keyboard behaviour shared by every on-page control:
 * focus/blur keep `activeFieldName` in sync, ⌘/Ctrl+Z/Y route to the editor's undo history
 * (`routeHistoryKeys`), Enter (single-line) moves to the next field, and Escape leaves the field.
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
      if (routeHistoryKeys(e)) return
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
