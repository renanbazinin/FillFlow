import { fieldsUnderItems } from '../../lib/export/coverage'
import type { ExportProgress } from '../../lib/export/types'
import { fieldLabel } from '../../lib/pdf/forms/labels'
import { storedValue } from '../../lib/pdf/forms/values'
import { bidiIsolate, suffixedFileName } from '../../lib/utils/misc'
import type { Element, FormField, FormValue, FormValues } from '../../model/types'
import { shortcutLetter } from '../elements/lib/keys'

/** Pure helpers behind the export dialog (file names, summary, progress copy). */

const PDF_EXT = /\.pdf$/i

/** Characters file systems reject in names, and those browsers do ("~", noncharacters). */
const REJECTED = /[\\/:*?"<>|~\p{Cc}\p{Noncharacter_Code_Point}]/u
/** Invisible formatting characters (direction marks, joiners…), which browsers save as "_". */
const INVISIBLE = /\p{Cf}/u
const HEBREW_LETTER = /(?=\p{Script=Hebrew})\p{L}/u
const MARK = /\p{M}/u
const WORD_CHAR = /[\p{L}\p{N}\p{M}]/u
/** Stands for a rejected character until runs of them are merged. */
const REJECT = '\uffff'

/**
 * A file name's characters as they will be saved, nothing trimmed yet. Hebrew abbreviations keep
 * their marks, which Hebrew keyboards type as ASCII quotes: a " between Hebrew letters is a
 * gershayim (בע"מ → בע״מ) and a ' after one a geresh (ז'בוטינסקי → ז׳בוטינסקי, מס' 5 → מס׳ 5).
 * Once a ' at the start of a word has opened a quote, a ' at the end of a word may close it, so
 * it stays ('טיוטה', 'רח' הרצל'). Rejected characters become "-" (a run of them, with the hyphens
 * next to it, a single one) and invisible ones go. A ' just before `caret`, or a " there after a
 * Hebrew letter, was most likely just typed: it stays as typed until what comes after it is known
 * (at the next keystroke, on leaving the field or on download).
 */
function nameChars(text: string, caret = -1): string {
  const chars = Array.from(text)
  const afterHebrewLetter = (i: number) => {
    while (i > 0 && MARK.test(chars[i - 1])) i--
    return i > 0 && HEBREW_LETTER.test(chars[i - 1])
  }
  // Whether a quote was opened. A geresh can end a word too, so which ' at the end of a word closes
  // it can't be told: none of them is taken for a geresh then (a ' is fine in a file name).
  let opened = false
  const singleQuote = (i: number) => {
    const next = chars[i + 1] ?? ''
    if (!WORD_CHAR.test(chars[i - 1] ?? '') && WORD_CHAR.test(next)) opened = true
    // A geresh inside a Hebrew word, or at the end of one when no quote was opened before it.
    else if (afterHebrewLetter(i) && (HEBREW_LETTER.test(next) || !opened)) return '\u05f3'
    return "'"
  }
  let out = ''
  let end = 0
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]
    end += c.length
    const justTyped = end === caret
    if (c === '"' && afterHebrewLetter(i) && justTyped) out += c
    else if (c === '"' && afterHebrewLetter(i) && HEBREW_LETTER.test(chars[i + 1] ?? '')) out += '\u05f4'
    else if (c === "'") {
      // Read even when just typed: a ' that opens a quote changes what the ones after it are.
      const mark = singleQuote(i)
      out += justTyped ? c : mark
    } else if (REJECTED.test(c)) out += REJECT
    else if (!INVISIBLE.test(c)) out += c
  }
  return out.replace(/[-\uffff]*\uffff[-\uffff]*/g, '-')
}

/** The name without its extension, as it will be saved (if anything usable is left, see below). */
function cleanName(input: string): string {
  return nameChars(input)
    .replace(/\s+/g, ' ')
    .trim()
    .replace(PDF_EXT, '')
    .replace(/^[-.\s]+|[-.\s]+$/g, '')
    .slice(0, 180)
}

/** Editable part of the default name: "lease.pdf" → "lease-filled", cleaned like a typed one. */
export function defaultBaseName(docName: string): string {
  return cleanName(suffixedFileName(docName))
}

/**
 * Turns what the user typed into a safe file name ending in ".pdf" (see `nameChars`); an empty
 * name falls back to the default.
 */
export function finalFileName(input: string, docName: string): string {
  const name = cleanName(input)
  return `${/[\p{L}\p{N}]/u.test(name) ? name : defaultBaseName(docName)}.pdf`
}

/**
 * The name field's text cleaned as it is typed, so it shows the characters the file will have
 * (spaces and dots at the ends wait until it's done), and where its selection lands in it.
 */
export function typedFileName(value: string, start: number, end: number): { value: string; start: number; end: number } {
  const upTo = (i: number) => nameChars(value.slice(0, i), end).length
  return { value: nameChars(value, end), start: upTo(start), end: upTo(end) }
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
  for (const f of fields) if (FILLABLE.has(f.type) && isFilled(f, storedValue(values, f.name))) n++
  return n
}

function isChanged(field: FormField, values: FormValues): boolean {
  const v = storedValue(values, field.name)
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

/**
 * Labels of the form fields under items the user placed. The export flattens them even when
 * flattening is off, since viewers paint fields over the page and they would hide those items.
 */
export function coveredFieldLabels(fields: FormField[], elements: Element[]): string[] {
  const covered = new Set(fieldsUnderItems(fields, elements))
  return fields.filter((f) => covered.has(f.name)).map((f) => fieldLabel(f))
}

/** What the dialog says about those fields when flattening is off. */
export function coveredFieldsNote(labels: string[]): string {
  return `${quotedList(labels)} will still be flattened so what you placed on ${labels.length === 1 ? 'it' : 'them'} stays visible.`
}

/** Letters of the right-to-left scripts (and their presentation forms). */
const RTL_TEXT = /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufefc]/

/**
 * “A”, “A” and “B”, “A”, “B” and “C”, “A”, “B”, “C” and 2 more. Right-to-left items are isolated,
 * so two Hebrew labels in a row keep their order and quotes.
 */
export function quotedList(items: string[], max = 3): string {
  const quoted = items.map((s) => `“${RTL_TEXT.test(s) ? bidiIsolate(s) : s}”`)
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

/**
 * ⌘+letter on Apple platforms, Ctrl+letter elsewhere. Like the browser's own shortcuts, this goes
 * by the letter the layout types (Dvorak, Colemak…), or by physical key where it types no Latin
 * letter (Hebrew…).
 */
function isModLetter(e: KeyLike, mac: boolean, letter: 's' | 'o'): boolean {
  if (e.altKey || e.shiftKey) return false
  if (mac ? !e.metaKey || e.ctrlKey : !e.ctrlKey || e.metaKey) return false
  return shortcutLetter({ key: e.key, code: e.code ?? '' }) === letter
}

/** ⌘S / Ctrl+S. */
export function isSaveShortcut(e: KeyLike, mac: boolean): boolean {
  return isModLetter(e, mac, 's')
}

/** ⌘O / Ctrl+O: the browser's "Open file" dialog. */
export function isOpenShortcut(e: KeyLike, mac: boolean): boolean {
  return isModLetter(e, mac, 'o')
}
