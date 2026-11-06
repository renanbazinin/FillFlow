import type { FormField } from '../../model/types'

/** Fields a person can actually fill (push buttons aren't). */
export function fillableFieldCount(fields: readonly FormField[] | undefined): number {
  return fields?.filter((f) => f.type !== 'button').length ?? 0
}

/** "Fill fields" toast copy for a freshly opened document. */
export function formFieldsMessage(count: number, touch = false): string {
  return `${count} fillable field${count === 1 ? '' : 's'} found — ${touch ? 'tap' : 'click'} a field to type`
}
