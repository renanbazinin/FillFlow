import { describe, expect, it } from 'vitest'
import { TOOLS } from '../../model/tools'
import { toolHint } from './hintText'

describe('toolHint', () => {
  it('shows nothing for select and pan', () => {
    expect(toolHint('select', { armed: false, touch: false })).toBeNull()
    expect(toolHint('hand', { armed: false, touch: false })).toBeNull()
  })

  it("uses the tool's hint with an Esc exit on desktop", () => {
    expect(toolHint('text', { armed: false, touch: false })).toEqual({ text: 'Click anywhere to type', exit: 'Esc to finish' })
  })

  it('every creation tool has a hint', () => {
    for (const t of TOOLS.filter((t) => t.placement !== 'none')) {
      expect(toolHint(t.id, { armed: false, touch: false })?.text).toBeTruthy()
    }
  })

  it('asks to place an armed signature / initials / image', () => {
    expect(toolHint('signature', { armed: true, touch: false })).toEqual({ text: 'Click to place your signature', exit: 'Esc to cancel' })
    expect(toolHint('initials', { armed: true, touch: false })?.text).toBe('Click to place your initials')
    expect(toolHint('image', { armed: true, touch: false })?.text).toBe('Click to place the image')
    // "armed" only matters for asset tools
    expect(toolHint('text', { armed: true, touch: false })?.text).toBe('Click anywhere to type')
  })

  it('speaks touch on touch screens and drops keyboard advice', () => {
    expect(toolHint('text', { armed: false, touch: true })).toEqual({ text: 'Tap anywhere to type', exit: null })
    expect(toolHint('image', { armed: true, touch: true })?.text).toBe('Tap to place the image')
  })
})
