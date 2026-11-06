import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getT, setLocale } from '../../i18n'
import { bidiIsolate } from '../../lib/utils/misc'
import type { Element, FormField } from '../../model/types'
import {
  countChangedFields,
  countFilledFields,
  coveredFieldLabels,
  coveredFieldsNote,
  defaultBaseName,
  finalFileName,
  formatFileSize,
  isOpenShortcut,
  isSaveShortcut,
  progressLabel,
  quotedList,
  summaryParts,
  typedFileName,
  unwrittenFieldLabels,
} from './exportFile'

const field = (name: string, type: FormField['type'], defaultValue: FormField['defaultValue'] = ''): FormField => ({
  name,
  type,
  widgets: [],
  readOnly: false,
  required: false,
  defaultValue,
})

describe('file names', () => {
  it('suggests "<name>-filled"', () => {
    expect(defaultBaseName('Lease Agreement.PDF')).toBe('Lease Agreement-filled')
    expect(defaultBaseName('טופס.pdf')).toBe('טופס-filled')
  })

  it('always ends in a single .pdf and strips characters file systems reject', () => {
    expect(finalFileName('report', 'x.pdf')).toBe('report.pdf')
    expect(finalFileName('report.pdf', 'x.pdf')).toBe('report.pdf')
    expect(finalFileName('a/b\\c:d*e?"f"<g>|h', 'x.pdf')).toBe('a-b-c-d-e-f-g-h.pdf')
    expect(finalFileName('  spaced   out  ', 'x.pdf')).toBe('spaced out.pdf')
    expect(finalFileName('...hidden.', 'x.pdf')).toBe('hidden.pdf')
    expect(finalFileName('טופס מלא', 'x.pdf')).toBe('טופס מלא.pdf')
  })

  it('falls back to the default when nothing usable is left', () => {
    expect(finalFileName('', 'contract.pdf')).toBe('contract-filled.pdf')
    expect(finalFileName(' .pdf ', 'contract.pdf')).toBe('contract-filled.pdf')
    expect(finalFileName('///', 'contract.pdf')).toBe('contract-filled.pdf')
  })

  it('keeps Hebrew abbreviations typed with ASCII quotes, in their own marks', () => {
    // Hebrew keyboards type the gershayim of בע"מ as " (which no file can have), the geresh as '.
    expect(finalFileName('טופס 101 – חברת דוגמה בע"מ (עותק)', 'x.pdf')).toBe('טופס 101 – חברת דוגמה בע״מ (עותק).pdf')
    expect(finalFileName(`ז'בוטינסקי ת"א 2026/27`, 'x.pdf')).toBe('ז׳בוטינסקי ת״א 2026-27.pdf')
    expect(finalFileName('טופס 101 - ת"א - ז"ל - ע"י', 'x.pdf')).toBe('טופס 101 - ת״א - ז״ל - ע״י.pdf')
    expect(finalFileName(`ג'ורג' מס' 2`, 'x.pdf')).toBe('ג׳ורג׳ מס׳ 2.pdf')
    // The real marks stay as they are.
    expect(finalFileName('חברה בע״מ ז׳בוטינסקי', 'x.pdf')).toBe('חברה בע״מ ז׳בוטינסקי.pdf')
    // Quotes around a word aren't abbreviations: " can't stay, ' can.
    expect(finalFileName(`'טיוטה' "סופי"`, 'x.pdf')).toBe(`'טיוטה' -סופי.pdf`)
    expect(finalFileName(`Say "hi" it's`, 'x.pdf')).toBe(`Say -hi- it's.pdf`)
  })

  it('keeps single quotes around Hebrew words and phrases as typed', () => {
    // A ' at the start of a word opens a quote, which the next ' at the end of a word closes.
    expect(finalFileName(`טופס 'הצהרת בריאות'`, 'x.pdf')).toBe(`טופס 'הצהרת בריאות'.pdf`)
    expect(finalFileName(`טופס ('טיוטה')`, 'x.pdf')).toBe(`טופס ('טיוטה').pdf`)
    expect(finalFileName(`טופס_101_'טיוטה'`, 'x.pdf')).toBe(`טופס_101_'טיוטה'.pdf`)
    expect(finalFileName(`'א','ב'`, 'x.pdf')).toBe(`'א','ב'.pdf`)
    // Inside a Hebrew word a ' is a geresh all the same.
    expect(finalFileName(`'ז'בוטינסקי'`, 'x.pdf')).toBe(`'ז׳בוטינסקי'.pdf`)
    // At the end of one, once a quote was opened, it may be the one that closes it: it stays.
    expect(finalFileName(`'רח' הרצל'`, 'x.pdf')).toBe(`'רח' הרצל'.pdf`)
    expect(finalFileName(`'ג'ורג' כהן'`, 'x.pdf')).toBe(`'ג׳ורג' כהן'.pdf`)
    expect(finalFileName(`'טופס 101' מס' 2`, 'x.pdf')).toBe(`'טופס 101' מס' 2.pdf`)
    // An apostrophe inside a word doesn't close one.
    expect(finalFileName(`'it's טיוטה'`, 'x.pdf')).toBe(`'it's טיוטה'.pdf`)
  })

  it('drops invisible characters and turns "~" into "-", as browsers would save them otherwise', () => {
    const RLM = String.fromCharCode(0x200f)
    expect(finalFileName(`טופס${RLM} 101`, 'x.pdf')).toBe('טופס 101.pdf')
    expect(finalFileName('draft~2', 'x.pdf')).toBe('draft-2.pdf')
    // Control characters (also those pasted from mis-decoded text) and noncharacters.
    expect(finalFileName(`it${String.fromCharCode(0x92)}s${String.fromCharCode(0xfdd0)}`, 'x.pdf')).toBe('it-s.pdf')
    expect(finalFileName('a -/ b', 'x.pdf')).toBe('a - b.pdf')
  })

  it('suggests a default that is the name the file gets', () => {
    expect(defaultBaseName('טופס 101 - חברת דוגמה בע"מ.pdf')).toBe('טופס 101 - חברת דוגמה בע״מ-filled')
    expect(defaultBaseName('Q1: report?.pdf')).toBe('Q1- report-filled')
    expect(finalFileName('', 'טופס 101 - חברת דוגמה בע"מ.pdf')).toBe('טופס 101 - חברת דוגמה בע״מ-filled.pdf')
  })
})

