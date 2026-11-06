import type { LucideIcon } from 'lucide-react'
import { getT, type Messages } from '../../i18n'
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

/** What the pointer does in a combination; shown as a word in the interface language. */
export type PointerAction = keyof Messages['editor']['shortcuts']['pointer']

export const POINTER_ACTIONS = new Set<string>(['click', 'double-click', 'right-click', 'drag', 'scroll', 'pinch'] satisfies PointerAction[])

export function isPointerAction(key: string): key is PointerAction {
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
 * Everything shown in the shortcuts dialog, in the interface language (`t`: the current one when
 * not given). Editing keys mirror `useEditingShortcuts`, view keys the viewer, file keys
 * `useShellShortcuts`.
 */
export function shortcutGroups(mac = isMac, t: Messages = getT()): ShortcutGroup[] {
  const { groups, rows: r } = t.editor.shortcuts
  return [
    {
      title: groups.tools,
      rows: TOOLS.filter((tool) => tool.shortcut).map((tool) => ({
        label: t.tools[tool.id].label,
        combos: [[tool.shortcut!]],
        icon: tool.icon,
      })),
    },
    {
      title: groups.editing,
      rows: [
        { label: r.undo, combos: [SHORTCUTS.undo] },
        { label: r.redo, combos: mac ? [SHORTCUTS.redo] : [SHORTCUTS.redo, SHORTCUTS.redoAlt] },
        { label: r.copy, combos: [['mod', 'C']] },
        { label: r.cut, combos: [['mod', 'X']] },
        { label: r.paste, combos: [['mod', 'V']] },
        { label: r.duplicate, combos: [['mod', 'D']] },
        { label: r.delete, combos: [['delete'], ['backspace']] },
        { label: r.selectAll, combos: [['mod', 'A']] },
        { label: r.addToSelection, combos: [['shift', 'click']] },
        { label: r.addInView, combos: [['enter']] },
        { label: r.nudge, combos: [['←', '↑', '→', '↓']] },
        { label: r.editText, combos: [['enter'], ['double-click']] },
        { label: r.finishText, combos: [['esc'], ['mod', 'enter']] },
        { label: r.bold, combos: [['mod', 'B']] },
        { label: r.toFront, combos: [['mod', ']']] },
        { label: r.toBack, combos: [['mod', '[']] },
        { label: r.lock, combos: [['mod', 'shift', 'L']] },
        { label: r.deselect, combos: [['esc']] },
        { label: r.keepTool, combos: [['double-click']] },
        { label: r.itemMenu, combos: [['right-click']] },
        { label: r.proportions, combos: [['shift', 'drag']] },
        { label: r.noSnap, combos: [['alt', 'drag']] },
        { label: r.cancelDrag, combos: [['esc']] },
      ],
    },
    {
      title: groups.view,
      rows: [
        { label: r.zoomIn, combos: [SHORTCUTS.zoomIn] },
        { label: r.zoomOut, combos: [SHORTCUTS.zoomOut] },
        { label: r.fitWidth, combos: [SHORTCUTS.fitWidth] },
        { label: r.zoom, combos: [['mod', 'scroll'], ['pinch']] },
        { label: r.pan, combos: [['space', 'drag']] },
      ],
    },
    {
      title: groups.file,
      rows: [
        { label: r.download, combos: [SHORTCUTS.download] },
        { label: r.open, combos: [SHORTCUTS.open] },
        { label: r.shortcuts, combos: [SHORTCUTS.help] },
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
