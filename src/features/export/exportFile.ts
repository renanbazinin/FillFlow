import type { ExportProgress } from '../../lib/export/types'
import { fieldLabel } from '../../lib/pdf/forms/labels'
import { suffixedFileName } from '../../lib/utils/misc'
import type { FormField, FormValue, FormValues } from '../../model/types'

/** Pure helpers behind the export dialog (file names, summary, progress copy). */

const PDF_EXT = /\.pdf$/i

/** Editable part of the default name: "lease.pdf" → "lease-filled". */
export function defaultBaseName(docName: string): string {
  return suffixedFileName(docName).replace(PDF_EXT, '')
}

/**
 * Turns what the user typed into a safe file name ending in ".pdf". Characters that are
 * invalid on common file systems become "-"; an empty name falls back to the default.
 */
export function finalFileName(input: string, docName: string): string {
  const cleaned = input
    .trim()
    .replace(PDF_EXT, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[-.\s]+|[-.\s]+$/g, '')
    .slice(0, 180)
  return `${/[\p{L}\p{N}]/u.test(cleaned) ? cleaned : defaultBaseName(docName)}.pdf`
}

function isFilled(field: FormField, value: FormValue | undefined): boolean {
  if (value === undefined) return false
  if (typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.length > 0
  const v = value.trim()
  if (!v) return false
  return !((field.type === 'radio' || field.type === 'checkbox') && v === 'Off')
}

const FILLABLE = new Set<FormField['type']>(['text', 'checkbox', 'radio', 'dropdown', 'listbox'])

/** Form fields that will carry a value in the exported file. */
export function countFilledFields(fields: FormField[], values: FormValues): number {
  let n = 0
  for (const f of fields) if (FILLABLE.has(f.type) && isFilled(f, values[f.name])) n++
  return n
}

function isChanged(field: FormField, values: FormValues): boolean {
  const v = values[field.name]
  return v !== undefined && JSON.stringify(v) !== JSON.stringify(field.defaultValue)
}

/** Fields whose value differs from what the file had when it was opened. */
export function countChangedFields(fields: FormField[], values: FormValues): number {
  let n = 0
  for (const f of fields) if (isChanged(f, values)) n++
  return n
}

/**
 * Labels of the fields the user changed whose values the export could not write (`unwritten`
 * holds field names). Untouched fields keep what the file had, so they aren't listed.
 */
export function unwrittenFieldLabels(fields: FormField[], values: FormValues, unwritten: readonly string[]): string[] {
  if (!unwritten.length) return []
  const names = new Set(unwritten)
  return fields.filter((f) => names.has(f.name) && isChanged(f, values)).map((f) => fieldLabel(f))
}

/** “A”, “A” and “B”, “A”, “B” and “C”, “A”, “B”, “C” and 2 more. */
export function quotedList(items: string[], max = 3): string {
  const quoted = items.map((s) => `“${s}”`)
  if (quoted.length <= max) return quoted.length > 1 ? `${quoted.slice(0, -1).join(', ')} and ${quoted.at(-1)}` : (quoted[0] ?? '')
  return `${quoted.slice(0, max).join(', ')} and ${quoted.length - max} more`
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`
}

export function progressLabel(p: ExportProgress | null): string {
  if (!p) return 'Preparing your PDF…'
  switch (p.phase) {
    case 'prepare':
      return 'Preparing your PDF…'
    case 'forms':
      return 'Filling in form fields…'
    case 'pages':
      return p.total > 1 ? `Adding your changes… page ${Math.min(p.done + 1, p.total)} of ${p.total}` : 'Adding your changes…'
    case 'save':
      return 'Saving…'
  }
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`
}

type KeyLike = KeyboardEvent | { key: string; code?: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }

/** ⌘+letter on Apple platforms, Ctrl+letter elsewhere (by physical key, so it works on any layout). */
function isModLetter(e: KeyLike, mac: boolean, letter: 's' | 'o'): boolean {
  if (e.altKey || e.shiftKey) return false
  if (mac ? !e.metaKey || e.ctrlKey : !e.ctrlKey || e.metaKey) return false
  return e.code === `Key${letter.toUpperCase()}` || e.key.toLowerCase() === letter
}

/** ⌘S / Ctrl+S. */
export function isSaveShortcut(e: KeyLike, mac: boolean): boolean {
  return isModLetter(e, mac, 's')
}

/** ⌘O / Ctrl+O: the browser's "Open file" dialog. */
export function isOpenShortcut(e: KeyLike, mac: boolean): boolean {
  return isModLetter(e, mac, 'o')
}