describe('typedFileName', () => {
  const typed = (value: string, caret = value.length) => typedFileName(value, caret, caret)
  /** Types `text` at `caret` a character at a time, cleaned after each one as the field does. */
  const typeAt = (value: string, caret: number, text: string) => {
    let field = { value, start: caret, end: caret }
    for (const c of text) {
      const at = field.end
      field = typedFileName(field.value.slice(0, at) + c + field.value.slice(at), at + c.length, at + c.length)
    }
    return field
  }

  it('shows the characters the file gets as they are typed, keeping the caret in place', () => {
    expect(typed('2026/')).toEqual({ value: '2026-', start: 5, end: 5 })
    expect(typed('a-?b', 3)).toEqual({ value: 'a-b', start: 2, end: 2 })
    expect(typed(`ז'ב`)).toEqual({ value: 'ז׳ב', start: 3, end: 3 })
    expect(typed(`a${String.fromCharCode(0x200f)}b`, 2)).toEqual({ value: 'ab', start: 1, end: 1 })
    expect(typedFileName('a?b?c', 1, 4)).toEqual({ value: 'a-b-c', start: 1, end: 4 })
    // Spaces and dots at the ends are left alone while typing.
    expect(typed('report. ').value).toBe('report. ')
  })

  it('lets a " typed after a Hebrew letter wait for the next letter', () => {
    expect(typed('בע"').value).toBe('בע"')
    expect(typed('בע"מ').value).toBe('בע״מ')
    // Typed in the middle of the name, before " (עותק)".
    expect(typed('בע" (עותק)', 3).value).toBe('בע" (עותק)')
    expect(typed('בע"מ (עותק)', 4).value).toBe('בע״מ (עותק)')
    // Anywhere else it becomes what it will be.
    expect(typed('בע" (עותק)').value).toBe('בע- (עותק)')
    expect(typed('Say "').value).toBe('Say -')
  })

  it('keeps a quote typed around Hebrew words, and a geresh typed inside one', () => {
    expect(typed(`טופס '`).value).toBe(`טופס '`)
    expect(typed(`טופס 'הצהרת בריאות'`).value).toBe(`טופס 'הצהרת בריאות'`)
    expect(typed(`טופס ('טיוטה'`).value).toBe(`טופס ('טיוטה'`)
    // Closing the quote, until the next letter shows it's inside a word.
    expect(typed(`'ז'`).value).toBe(`'ז'`)
    expect(typed(`'ז'ב`)).toEqual({ value: `'ז׳ב`, start: 4, end: 4 })
    // A geresh too waits for what follows it.
    expect(typed(`ז'`)).toEqual({ value: `ז'`, start: 2, end: 2 })
    expect(typeAt('', 0, `ג'ורג' מס' 2`).value).toBe('ג׳ורג׳ מס׳ 2')
  })

  it('lets a quote typed in front of a name wait for what is typed after it', () => {
    // The letter already after the caret doesn't make a closing quote a geresh or a gershayim.
    expect(typeAt('טופס 101', 0, `'טיוטה' `)).toEqual({ value: `'טיוטה' טופס 101`, start: 8, end: 8 })
    expect(typeAt('טופס 101', 0, `"סופי" `)).toEqual({ value: '-סופי- טופס 101', start: 7, end: 7 })
    // The same as when they're typed in order.
    expect(typeAt('', 0, `'טיוטה' טופס 101`).value).toBe(`'טיוטה' טופס 101`)
    expect(typeAt('', 0, `"סופי" טופס 101`).value).toBe('-סופי- טופס 101')
    // And as the file gets them.
    expect(finalFileName(`'טיוטה' טופס 101`, 'x.pdf')).toBe(`'טיוטה' טופס 101.pdf`)
    expect(finalFileName(`"סופי" טופס 101`, 'x.pdf')).toBe('סופי- טופס 101.pdf')
  })

  it('keeps a quoted phrase with a geresh at the end of a word in it as typed', () => {
    expect(typeAt('', 0, `'רח' הרצל'`).value).toBe(`'רח' הרצל'`)
    expect(typeAt('', 0, `'ג'ורג' כהן'`).value).toBe(`'ג׳ורג' כהן'`)
  })
})

