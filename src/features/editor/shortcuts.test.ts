import { describe, expect, it } from 'vitest'
import { TOOLS } from '../../model/tools'
import { keyLabels, orderKeys, shellCommandFor, shortcutGroups, shortcutLabel, SHORTCUTS } from './shortcuts'

const key = (k: string, mods: Partial<Record<'ctrl' | 'meta' | 'alt' | 'shift', boolean>> = {}, code = '') => ({
  key: k,
  code,
  ctrlKey: !!mods.ctrl,
  metaKey: !!mods.meta,
  altKey: !!mods.alt,
  shiftKey: !!mods.shift,
})

describe('shortcut labels', () => {
  it('orders modifiers the platform way', () => {
    expect(orderKeys(['Z', 'shift', 'mod'], true)).toEqual(['shift', 'mod', 'Z'])
    expect(orderKeys(['Z', 'shift', 'mod'], false)).toEqual(['mod', 'shift', 'Z'])
  })

  it('formats compact tooltip labels', () => {
    expect(shortcutLabel(SHORTCUTS.undo, false)).toBe('Ctrl+Z')
    expect(shortcutLabel(SHORTCUTS.redo, false)).toBe('Ctrl+Shift+Z')
    expect(shortcutLabel(SHORTCUTS.undo, true)).toBe('⌘Z')
    expect(shortcutLabel(SHORTCUTS.redo, true)).toBe('⇧⌘Z')
    expect(shortcutLabel(SHORTCUTS.zoomOut, false)).toBe('Ctrl+−')
  })

  it('renders one keycap label per key and leaves pointer actions as words', () => {
    expect(keyLabels(['mod', 'scroll'], false)).toEqual(['Ctrl', 'scroll'])
    expect(keyLabels(['shift', 'click'], true)).toEqual(['⇧', 'click'])
    expect(keyLabels(['esc'], false)).toEqual(['Esc'])
    expect(keyLabels(['t'], false)).toEqual(['T'])
  })
})

describe('shortcutGroups', () => {
  it('lists every tool that has a shortcut, plus editing, view and file groups', () => {
    const groups = shortcutGroups()
    expect(groups.map((g) => g.title)).toEqual(['Tools', 'Editing', 'View', 'File'])
    const tools = groups[0].rows.map((r) => r.label)
    expect(tools).toEqual(TOOLS.filter((t) => t.shortcut).map((t) => t.label))
    for (const g of groups) for (const r of g.rows) expect(r.combos.length).toBeGreaterThan(0)
  })

  it('offers Ctrl+Y for redo only off Apple platforms', () => {
    const redo = (mac: boolean) => shortcutGroups(mac)[1].rows.find((r) => r.label === 'Redo')!
    expect(redo(true).combos.map((c) => shortcutLabel(c, true))).toEqual(['⇧⌘Z'])
    expect(redo(false).combos.map((c) => shortcutLabel(c, false))).toEqual(['Ctrl+Shift+Z', 'Ctrl+Y'])
  })

  it('has no duplicate single-key tool shortcuts', () => {
    const keys = TOOLS.map((t) => t.shortcut).filter(Boolean)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('shellCommandFor', () => {
  it('maps the platform modifier combos', () => {
    expect(shellCommandFor(key('s', { ctrl: true }), false)).toBe('download')
    expect(shellCommandFor(key('s', { meta: true }), true)).toBe('download')
    expect(shellCommandFor(key('S', { ctrl: true }), false)).toBe('download')
    expect(shellCommandFor(key('o', { ctrl: true }), false)).toBe('open')
    // Wrong modifier for the platform does nothing.
    expect(shellCommandFor(key('s', { meta: true }), false)).toBeNull()
    expect(shellCommandFor(key('s', { ctrl: true }), true)).toBeNull()
  })

  it('finds S and O on any keyboard layout', () => {
    // Hebrew: the S and O keys type ד and ם, so the physical key counts.
    expect(shellCommandFor(key('ד', { ctrl: true }, 'KeyS'), false)).toBe('download')
    expect(shellCommandFor(key('ם', { ctrl: true }, 'KeyO'), false)).toBe('open')
    expect(shellCommandFor(key('ד', { meta: true }, 'KeyS'), true)).toBe('download')
    expect(shellCommandFor(key('ם', { meta: true }, 'KeyO'), true)).toBe('open')
    expect(shellCommandFor(key('ם', { ctrl: true, shift: true }, 'KeyO'), false)).toBeNull()
    // Latin layouts go by the letter typed: Dvorak and Colemak type R on the O and S keys, and
    // Ctrl/⌘+R stays the browser's reload.
    expect(shellCommandFor(key('r', { ctrl: true }, 'KeyO'), false)).toBeNull()
    expect(shellCommandFor(key('r', { ctrl: true }, 'KeyS'), false)).toBeNull()
    expect(shellCommandFor(key('r', { meta: true }, 'KeyO'), true)).toBeNull()
    expect(shellCommandFor(key('o', { ctrl: true }, 'KeyS'), false)).toBe('open')
    expect(shellCommandFor(key('s', { meta: true }, 'Semicolon'), true)).toBe('download')
  })

  it('handles zoom keys on main and numeric keypads', () => {
    expect(shellCommandFor(key('=', { ctrl: true }), false)).toBe('zoomIn')
    expect(shellCommandFor(key('+', { ctrl: true, shift: true }), false)).toBe('zoomIn')
    expect(shellCommandFor(key('+', { ctrl: true }, 'NumpadAdd'), false)).toBe('zoomIn')
    expect(shellCommandFor(key('-', { ctrl: true }), false)).toBe('zoomOut')
    expect(shellCommandFor(key('0', { meta: true }, 'Digit0'), true)).toBe('fitWidth')
  })

  it('opens help with a bare ?', () => {
    expect(shellCommandFor(key('?', { shift: true }), false)).toBe('help')
    expect(shellCommandFor(key('?', { ctrl: true, shift: true }), false)).toBeNull()
  })

  it('ignores plain letters and alt combos', () => {
    expect(shellCommandFor(key('s'), false)).toBeNull()
    expect(shellCommandFor(key('s', { ctrl: true, alt: true }), false)).toBeNull()
    expect(shellCommandFor(key('s', { ctrl: true, shift: true }), false)).toBeNull()
  })
})
