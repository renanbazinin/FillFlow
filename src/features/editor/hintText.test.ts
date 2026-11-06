import { afterEach, describe, expect, it } from 'vitest'
import { setLocale } from '../../i18n'
import { TOOLS } from '../../model/tools'
import { toolHint, type KeyHelp } from './hintText'

/** "Enter to add · Esc to finish", as the chip shows it. */
const keyLine = (keys: KeyHelp[] | undefined) => keys?.map((k) => `${k.key} ${k.action}`).join(' · ')

describe('toolHint', () => {
  it('shows nothing for select and pan', () => {
    expect(toolHint('select', { armed: false, touch: false })).toBeNull()
    expect(toolHint('hand', { armed: false, touch: false })).toBeNull()
  })

  it("uses the tool's hint, with Enter to add one and Esc to finish, on desktop", () => {
    expect(toolHint('text', { armed: false, touch: false })).toEqual({
      text: 'Click anywhere to type',
      keys: [
        { key: 'Enter', action: 'to add' },
        { key: 'Esc', action: 'to finish' },
      ],
    })
    // Clicked or dragged out, every other tool's item can be added with Enter too.
    for (const t of TOOLS.filter((t) => t.placement === 'click' || t.placement === 'drag')) {
      if (t.id === 'signature' || t.id === 'initials' || t.id === 'image') continue
      expect(keyLine(toolHint(t.id, { armed: false, touch: false })?.keys), t.id).toBe('Enter to add · Esc to finish')
    }
    // A drawing can't be.
    expect(keyLine(toolHint('ink', { armed: false, touch: false })?.keys)).toBe('Esc to finish')
  })

  it('offers Enter for a signature, initials or picture only once there is one to place', () => {
    for (const tool of ['signature', 'initials', 'image'] as const) {
      expect(keyLine(toolHint(tool, { armed: false, touch: false })?.keys), tool).toBe('Esc to finish')
      expect(keyLine(toolHint(tool, { armed: true, touch: false })?.keys), tool).toBe('Enter to place · Esc to cancel')
    }
  })

  it('every creation tool has a hint', () => {
    for (const t of TOOLS.filter((t) => t.placement !== 'none')) {
      expect(toolHint(t.id, { armed: false, touch: false })?.text).toBeTruthy()
    }
  })

  it('asks to place an armed signature / initials / image', () => {
    const hint = toolHint('signature', { armed: true, touch: false })
    expect(hint?.text).toBe('Click to place your signature')
    expect(keyLine(hint?.keys)).toBe('Enter to place · Esc to cancel')
    expect(toolHint('initials', { armed: true, touch: false })?.text).toBe('Click to place your initials')
    expect(toolHint('image', { armed: true, touch: false })?.text).toBe('Click to place the image')
    // "armed" only matters for asset tools
    expect(toolHint('text', { armed: true, touch: false })?.text).toBe('Click anywhere to type')
  })

  it('speaks touch on touch screens and drops keyboard advice', () => {
    expect(toolHint('text', { armed: false, touch: true })).toEqual({ text: 'Tap anywhere to type', keys: [] })
    expect(toolHint('image', { armed: true, touch: true })).toEqual({ text: 'Tap to place the image', keys: [] })
    // Hints without a click in them stay as they are.
    expect(toolHint('line', { armed: false, touch: true })?.text).toBe('Drag to draw a line (Shift snaps to 45°)')
  })

  describe('in Hebrew', () => {
    afterEach(() => setLocale('en'))

    it('says what to do and what each key does in Hebrew, keys as they are', () => {
      setLocale('he')
      expect(toolHint('text', { armed: false, touch: false })).toEqual({
        text: 'לחצו במקום כלשהו כדי להקליד',
        keys: [
          { key: 'Enter', action: 'להוספה' },
          { key: 'Esc', action: 'לסיום' },
        ],
      })
      expect(toolHint('ink', { armed: false, touch: false })?.keys).toEqual([{ key: 'Esc', action: 'לסיום' }])
      expect(toolHint('signature', { armed: true, touch: false })).toEqual({
        text: 'לחצו כדי למקם את החתימה שלכם',
        keys: [
          { key: 'Enter', action: 'למיקום' },
          { key: 'Esc', action: 'לביטול' },
        ],
      })
    })

    it('says "tap" (הקישו) on touch screens', () => {
      setLocale('he')
      expect(toolHint('text', { armed: false, touch: true })).toEqual({ text: 'הקישו במקום כלשהו כדי להקליד', keys: [] })
      expect(toolHint('initials', { armed: true, touch: true })?.text).toBe('הקישו כדי למקם את ראשי התיבות שלכם')
    })

    it('follows the language as it changes', () => {
      setLocale('he')
      expect(toolHint('image', { armed: true, touch: false })?.text).toBe('לחצו כדי למקם את התמונה')
      setLocale('en')
      expect(toolHint('image', { armed: true, touch: false })?.text).toBe('Click to place the image')
    })
  })
})
