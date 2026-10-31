import type { LucideIcon } from 'lucide-react'
import { isMac } from '../../lib/utils/misc'
import { TOOLS } from '../../model/tools'
import { shortcutLetter } from '../elements/lib/keys'

/**
 * Key names used in shortcut definitions: 'mod' (⌘ / Ctrl), 'shift', 'alt', named keys
 * ('esc', 'enter', 'delete', 'backspace', 'space'), single characters (incl. arrows), and pointer
 * actions ('click', 'double-click', 'right-click', 'drag', 'scroll'), which render as words, not keycaps.
 */
export type KeyCombo = string[]

const MODIFIER_ORDER_MAC = ['ctrl', 'alt', 'shift', 'mod']
const MODIFIER_ORDER_PC = ['mod', 'ctrl', 'alt', 'shift']
export const POINTER_ACTIONS = new Set(['click', 'double-click', 'right-click', 'drag', 'scroll', 'pinch'])

export function isPointerAction(key: string): boolean {
  return POINTER_ACTIONS.has(key)
}

function keyLabel(key: string, mac: boolean): string {
  switch (key) {
    case 'mod':
      return mac ? '⌘' : 'Ctrl'
    case 'ctrl':
      return mac ? '⌃' : 'Ctrl'
    case 'shift':
      return mac ? '⇧' : 'Shift'
    case 'alt':
      return mac ? '⌥' : 'Alt'
    case 'esc':
      return 'Esc'
    case 'enter':
      return mac ? '↩' : 'Enter'
    case 'delete':
      return mac ? '⌦' : 'Del'
    case 'backspace':
      return mac ? '⌫' : 'Backspace'
    case 'space':
      return 'Space'
    case '-':
      return '−'
    default:
      return key.length === 1 ? key.toUpperCase() : key
  }
}

/** Orders modifiers the platform way (⌃⌥⇧⌘ on Apple, Ctrl+Alt+Shift elsewhere). */
export function orderKeys(keys: KeyCombo, mac = isMac): KeyCombo {
  const order = mac ? MODIFIER_ORDER_MAC : MODIFIER_ORDER_PC
  const mods = keys.filter((k) => order.includes(k)).sort((a, b) => order.indexOf(a) - order.indexOf(b))
  return [...mods, ...keys.filter((k) => !order.includes(k))]
}

/** One display label per key, in platform order (for rendering keycaps). */
export function keyLabels(keys: KeyCombo, mac = isMac): string[] {
  return orderKeys(keys, mac).map((k) => keyLabel(k, mac))
}

/** Compact label for tooltips: "Ctrl+Shift+Z" / "⇧⌘Z". */
export function shortcutLabel(keys: KeyCombo, mac = isMac): string {
  const labels = keyLabels(keys, mac)
  return mac ? labels.join('') : labels.join('+')
}

export interface ShortcutRow {
  label: string
  /** Alternatives, e.g. Redo = ⌘⇧Z or ⌘Y. */
  combos: KeyCombo[]
  icon?: LucideIcon
}

export interface ShortcutGroup {
  title: string
  rows: ShortcutRow[]
}

export const SHORTCUTS = {
  undo: ['mod', 'Z'],
  redo: ['mod', 'shift', 'Z'],
  /** Windows/Linux only. */
  redoAlt: ['ctrl', 'Y'],
  download: ['mod', 'S'],
  open: ['mod', 'O'],
  zoomIn: ['mod', '+'],
  zoomOut: ['mod', '-'],
  fitWidth: ['mod', '0'],
  help: ['?'],
} satisfies Record<string, KeyCombo>

/**
 * Everything shown in the shortcuts dialog. Editing keys mirror `useEditingShortcuts`, view keys
 * the viewer, file keys `useShellShortcuts`.
 */
