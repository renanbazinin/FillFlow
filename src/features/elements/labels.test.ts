import { afterEach, describe, expect, it } from 'vitest'
import { getT, setLocale } from '../../i18n'
import { elementLabel } from '../../model/elements'
import { FONTS } from '../../model/fonts'
import type { Element, ImageElement, InkElement, MarkElement, ShapeElement, TextElement } from '../../model/types'
import { sizeReadout } from './lib/resize'

const base = { id: 'x', page: 0, x: 0, y: 0, width: 30, height: 20 }
const mark: MarkElement = { ...base, kind: 'mark', shape: 'check', color: '#000' }
const ink: InkElement = { ...base, kind: 'ink', strokes: [], color: '#000', strokeWidth: 2 }
const signature: ImageElement = { ...base, kind: 'image', role: 'signature', assetId: 'a', opacity: 1 }
const line: ShapeElement = { ...base, kind: 'shape', shape: 'line', strokeColor: '#000', fillColor: null, strokeWidth: 2, opacity: 1, flip: true }
const text = (value: string): TextElement => ({
  ...base,
  kind: 'text',
  text: value,
  fontId: 'sans',
  bold: false,
  fontSize: 12,
  color: '#000',
  align: 'left',
  lineHeight: 1.2,
  letterSpacing: 0,
})

/** Unicode isolates around people's text in a Hebrew sentence (bidiIsolate). */
const isolated = (s: string) => `⁨${s}⁩`

afterEach(() => setLocale('en'))

describe('item names', () => {
  it('quote what a text item says, shortened, and name the rest by kind', () => {
    expect(elementLabel(text('  Hello\n  world '))).toBe('“Hello world”')
    expect(elementLabel(text('x'.repeat(50)))).toBe(`“${'x'.repeat(40)}…”`)
    expect(elementLabel(text(' '))).toBe('Empty text')
    expect([mark, ink, signature, line].map((el: Element) => elementLabel(el))).toEqual(['Checkmark', 'Drawing', 'Signature', 'Line'])
  })

  it('are in Hebrew in a Hebrew interface, with what was typed keeping its own direction', () => {
    setLocale('he')
    expect(elementLabel(text('ישראל ישראלי'))).toBe(`"${isolated('ישראל ישראלי')}"`)
    expect(elementLabel(text('John Smith'))).toBe(`"${isolated('John Smith')}"`)
    expect(elementLabel(text(''))).toBe('טקסט ריק')
    expect([mark, ink, signature, line].map((el: Element) => elementLabel(el))).toEqual(['סימן וי', 'ציור', 'חתימה', 'קו'])
    // A component passes its own language.
    expect(elementLabel(mark, getT())).toBe('סימן וי')
  })

  it('follow a language switch: nothing is kept from the language they were first read in', () => {
    expect(FONTS.serif.label).toBe('Serif')
    setLocale('he')
    expect(FONTS.serif.label).toBe('סריף')
    expect(FONTS.sans.label).toBe('סנס')
    setLocale('en')
    expect(FONTS.mono.label).toBe('Mono')
  })
})

describe('Hebrew messages', () => {
  it('count what clearing the Items panel removes and keeps', () => {
    setLocale('he')
    const { clearBody } = getT().elements.panel
    expect(clearBody(1, 0)).toBe('הפריט שהוספתם למסמך הזה יוסר. אפשר לבטל את הפעולה.')
    expect(clearBody(3, 1)).toBe('כל 3 הפריטים שהוספתם למסמך הזה יוסרו. פריט נעול אחד יישאר. אפשר לבטל את הפעולה.')
    expect(clearBody(2, 4)).toBe('כל 2 הפריטים שהוספתם למסמך הזה יוסרו. 4 פריטים נעולים יישארו. אפשר לבטל את הפעולה.')
  })

  it('tell one locked item from several', () => {
    setLocale('he')
    const { lockedTitle, lockedBody } = getT().elements.toasts
    expect([lockedTitle(1), lockedBody(1)]).toEqual(['הפריט הזה נעול', 'בטלו את הנעילה כדי למחוק אותו.'])
    expect([lockedTitle(2), lockedBody(2)]).toEqual(['הפריטים האלה נעולים', 'בטלו את הנעילה כדי למחוק אותם.'])
  })

  it('keep the resize readout a measurement, as in English', () => {
    const readouts = (): string[] => [sizeReadout({ ...line, width: 30, height: 40 }), sizeReadout(mark), sizeReadout({ ...text('a'), fontSize: 12.25 })]
    const english = readouts()
    expect(english).toEqual(['50 pt · 53°', '30 × 20 pt', '12.3 pt'])
    setLocale('he')
    expect(readouts()).toEqual(english)
  })
})
