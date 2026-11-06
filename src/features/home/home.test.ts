import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getT, setLocale } from '../../i18n'
import { classifyDrag, dragHasFiles } from './fileDrag'
import { displayName, firstPdf, isPdfFile } from './pdfFiles'
import { missingFileMetaLine, pluralize, recentMetaLine, relativeTime } from './recentMeta'

describe('pdf files', () => {
  it('recognizes PDFs by MIME type or extension', () => {
    expect(isPdfFile({ name: 'a.pdf', type: '' })).toBe(true)
    expect(isPdfFile({ name: 'A.PDF', type: 'application/octet-stream' })).toBe(true)
    expect(isPdfFile({ name: 'scan', type: 'application/pdf' })).toBe(true)
    expect(isPdfFile({ name: 'טופס.pdf ', type: '' })).toBe(true)
    expect(isPdfFile({ name: 'photo.png', type: 'image/png' })).toBe(false)
    expect(isPdfFile({ name: 'notes.pdf.txt', type: 'text/plain' })).toBe(false)
  })

  it('picks the first PDF from a list', () => {
    const files = [
      { name: 'a.png', type: 'image/png' },
      { name: 'b.pdf', type: 'application/pdf' },
      { name: 'c.pdf', type: 'application/pdf' },
    ]
    expect(firstPdf(files)?.name).toBe('b.pdf')
    expect(firstPdf([files[0]])).toBeNull()
    expect(firstPdf(null)).toBeNull()
  })

  it('drops the extension for display only', () => {
    expect(displayName('Lease agreement.pdf')).toBe('Lease agreement')
    expect(displayName('report.PDF')).toBe('report')
    expect(displayName('.pdf')).toBe('.pdf')
    expect(displayName('no-extension')).toBe('no-extension')
  })
})

describe('drag classification', () => {
  const item = (type: string, kind = 'file') => ({ kind, type })

  it('detects file drags', () => {
    expect(dragHasFiles({ types: ['Files'] } as unknown as DataTransfer)).toBe(true)
    expect(dragHasFiles({ types: ['text/plain'] } as unknown as DataTransfer)).toBe(false)
    expect(dragHasFiles(null)).toBe(false)
  })

  it('classifies what is being dragged', () => {
    expect(classifyDrag([item('application/pdf')])).toBe('pdf')
    expect(classifyDrag([item('image/png'), item('application/pdf')])).toBe('pdf')
    expect(classifyDrag([item('image/png')])).toBe('other')
    expect(classifyDrag([item('')])).toBe('unknown')
    expect(classifyDrag([item('text/plain', 'string')])).toBe('unknown')
    expect(classifyDrag(undefined)).toBe('unknown')
  })
})

describe('recent documents meta', () => {
  const now = new Date(2026, 9, 30, 12, 0, 0).getTime()

  it('formats relative times in English', () => {
    expect(relativeTime(now - 10_000, now)).toBe('just now')
    expect(relativeTime(now + 5_000, now)).toBe('just now')
    expect(relativeTime(now - 50_000, now)).toBe('1m ago')
    expect(relativeTime(now - 5 * 60_000, now)).toBe('5m ago')
    expect(relativeTime(now - 2 * 3_600_000, now)).toBe('2h ago')
    expect(relativeTime(now - 26 * 3_600_000, now)).toBe('1d ago')
    expect(relativeTime(now - 3 * 86_400_000, now)).toBe('3d ago')
    expect(relativeTime(new Date(2026, 2, 4).getTime(), now)).toBe('Mar 4')
    expect(relativeTime(new Date(2024, 2, 4).getTime(), now)).toBe('Mar 4, 2024')
    // Whole days by the clock: 22.5 hours ago is a day, even on the same date.
    expect(relativeTime(new Date(2026, 9, 30, 1, 0).getTime(), new Date(2026, 9, 30, 23, 30).getTime())).toBe('1d ago')
  })

  it('pluralizes', () => {
    expect(pluralize(1, 'page')).toBe('1 page')
    expect(pluralize(3, 'page')).toBe('3 pages')
    expect(pluralize(0, 'document')).toBe('0 documents')
  })

  it('builds the card meta line', () => {
    const hours = (h: number) => now - h * 3_600_000
    // Opened at 09:00 and edited until 11:30: when it was last edited, not opened.
    expect(recentMetaLine(3, { openedAt: hours(3), editedAt: hours(0.5) }, now)).toBe('3 pages · edited 30m ago')
    // Never edited, or opened again since: when it was opened.
    expect(recentMetaLine(1, { openedAt: now }, now)).toBe('1 page · opened just now')
    expect(recentMetaLine(2, { openedAt: hours(1), editedAt: hours(48) }, now)).toBe('2 pages · opened 1h ago')
    expect(missingFileMetaLine(2)).toBe('2 pages · file not stored')
  })
})

