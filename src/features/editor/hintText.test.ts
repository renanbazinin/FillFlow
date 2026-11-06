import { describe, expect, it } from 'vitest'
import { TOOLS } from '../../model/tools'
import { toolHint } from './hintText'

describe('toolHint', () => {
  it('shows nothing for select and pan', () => {
    expect(toolHint('select', { armed: false, touch: false })).toBeNull()
    expect(toolHint('hand', { armed: false, touch: false })).toBeNull()
  })

  it("uses the tool's hint, with Enter to add one and Esc to finish, on desktop", () => {
    expect(toolHint('text', { armed: false, touch: false })).toEqual({ text: 'Click anywhere to type', exit: 'Enter to add · Esc to finish' })
    // Clicked or dragged out, every other tool's item can be added with Enter too.
    for (const t of TOOLS.filter((t) => t.placement === 'click' || t.placement === 'drag')) {
      if (t.id === 'signature' || t.id === 'initials' || t.id === 'image') continue
      expect(toolHint(t.id, { armed: false, touch: false })?.exit, t.id).toBe('Enter to add · Esc to finish')
    }
    // A drawing can't be.
    expect(toolHint('ink', { armed: false, touch: false })?.exit).toBe('Esc to finish')
  })

  it('offers Enter for a signature, initials or picture only once there is one to place', () => {
    for (const tool of ['signature', 'initials', 'image'] as const) {
      expect(toolHint(tool, { armed: false, touch: false })?.exit, tool).toBe('Esc to finish')
      expect(toolHint(tool, { armed: true, touch: false })?.exit, tool).toBe('Enter to place · Esc to cancel')
    }
  })

  it('every creation tool has a hint', () => {
    for (const t of TOOLS.filter((t) => t.placement !== 'none')) {
      expect(toolHint(t.id, { armed: false, touch: false })?.text).toBeTruthy()
    }
  })

  it('asks to place an armed signature / initials / image', () => {
    expect(toolHint('signature', { armed: true, touch: false })).toEqual({ text: 'Click to place your signature', exit: 'Enter to place · Esc to cancel' })
    expect(toolHint('initials', { armed: true, touch: false })?.text).toBe('Click to place your initials')
    expect(toolHint('image', { armed: true, touch: false })?.text).toBe('Click to place the image')
    // "armed" only matters for asset tools
    expect(toolHint('text', { armed: true, touch: false })?.text).toBe('Click anywhere to type')
  })

  it('speaks touch on touch screens and drops keyboard advice', () => {
    expect(toolHint('text', { armed: false, touch: true })).toEqual({ text: 'Tap anywhere to type', exit: null })
    expect(toolHint('image', { armed: true, touch: true })).toEqual({ text: 'Tap to place the image', exit: null })
  })
})
