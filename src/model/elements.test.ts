import { describe, expect, it } from 'vitest'
import type { TextMeasurer } from '../lib/text/layout'
import { createTextElement, DEFAULT_STYLES, defaultDateFormat, keepTextInPage, withTextLayout } from './elements'
import type { TextAlign, TextElement } from './types'

// Every UTF-16 unit is half an em wide: 6pt at 12pt.
const measure: TextMeasurer = (text, _f, _b, size) => text.length * size * 0.5
const page = { width: 600, height: 800 }

/** A one-line block of `chars` characters (6pt each) at x, y. */
function block(x: number, y: number, chars: number, align: TextAlign = 'left'): TextElement {
  return { ...createTextElement(0, { x, y }, DEFAULT_STYLES.text, 'x'.repeat(chars), measure), align }
}

/** `el` with its text grown to `chars` characters, laid out again as the store does. */
function grown(el: TextElement, chars: number): TextElement {
  return withTextLayout({ ...el, text: 'x'.repeat(chars) }, measure)
}

describe('createTextElement', () => {
  it('starts with the alignment picked last for new text', () => {
    expect(createTextElement(0, { x: 0, y: 0 }, { ...DEFAULT_STYLES.text, align: 'right' }, '', measure).align).toBe('right')
  })
})

describe('defaultDateFormat', () => {
  it('puts the month first only for US-style English and Filipino browsers', () => {
    expect(defaultDateFormat(['en-US'], 'America/New_York')).toBe('MM/dd/yyyy')
    expect(defaultDateFormat(['en-US', 'en'], 'America/New_York')).toBe('MM/dd/yyyy')
    expect(defaultDateFormat(['fil-PH'], 'Asia/Manila')).toBe('MM/dd/yyyy')
    expect(defaultDateFormat(['en-GB'], 'America/New_York')).toBe('dd/MM/yyyy')
    expect(defaultDateFormat(['en-GB'], 'Europe/London')).toBe('dd/MM/yyyy')
    expect(defaultDateFormat(['fr-FR', 'en-US'], 'Europe/Paris')).toBe('dd/MM/yyyy')
    expect(defaultDateFormat([], '')).toBe('dd/MM/yyyy')
  })

  it('puts the day first in Israel, and for people who also read Hebrew or Arabic, whatever the browser’s language', () => {
    // Chrome in English reports en-US, also in Israel.
    expect(defaultDateFormat(['en-US'], 'Asia/Jerusalem')).toBe('dd/MM/yyyy')
    expect(defaultDateFormat(['en-US'], 'Asia/Tel_Aviv')).toBe('dd/MM/yyyy')
    expect(defaultDateFormat(['en-US'], 'Asia/Hebron')).toBe('dd/MM/yyyy')
    expect(defaultDateFormat(['en-US', 'he'], 'America/New_York')).toBe('dd/MM/yyyy')
    expect(defaultDateFormat(['en-US', 'he'], 'Europe/London')).toBe('dd/MM/yyyy')
    expect(defaultDateFormat(['en-US', 'iw'], 'America/New_York')).toBe('dd/MM/yyyy')
    expect(defaultDateFormat(['en-US', 'ar-EG'], 'America/New_York')).toBe('dd/MM/yyyy')
    expect(defaultDateFormat(['he-IL'], 'Asia/Jerusalem')).toBe('dd/MM/yyyy')
  })
})

describe('keepTextInPage', () => {
  it('moves a block away from the edge it grows into, whichever side it grows from', () => {
    // Left-aligned, 10pt from the right edge, 30pt wider: it moves left by 20pt.
    const left = block(540, 100, 8)
    expect(keepTextInPage(grown(left, 13), left, page)).toMatchObject({ x: 600 - 78, width: 78 })
    // Right-aligned, 10pt from the left edge: it moves right.
    const right = block(10, 100, 8, 'right')
    expect(keepTextInPage(grown(right, 13), right, page)).toMatchObject({ x: 0, width: 78 })
    // Centered, near the right edge.
    const center = block(500, 100, 15, 'center')
    expect(keepTextInPage(grown(center, 25), center, page)).toMatchObject({ x: 600 - 150, width: 150 })
    // Lines added at the bottom push it up.
    const low = block(100, 780, 4)
    const taller = withTextLayout({ ...low, text: 'xxxx\nxxxx\nxxxx' }, measure)
    expect(keepTextInPage(taller, low, page).y).toBeCloseTo(800 - 3 * 14.4)
  })

  it('leaves a block that fits where it is', () => {
    const el = block(100, 100, 8)
    const more = grown(el, 20)
    expect(keepTextInPage(more, el, page)).toBe(more)
  })

  it('keeps the side a block too big for the page grows from on the page', () => {
    expect(keepTextInPage(grown(block(10, 100, 1), 150), block(10, 100, 1), page)).toMatchObject({ x: 0, width: 900 })
    const right = block(10, 100, 1, 'right')
    expect(keepTextInPage(grown(right, 150), right, page)).toMatchObject({ x: 600 - 900 })
    const center = block(300, 100, 1, 'center')
    expect(keepTextInPage(grown(center, 150), center, page)).toMatchObject({ x: (600 - 900) / 2 })
    // Taller than the page: its top stays on the page.
    const tall = withTextLayout({ ...block(100, 500, 1), text: Array(60).fill('x').join('\n') }, measure)
    expect(keepTextInPage(tall, block(100, 500, 1), page)).toMatchObject({ y: 0 })
  })

  it('lets a block that already stuck out stay as far out as it was, but no further', () => {
    // 14pt past the right edge (saved by an older version).
    const old = block(560, 100, 9)
    expect(keepTextInPage(grown(old, 10), old, page)).toMatchObject({ x: 554, width: 60 })
    expect(keepTextInPage(grown(old, 5), old, page)).toMatchObject({ x: 560, width: 30 })
    // 20pt above the top edge.
    const high = block(100, -20, 4)
    expect(keepTextInPage(withTextLayout({ ...high, text: 'xxxx\nxxxx' }, measure), high, page).y).toBe(-20)
  })
})
