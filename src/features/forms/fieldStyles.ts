import type { CSSProperties } from 'react'
import type { QuarterTurn } from '../../lib/pdf/formFields'
import { cn } from '../../lib/utils/misc'
import type { Rect } from '../../model/types'

/**
 * On-page field visuals. Pages are always white paper, so these use the fixed on-page colors
 * (bg-field, field-border, selection…) that don't change with the app theme, nor with forced
 * colors (the page opts out of them: see index.css).
 */

export interface FieldState {
  interactive: boolean
  active: boolean
  filled: boolean
  required: boolean
  readOnly?: boolean
}

/** Box styling shared by text, choice, check box and radio controls. */
export function fieldBoxClass({ interactive, active, filled, required, readOnly }: FieldState, focusMode: 'within' | 'visible' = 'within') {
  if (readOnly) return 'absolute'
  return cn(
    'absolute transition-[background-color,box-shadow,outline-color] duration-100 [color-scheme:light]',
    filled ? 'bg-field/50' : 'bg-field',
    required && !filled
      ? 'shadow-[inset_0_0_0_1px_var(--color-field-required)]'
      : 'shadow-[inset_0_0_0_1px_var(--color-field-border)]',
    interactive && 'pointer-events-auto hover:bg-field-hover',
    // Focus (and "active" = selected in the form panel): 2px selection ring + stronger fill.
    'outline-0 outline-offset-1 outline-selection',
    focusMode === 'within'
      ? 'focus-within:bg-field-hover focus-within:outline-2'
      : 'focus-visible:bg-field-hover focus-visible:outline-2',
    active && 'bg-field-hover outline-2',
  )
}

/** Absolute placement of a widget rect at `scale` CSS px per point. */
export function rectStyle(rect: Rect, scale: number): CSSProperties {
  return {
    left: rect.x * scale,
    top: rect.y * scale,
    width: rect.width * scale,
    height: rect.height * scale,
  }
}

/** The text frame of a widget in points: the rect, with sides swapped for quarter turns. */
export function frameRect(rect: Rect, rotation: QuarterTurn): Rect {
  const swap = rotation === 90 || rotation === 270
  return { x: 0, y: 0, width: swap ? rect.height : rect.width, height: swap ? rect.width : rect.height }
}

/** Places the (possibly turned) text frame inside the widget box. */
export function frameStyle(rect: Rect, scale: number, rotation: QuarterTurn): CSSProperties {
  if (!rotation) return { position: 'absolute', inset: 0 }
  const frame = frameRect(rect, rotation)
  const w = frame.width * scale
  const h = frame.height * scale
  return {
    position: 'absolute',
    left: (rect.width * scale - w) / 2,
    top: (rect.height * scale - h) / 2,
    width: w,
    height: h,
    transform: `rotate(${-rotation}deg)`,
  }
}