describe('recent documents meta in Hebrew', () => {
  const now = new Date(2026, 9, 30, 12, 0, 0).getTime()
  beforeEach(() => setLocale('he'))
  afterEach(() => setLocale('en'))

  it('formats relative times the Hebrew way', () => {
    expect(relativeTime(now - 10_000, now)).toBe('הרגע')
    expect(relativeTime(now - 50_000, now)).toBe('לפני דקה')
    expect(relativeTime(now - 5 * 60_000, now)).toBe('לפני 5 דקות')
    expect(relativeTime(now - 3_600_000, now)).toBe('לפני שעה')
    expect(relativeTime(now - 2 * 3_600_000, now)).toBe('לפני שעתיים')
    expect(relativeTime(now - 5 * 3_600_000, now)).toBe('לפני 5 שעות')
    expect(relativeTime(now - 26 * 3_600_000, now)).toBe('אתמול')
    expect(relativeTime(now - 2 * 86_400_000, now)).toBe('שלשום')
    expect(relativeTime(now - 3 * 86_400_000, now)).toBe('לפני 3 ימים')
    // Dates as they follow "נערך" / "נפתח".
    expect(relativeTime(new Date(2026, 2, 4).getTime(), now)).toBe('ב-4 במרץ')
    expect(relativeTime(new Date(2024, 2, 4).getTime(), now)).toBe('ב-4 במרץ 2024')
  })

  it('names the days by the calendar, not by the clock', () => {
    const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).getTime()
    // 22.5 hours ago, but the same date.
    expect(relativeTime(at(30, 1), at(30, 23, 30))).toBe('היום')
    // 23.5 hours ago, yesterday's date.
    expect(relativeTime(at(29, 1), at(30, 0, 30))).toBe('אתמול')
    // Almost three days by the clock ("3d ago" in English): the day before yesterday's date.
    expect(relativeTime(at(28, 1), at(30, 23))).toBe('שלשום')
  })

  it('builds the card meta line', () => {
    const hours = (h: number) => now - h * 3_600_000
    expect(recentMetaLine(3, { openedAt: hours(3), editedAt: hours(0.5) }, now)).toBe('3 עמודים · נערך לפני 30 דקות')
    expect(recentMetaLine(1, { openedAt: now }, now)).toBe('עמוד אחד · נפתח הרגע')
    expect(recentMetaLine(2, { openedAt: hours(2), editedAt: hours(48) }, now)).toBe('2 עמודים · נפתח לפני שעתיים')
    expect(missingFileMetaLine(1)).toBe('עמוד אחד · הקובץ לא שמור')
  })

  it('counts the Hebrew way', () => {
    const { recent } = getT().home
    expect(recent.filled(1)).toBe('1 מולא')
    expect(recent.filled(4)).toBe('4 מולאו')
    expect(recent.clear.body(1)).toBe('מסמך אחד והעבודה שעשיתם עליו יימחקו מהמכשיר הזה. אי אפשר לבטל את הפעולה.')
    expect(recent.clear.body(3)).toBe('3 מסמכים והעבודה שעשיתם עליהם יימחקו מהמכשיר הזה. אי אפשר לבטל את הפעולה.')
  })

  it('isolates file names in sentences', () => {
    expect(getT().home.open.notPdf('photo 1.png')).toBe('"⁨photo 1.png⁩" אינו קובץ PDF')
  })
})
