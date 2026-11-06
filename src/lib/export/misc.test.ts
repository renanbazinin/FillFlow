import { afterEach, describe, expect, it } from 'vitest'
import { messagesFor, setLocale } from '../../i18n'
import { parseColor } from './color'
import { ExportError, toExportError } from './errors'
import { parsePdfDate } from './pdfjsRewrite'

describe('parseColor', () => {
  it('parses short, long and alpha hex colours', () => {
    expect(parseColor('#111827')).toEqual({ r: 0.0667, g: 0.0941, b: 0.1529, a: 1 })
    expect(parseColor('#fff')).toEqual({ r: 1, g: 1, b: 1, a: 1 })
    expect(parseColor('#ff000080')).toEqual({ r: 1, g: 0, b: 0, a: 0.502 })
    expect(parseColor('FDE047').b).toBeCloseTo(71 / 255, 3)
  })

  it('falls back to black for anything else', () => {
    for (const bad of [null, undefined, '', 'red', '#12', '#zzzzzz']) expect(parseColor(bad)).toEqual({ r: 0, g: 0, b: 0, a: 1 })
  })
})

describe('parsePdfDate', () => {
  it('handles full dates with time zones', () => {
    expect(parsePdfDate("D:20240131235959+02'00'")?.toISOString()).toBe('2024-01-31T21:59:59.000Z')
    expect(parsePdfDate("D:20240131080000-05'30")?.toISOString()).toBe('2024-01-31T13:30:00.000Z')
    expect(parsePdfDate('D:20240131080000Z')?.toISOString()).toBe('2024-01-31T08:00:00.000Z')
  })

  it('accepts partial dates and rejects junk', () => {
    expect(parsePdfDate('D:2023')?.toISOString()).toBe('2023-01-01T00:00:00.000Z')
    expect(parsePdfDate('yesterday')).toBeNull()
  })
})

describe('toExportError', () => {
  it('keeps ExportErrors and wraps everything else', () => {
    const e = new ExportError('fonts')
    expect(toExportError(e)).toBe(e)
    expect(toExportError(new Error('x'))).toMatchObject({ code: 'unknown' })
    expect(toExportError(new DOMException('stop', 'AbortError'))).toMatchObject({ code: 'aborted' })
    expect(new ExportError('encrypted').message).toMatch(/encrypted/i)
  })
})

describe('ExportError', () => {
  afterEach(() => setLocale('en'))

  it('says what went wrong in the interface language of the moment it failed', () => {
    const before = new ExportError('fonts')
    setLocale('he')
    const he = messagesFor('he').export.errors
    expect(new ExportError('fonts').message).toBe(he.fonts)
    expect(toExportError(new Error('x')).message).toBe(he.unknown)
    expect(new ExportError('unknown', 'Given.').message).toBe('Given.')
    expect(before.message).toBe('The fonts needed for your text couldn’t be loaded. Check your connection and try again.')
  })
})
