import type { Element, FormField, FormWidget } from '../../model/types'

function isSignatureImage(e: Element): boolean {
  return e.kind === 'image' && (e.role === 'signature' || e.role === 'initials')
}

/** A signature widget counts as signed when a signature/initials image is centered inside it. */
export function widgetSigned(elements: readonly Element[], widget: Pick<FormWidget, 'page' | 'rect'>): boolean {
  const r = widget.rect
  return elements.some((e) => {
    if (e.page !== widget.page || !isSignatureImage(e)) return false
    const cx = e.x + e.width / 2
    const cy = e.y + e.height / 2
    return cx >= r.x && cx <= r.x + r.width && cy >= r.y && cy <= r.y + r.height
  })
}

export function fieldSigned(elements: readonly Element[], field: FormField): boolean {
  return field.widgets.some((w) => widgetSigned(elements, w))
}