describe('summary counts', () => {
  const fields = [
    field('name', 'text'),
    field('agree', 'checkbox', false),
    field('color', 'radio', 'Off'),
    field('city', 'dropdown', 'Haifa'),
    field('tags', 'listbox', []),
    field('sig', 'signature'),
    field('btn', 'button'),
  ]

  it('counts fields that will carry a value', () => {
    expect(countFilledFields(fields, { name: '', agree: false, color: 'Off', city: 'Haifa', tags: [] })).toBe(1)
    expect(countFilledFields(fields, { name: 'Ada', agree: true, color: 'blue', city: 'Haifa', tags: ['a'], sig: 'x', btn: 'y' })).toBe(5)
    expect(countFilledFields(fields, { name: '   ' })).toBe(0)
  })

  it('counts fields the user changed', () => {
    expect(countChangedFields(fields, { name: '', agree: false, color: 'Off', city: 'Haifa', tags: [] })).toBe(0)
    expect(countChangedFields(fields, { name: 'Ada', city: 'Tel Aviv', tags: [] })).toBe(2)
  })

  it('reads only stored values, also for fields named like what objects inherit', () => {
    const odd = [field('__proto__', 'text'), field('constructor', 'text'), field('toString', 'checkbox', false)]
    expect(countFilledFields(odd, {})).toBe(0)
    expect(countChangedFields(odd, {})).toBe(0)
    expect(unwrittenFieldLabels(odd, {}, ['__proto__', 'constructor', 'toString'])).toEqual([])
    const values = JSON.parse('{"__proto__": "Ada", "constructor": "", "toString": true}')
    expect(countFilledFields(odd, values)).toBe(2)
    expect(countChangedFields(odd, values)).toBe(2)
  })

  it('pluralizes', () => {
    expect(summaryParts(1, 0, null)).toEqual(['1 page', '0 items placed'])
    expect(summaryParts(2, 1, 3)).toEqual(['2 pages', '1 item placed', '3 fields filled'])
    expect(summaryParts(1200, 2, 1)).toEqual([`${(1200).toLocaleString()} pages`, '2 items placed', '1 field filled'])
  })
})

