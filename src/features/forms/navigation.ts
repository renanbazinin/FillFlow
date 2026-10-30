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
    const value = useEditor.getState().formValues[field.name]
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
  viewer.scrollToRect(widget.page, widget.rect, { behavior: opts.behavior ?? 'smooth', margin: 96 })
  return widget
}

let focusToken = 0

/**
 * Scrolls to a field and focuses its on-page control, waiting for the page to mount when it
 * was virtualized. Resolves to false when the control never appeared.
 */
export function focusField(field: FormField, opts: { behavior?: ScrollBehavior } = {}): Promise<boolean> {
  const s = useEditor.getState()
  if (s.tool !== 'select') s.setTool('select')
  const widget = revealField(field, opts)
  if (!widget) return Promise.resolve(false)
  const token = ++focusToken
  const started = performance.now()
  return new Promise((resolve) => {
    const attempt = () => {
      if (token !== focusToken) return resolve(false)
      const el = findControl(field, widget) ?? findControl(field)
      if (el && !el.closest('[inert]')) {
        el.focus({ preventScroll: true })
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
          const end = el.value.length
          try {
            el.setSelectionRange(end, end)
          } catch {
            /* not a text input type */
          }
        }
        return resolve(true)
      }
      if (performance.now() - started > 1500) return resolve(false)
      requestAnimationFrame(attempt)
    }
    attempt()
  })
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