export function shortcutGroups(mac = isMac): ShortcutGroup[] {
  return [
    {
      title: 'Tools',
      rows: TOOLS.filter((t) => t.shortcut).map((t) => ({ label: t.label, combos: [[t.shortcut!]], icon: t.icon })),
    },
    {
      title: 'Editing',
      rows: [
        { label: 'Undo', combos: [SHORTCUTS.undo] },
        { label: 'Redo', combos: mac ? [SHORTCUTS.redo] : [SHORTCUTS.redo, SHORTCUTS.redoAlt] },
        { label: 'Copy', combos: [['mod', 'C']] },
        { label: 'Cut', combos: [['mod', 'X']] },
        { label: 'Paste', combos: [['mod', 'V']] },
        { label: 'Duplicate', combos: [['mod', 'D']] },
        { label: 'Delete', combos: [['delete'], ['backspace']] },
        { label: 'Select all on the page', combos: [['mod', 'A']] },
        { label: 'Add to selection', combos: [['shift', 'click']] },
        { label: 'Nudge (Shift for 10 pt)', combos: [['←', '↑', '→', '↓']] },
        { label: 'Edit text', combos: [['enter'], ['double-click']] },
        { label: 'Finish editing text', combos: [['esc'], ['mod', 'enter']] },
        { label: 'Bold text', combos: [['mod', 'B']] },
        { label: 'Bring to front', combos: [['mod', ']']] },
        { label: 'Send to back', combos: [['mod', '[']] },
        { label: 'Lock / unlock', combos: [['mod', 'shift', 'L']] },
        { label: 'Done / deselect', combos: [['esc']] },
        { label: 'Keep a tool on', combos: [['double-click']] },
        { label: 'Item menu', combos: [['right-click']] },
        { label: 'Keep proportions, 45° lines', combos: [['shift', 'drag']] },
        { label: 'Move without snapping', combos: [['alt', 'drag']] },
        { label: 'Cancel a drag', combos: [['esc']] },
      ],
    },
    {
      title: 'View',
      rows: [
        { label: 'Zoom in', combos: [SHORTCUTS.zoomIn] },
        { label: 'Zoom out', combos: [SHORTCUTS.zoomOut] },
        { label: 'Fit to width', combos: [SHORTCUTS.fitWidth] },
        { label: 'Zoom', combos: [['mod', 'scroll'], ['pinch']] },
        { label: 'Pan', combos: [['space', 'drag']] },
      ],
    },
    {
      title: 'File',
      rows: [
        { label: 'Download PDF', combos: [SHORTCUTS.download] },
        { label: 'Open another PDF', combos: [SHORTCUTS.open] },
        { label: 'Keyboard shortcuts', combos: [SHORTCUTS.help] },
      ],
    },
  ]
}

// --- Shell commands (handled by useShellShortcuts) ----------------------------

export type ShellCommand = 'download' | 'open' | 'help' | 'zoomIn' | 'zoomOut' | 'fitWidth'

type KeyLike = Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>

/**
 * Maps a keydown to a shell command (pure; see shortcuts.test.ts). Letters go by the layout's own
 * Latin letter, or by physical key on non-Latin layouts, where the browser's ⌘/Ctrl+S and O would
 * otherwise take over.
 */
export function shellCommandFor(e: KeyLike, mac: boolean): ShellCommand | null {
  const mod = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey
  if (mod && !e.altKey) {
    const k = e.key.toLowerCase()
    const letter = shortcutLetter(e)
    if (letter === 's' && !e.shiftKey) return 'download'
    if (letter === 'o' && !e.shiftKey) return 'open'
    if (k === '=' || k === '+' || e.code === 'NumpadAdd') return 'zoomIn'
    if (k === '-' || k === '_' || e.code === 'NumpadSubtract') return 'zoomOut'
    if ((k === '0' || e.code === 'Digit0' || e.code === 'Numpad0') && !e.shiftKey) return 'fitWidth'
    return null
  }
  if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key === '?') return 'help'
  return null
}