describe('progress and sizes', () => {
  it('describes each phase', () => {
    expect(progressLabel(null)).toMatch(/Preparing/)
    expect(progressLabel({ phase: 'forms', done: 0, total: 0 })).toMatch(/form fields/)
    expect(progressLabel({ phase: 'pages', done: 2, total: 12 })).toBe('Adding your changes… page 3 of 12')
    expect(progressLabel({ phase: 'pages', done: 0, total: 1 })).toBe('Adding your changes…')
    expect(progressLabel({ phase: 'save', done: 1, total: 1 })).toBe('Saving…')
  })

  it('formats file sizes', () => {
    expect(formatFileSize(900)).toBe('900 B')
    expect(formatFileSize(1500)).toBe('1 KB')
    expect(formatFileSize(250 * 1024)).toBe('250 KB')
    expect(formatFileSize(3.25 * 1024 * 1024)).toBe('3.3 MB')
    expect(formatFileSize(42 * 1024 * 1024)).toBe('42 MB')
  })
})

describe('isSaveShortcut', () => {
  const key = (k: Partial<KeyboardEvent>) => ({ key: 's', code: 'KeyS', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...k })

  it('uses ⌘ on Mac and Ctrl elsewhere', () => {
    expect(isSaveShortcut(key({ ctrlKey: true }), false)).toBe(true)
    expect(isSaveShortcut(key({ metaKey: true }), true)).toBe(true)
    expect(isSaveShortcut(key({ metaKey: true }), false)).toBe(false)
    expect(isSaveShortcut(key({ ctrlKey: true }), true)).toBe(false)
  })

  it('works on non-Latin layouts and ignores modified variants', () => {
    expect(isSaveShortcut(key({ ctrlKey: true, key: 'ד' }), false)).toBe(true)
    expect(isSaveShortcut(key({ ctrlKey: true, shiftKey: true }), false)).toBe(false)
    expect(isSaveShortcut(key({ ctrlKey: true, altKey: true }), false)).toBe(false)
    expect(isSaveShortcut(key({ ctrlKey: true, key: 'd', code: 'KeyD' }), false)).toBe(false)
  })

  it('also recognizes ⌘O / Ctrl+O, on any layout', () => {
    expect(isOpenShortcut(key({ ctrlKey: true, key: 'o', code: 'KeyO' }), false)).toBe(true)
    expect(isOpenShortcut(key({ metaKey: true, key: 'o', code: 'KeyO' }), true)).toBe(true)
    expect(isOpenShortcut(key({ ctrlKey: true, key: 'ם', code: 'KeyO' }), false)).toBe(true)
    expect(isOpenShortcut(key({ metaKey: true, key: 'ם', code: 'KeyO' }), true)).toBe(true)
    expect(isSaveShortcut(key({ metaKey: true, key: 'ד', code: 'KeyS' }), true)).toBe(true)
    expect(isOpenShortcut(key({ ctrlKey: true }), false)).toBe(false)
    expect(isOpenShortcut(key({ key: 'o', code: 'KeyO' }), false)).toBe(false)
  })

  it('goes by the letter a Latin layout types, as the browser does, not by physical key', () => {
    for (const mac of [false, true]) {
      const mod = (k: Partial<KeyboardEvent>) => key({ ...k, ctrlKey: !mac, metaKey: mac })
      // Dvorak: R (reload) is on the O key, O on the S key, S on the semicolon key.
      expect(isOpenShortcut(mod({ key: 'r', code: 'KeyO' }), mac)).toBe(false)
      expect(isSaveShortcut(mod({ key: 'o', code: 'KeyS' }), mac)).toBe(false)
      expect(isOpenShortcut(mod({ key: 'o', code: 'KeyS' }), mac)).toBe(true)
      expect(isSaveShortcut(mod({ key: 's', code: 'Semicolon' }), mac)).toBe(true)
      // Colemak: R is on the S key, Y (redo) on the O key; O and S are on the semicolon and D keys.
      expect(isSaveShortcut(mod({ key: 'r', code: 'KeyS' }), mac)).toBe(false)
      expect(isOpenShortcut(mod({ key: 'y', code: 'KeyO' }), mac)).toBe(false)
      expect(isOpenShortcut(mod({ key: 'o', code: 'Semicolon' }), mac)).toBe(true)
      expect(isSaveShortcut(mod({ key: 's', code: 'KeyD' }), mac)).toBe(true)
    }
  })
})

