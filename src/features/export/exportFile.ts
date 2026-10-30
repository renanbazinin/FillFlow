import type { ExportProgress } from '../../lib/export/types'
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

/** Fields whose value differs from what the file had when it was opened. */
export function countChangedFields(fields: FormField[], values: FormValues): number {
  let n = 0
  for (const f of fields) {
    const v = values[f.name]
    if (v !== undefined && JSON.stringify(v) !== JSON.stringify(f.defaultValue)) n++
  }
  return n
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

/** ⌘S on Apple platforms, Ctrl+S elsewhere (by physical key, so it works on any layout). */
export function isSaveShortcut(e: KeyboardEvent | { key: string; code?: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }, mac: boolean): boolean {
  if (e.altKey || e.shiftKey) return false
  if (mac ? !e.metaKey || e.ctrlKey : !e.ctrlKey || e.metaKey) return false
  return e.code === 'KeyS' || e.key.toLowerCase() === 's'
}
