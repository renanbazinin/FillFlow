import { describe, expect, it } from 'vitest'
import { PAD_MIN_HEIGHT, padRoom } from './fit'

describe('padRoom', () => {
  // The Draw tab as it opened on a phone held sideways (844 × 390): a 207px pad in a dialog at its
  // tallest (92% of the screen), with 141px of header and footer and a scroll area showing 218px.
  const sideways = { dialogMax: 358.8, dialog: 359, scrollClient: 218, scrollPadding: 28, tabs: 299, pad: 207 }

  it('shrinks the pad until the tab fits in the dialog', () => {
    const room = padRoom(sideways)
    // 190px of the scroll area to show it in, 92 of them taken by the tab row and the controls.
    expect(room).toBe(97)
    // Laid out again with the pad that tall, the tab fits (the dialog is just under its limit) and
    // the pad stays as it is.
    expect(padRoom({ ...sideways, dialog: 358, scrollClient: 217, tabs: sideways.tabs - 207 + room, pad: room })).toBe(room)
  })

  it('counts the room a dialog that fits still has to grow', () => {
    // 1024 × 600: the dialog (472px) is under its limit (552px).
    const room = padRoom({ dialogMax: 552, dialog: 472, scrollClient: 331, scrollPadding: 28, tabs: 299, pad: 207 })
    expect(room).toBe(291)
  })

  it('never makes the pad too small to sign in', () => {
    expect(padRoom({ ...sideways, dialogMax: 200 })).toBe(PAD_MIN_HEIGHT)
  })
})