describe('fields the export could not write', () => {
  const fields = [{ ...field('applicant.last_name', 'text'), label: 'Last name' }, field('address.city', 'text'), field('zip', 'text', '123')]

  it('lists the ones the user changed, by label', () => {
    const values = { 'applicant.last_name': 'Lovelace', 'address.city': 'London', zip: '123' }
    expect(unwrittenFieldLabels(fields, values, ['applicant.last_name', 'address.city', 'zip'])).toEqual(['Last name', 'City'])
    expect(unwrittenFieldLabels(fields, values, [])).toEqual([])
    expect(unwrittenFieldLabels(fields, { 'address.city': '' }, ['address.city'])).toEqual([])
  })

  it('quotes names in a short list', () => {
    expect(quotedList(['Name'])).toBe('“Name”')
    expect(quotedList(['Name', 'City'])).toBe('“Name” and “City”')
    expect(quotedList(['A', 'B', 'C'])).toBe('“A”, “B” and “C”')
    expect(quotedList(['A', 'B', 'C', 'D', 'E'])).toBe('“A”, “B”, “C” and 2 more')
  })

  it('keeps right-to-left names apart, so their order and quotes hold in the sentence', () => {
    expect(quotedList(['שם', 'עיר', 'City'])).toBe(`“${bidiIsolate('שם')}”, “${bidiIsolate('עיר')}” and “City”`)
  })
})

describe('fields under placed items', () => {
  const at = (f: FormField, x: number, y: number, width = 160, height = 20): FormField => ({ ...f, widgets: [{ id: `${f.name}-w`, page: 0, rect: { x, y, width, height } }] })
  const fields = [
    { ...at(field('applicant.full_name', 'text'), 100, 100), label: 'Full name' },
    at(field('sig', 'signature'), 100, 200, 160, 40),
    at(field('city', 'text'), 100, 300),
  ]
  const mark = (x: number, y: number): Element => ({ id: `m${x}-${y}`, kind: 'mark', page: 0, x, y, width: 14, height: 14, shape: 'check', color: '#111827' })

  it('lists them by label, in form order', () => {
    expect(coveredFieldLabels(fields, [mark(150, 210), mark(150, 103)])).toEqual(['Full name', 'Sig'])
    expect(coveredFieldLabels(fields, [mark(400, 103)])).toEqual([])
    expect(coveredFieldLabels(fields, [])).toEqual([])
  })

  it('says they will be flattened even so', () => {
    expect(coveredFieldsNote(['Signature'])).toBe('“Signature” will still be flattened so what you placed on it stays visible.')
    expect(coveredFieldsNote(['Full name', 'Signature'])).toBe('“Full name” and “Signature” will still be flattened so what you placed on them stays visible.')
  })
})

