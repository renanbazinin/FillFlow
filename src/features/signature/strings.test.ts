import { afterEach, describe, expect, it } from 'vitest'
import { getT, setLocale } from '../../i18n'
import { TOOL_BY_ID } from '../../model/tools'

describe('signature strings', () => {
  afterEach(() => setLocale('en'))

  it('count the strokes on the pad, the first one in words in Hebrew', () => {
    const en = getT().signature.draw.area
    expect(en.signature(0)).toBe('Drawing area for your signature. Draw with a mouse, finger or stylus.')
    expect(en.initials(2)).toBe('Drawing area for your initials. Draw with a mouse, finger or stylus; 2 strokes so far.')
    setLocale('he')
    const he = getT().signature.draw.area
    expect(he.signature(0)).toBe('אזור הציור של החתימה. ציירו בעכבר, באצבע או בעט.')
    expect(he.signature(1)).toBe('אזור הציור של החתימה. ציירו בעכבר, באצבע או בעט; משיכה אחת עד כה.')
    expect(he.initials(3)).toBe('אזור הציור של ראשי התיבות. ציירו בעכבר, באצבע או בעט; 3 משיכות עד כה.')
  })

  it('count the saved ones', () => {
    expect(getT().signature.saved.count.signature(2)).toBe('2 saved signature')
    setLocale('he')
    const { count } = getT().signature.saved
    expect([0, 1, 4].map((n) => count.signature(n))).toEqual(['אין חתימות שמורות', 'חתימה שמורה אחת', '4 חתימות שמורות'])
    expect([0, 2].map((n) => count.initials(n))).toEqual(['אין ראשי תיבות שמורים', 'ראשי תיבות שמורים: 2'])
  })

  it('name a saved one by the day it was saved, as the language writes it', () => {
    const day = (locale: string) => new Date(2026, 2, 5).toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' })
    expect(getT().signature.saved.place.signature(day('en'))).toBe('Place signature saved Mar 5, 2026')
    setLocale('he')
    const { place, remove } = getT().signature.saved
    expect(place.signature(day('he'))).toBe('הוספת החתימה שנשמרה ב-5 במרץ 2026')
    expect(remove.initials(day('he'))).toBe('מחיקת ראשי התיבות שנשמרו ב-5 במרץ 2026')
  })

  it('name the image tool by its name in the language', () => {
    const blocked = () => getT().signature.image.blocked.title(TOOL_BY_ID.image.label)
    expect(blocked()).toBe('Choose a picture with the Image button')
    setLocale('he')
    expect(blocked()).toBe('בחרו תמונה עם הלחצן "תמונה"')
  })
})
