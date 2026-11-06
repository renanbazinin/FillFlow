import { fieldValue, storedValue } from '../../lib/pdf/forms/values'
import { firstStrongDirection } from '../../lib/text/direction'
import type { FormField, FormWidget } from '../../model/types'
import { useEditor } from '../../store/editor'
import { viewer } from '../viewer/viewerApi'

/** Marks the focusable element of an on-page field control. */
export const CONTROL_ATTR = 'data-form-control'

/** CSS.escape with a fallback (attribute selectors on field names). */
export function cssEscape(name: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(name) : name.replace(/["\\]/g, '\\$&')
}

/** The on-page control of a widget (or of the field's preferred widget), if mounted. */
export function findControl(field: FormField, widget?: FormWidget): HTMLElement | null {
  const base = `[data-form-field="${cssEscape(field.name)}"]`
  const scope = widget ? `${base}[data-form-widget="${cssEscape(widget.id)}"]` : base
  const candidates = Array.from(document.querySelectorAll<HTMLElement>(`${scope} [${CONTROL_ATTR}], ${scope}[${CONTROL_ATTR}]`))
  if (!candidates.length) return null
  // Radio groups: prefer the selected option (it's the one in the tab order).
  return candidates.find((c) => c.tabIndex === 0) ?? candidates[0]
}

/** The widget to show for a field: the selected radio option, else the first widget. */
export function primaryWidget(field: FormField): FormWidget | undefined {
  if (field.type === 'radio') {
    const value = storedValue(useEditor.getState().formValues, field.name)
    const on = field.widgets.find((w) => w.exportValue === value)
    if (on) return on
  }
  return field.widgets[0]
}

/** Scrolls the page to a field and marks it active (the on-page control shows focus styling). */
export function revealField(field: FormField, opts: { behavior?: ScrollBehavior } = {}): FormWidget | undefined {
  const widget = primaryWidget(field)
  if (!widget) return undefined
  useEditor.getState().setActiveField(field.name)
  scrollToWidget(field, widget, opts.behavior)
  return widget
}

/** Scrolls a widget into view, clear of the tool dock as it is now; wider than the view, the end its text sits at. */
function scrollToWidget(field: FormField, widget: FormWidget, behavior: ScrollBehavior | undefined): void {
  // Unless told otherwise, the viewer animates the scroll only when motion is welcome and the jump
  // is short.
  viewer.scrollToRect(widget.page, widget.rect, { behavior, margin: 96, inlineEnd: textAtEnd(field, widget) })
}

/** Whether an element's text lines up with its right edge (right-to-left, or right-aligned). */
export function textAtRight(el: Element): boolean {
  const { textAlign, direction } = getComputedStyle(el)
  return textAlign === 'right' || textAlign === (direction === 'rtl' ? 'start' : 'end')
}

/**
 * Whether a field's text lines up with its widget's right edge: as its on-page control shows it,
 * or while that isn't there, as the control would lay it out (see onpage/TextControl: right-aligned,
 * or a right-to-left value unless centred).
 */
function textAtEnd(field: FormField, widget: FormWidget): boolean {
  const control = findControl(field, widget)
  if (control) return textAtRight(control)
  if (field.type !== 'text' || field.comb) return false
  const value = String(fieldValue(field, useEditor.getState().formValues))
  return field.textAlign === 'right' || (field.textAlign !== 'center' && firstStrongDirection(value) === 'rtl')
}

let focusToken = 0

/**
 * Scrolls to a field and focuses its on-page control, waiting for the page to mount when it
 * was virtualized. Resolves to false when the control never appeared.
 */
export function focusField(field: FormField, opts: { behavior?: ScrollBehavior } = {}): Promise<boolean> {
  const s = useEditor.getState()
  if (s.tool !== 'select') s.setTool('select')
  const widget = primaryWidget(field)
  if (!widget) return Promise.resolve(false)
  useEditor.getState().setActiveField(field.name)
  const token = ++focusToken
  // A control that is there takes focus before the scroll, which then keeps clear of the tool dock
  // as it is with this field in use: on a short screen it makes way while a text box on the pages
  // has focus, and is back for a choice.
  const focused = focusControl(field, widget)
  scrollToWidget(field, widget, opts.behavior)
  if (focused) return Promise.resolve(true)
  const started = performance.now()
  return new Promise((resolve) => {
    const attempt = () => {
      if (token !== focusToken) return resolve(false)
      if (focusControl(field, widget)) return resolve(true)
      if (performance.now() - started > 1500) return resolve(false)
      requestAnimationFrame(attempt)
    }
    requestAnimationFrame(attempt)
  })
}

/** Focuses the on-page control of a widget (or of its field), caret at the end; false when it isn't there to focus. */
function focusControl(field: FormField, widget: FormWidget): boolean {
  const el = findControl(field, widget) ?? findControl(field)
  if (!el || el.closest('[inert]')) return false
  el.focus({ preventScroll: true })
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const end = el.value.length
    try {
      el.setSelectionRange(end, end)
    } catch {
      /* not a text input type */
    }
  }
  return true
}

/** Fields that take part in keyboard navigation (fillable, in reading order). */
export function navigableFields(fields: readonly FormField[]): FormField[] {
  return fields.filter((f) => !f.readOnly && f.type !== 'button')
}

/** Moves focus to the next/previous fillable field after `name` (wrapping around). */
export function focusAdjacentField(name: string, direction: 1 | -1): void {
  const fields = navigableFields(useEditor.getState().doc?.formFields ?? [])
  if (!fields.length) return
  const i = fields.findIndex((f) => f.name === name)
  const next = fields[(i + direction + fields.length) % fields.length]
  if (next) void focusField(next)
}