describe('file name edge cases', () => {
  it('does not leave separators at the ends', () => {
    expect(finalFileName('final?', 'x.pdf')).toBe('final.pdf')
    expect(finalFileName('Mój wniosek / final?', 'x.pdf')).toBe('Mój wniosek - final.pdf')
    expect(finalFileName('-draft-', 'x.pdf')).toBe('draft.pdf')
  })
})

describe('in Hebrew', () => {
  beforeEach(() => setLocale('he'))
  afterEach(() => setLocale('en'))

  it('suggests a name ending in a Hebrew word, unless asked for another language’s', () => {
    expect(defaultBaseName('טופס 101.pdf')).toBe('טופס 101-ממולא')
    expect(finalFileName('', 'contract.pdf')).toBe('contract-ממולא.pdf')
    expect(finalFileName('דוח', 'contract.pdf')).toBe('דוח.pdf')
    expect(defaultBaseName('טופס 101.pdf', 'en')).toBe('טופס 101-filled')
  })

  it('counts what the file holds, one in words', () => {
    expect(summaryParts(1, 1, 1)).toEqual(['עמוד אחד', 'פריט אחד נוסף', 'שדה אחד מולא'])
    expect(summaryParts(3, 0, 0)).toEqual(['3 עמודים', 'לא נוספו פריטים', 'לא מולאו שדות'])
    expect(summaryParts(2, 5, null)).toEqual(['2 עמודים', '5 פריטים נוספו'])
  })

  it('describes each phase and sizes', () => {
    expect(progressLabel(null)).toBe('מכין את קובץ ה-PDF…')
    expect(progressLabel({ phase: 'pages', done: 2, total: 12 })).toBe('מוסיף את השינויים שלכם… עמוד 3 מתוך 12')
    expect(progressLabel({ phase: 'pages', done: 0, total: 1 })).toBe('מוסיף את השינויים שלכם…')
    expect(progressLabel({ phase: 'save', done: 1, total: 1 })).toBe('שומר…')
    expect(formatFileSize(900)).toBe('900 בתים')
    expect(formatFileSize(1500)).toBe('1 ק״ב')
    expect(formatFileSize(3.25 * 1024 * 1024)).toBe('3.3 מ״ב')
  })

  it('names fields in straight quotes, each isolated, with ו before the last', () => {
    const q = (name: string) => `"${bidiIsolate(name)}"`
    expect(quotedList(['שם'])).toBe(q('שם'))
    expect(quotedList(['שם', 'City'])).toBe(`${q('שם')} ו${q('City')}`)
    expect(quotedList(['א', 'ב', 'ג'])).toBe(`${q('א')}, ${q('ב')} ו${q('ג')}`)
    expect(quotedList(['א', 'ב', 'ג', 'ד'])).toBe(`${q('א')}, ${q('ב')}, ${q('ג')} ועוד אחד`)
    expect(quotedList(['א', 'ב', 'ג', 'ד', 'ה'])).toBe(`${q('א')}, ${q('ב')}, ${q('ג')} ועוד 2`)
  })

  it('agrees with how many fields a sentence names', () => {
    const sig = bidiIsolate('חתימה')
    expect(coveredFieldsNote(['חתימה'])).toBe(`השדה "${sig}" ישוטח בכל זאת, כדי שמה שהוספתם עליו יישאר גלוי.`)
    expect(coveredFieldsNote(['שם', 'חתימה'])).toMatch(/^השדות .* ישוטחו בכל זאת, כדי שמה שהוספתם עליהם יישאר גלוי\.$/)
    const { unwritten } = getT().export
    expect(unwritten.body(quotedList(['שם']), 1)).toBe(`קובץ ה-PDF לא יכלול את מה שהזנתם בשדה "${bidiIsolate('שם')}".`)
    expect(unwritten.body(quotedList(['שם', 'עיר']), 2)).toMatch(/^קובץ ה-PDF לא יכלול את מה שהזנתם בשדות "/)
    expect(unwritten.title(1)).toBe('לא ניתן היה למלא שדה אחד')
  })
})
