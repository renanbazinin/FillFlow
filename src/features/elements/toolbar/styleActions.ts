import { DEFAULT_STYLES, HIGHLIGHT_COLOR, WHITEOUT_COLOR } from '../../../model/elements'
import type { Element, ElementKind, ElementPatch, MarkShape, ShapeElement, TextElement } from '../../../model/types'
import { getSelectedElements, useEditor } from '../../../store/editor'
import { restyleInkWidth } from '../lib/ink'
import { markRect } from '../lib/placement'
import { pageSize } from '../state/commands'

/**
 * Style edits from the context toolbar. They apply to every selected element of the kind (one
 * undo step; repeated slider/stepper changes on the same items coalesce) and update the style
 * defaults so the next new item matches. Locked items keep their size: mark size, font size
 * and pen width skip them.
 */

type OfKind<K extends ElementKind> = Extract<Element, { kind: K }>

interface PatchOptions {
  /** Merges repeated changes (to the same items) into one undo step. */
  coalesce?: string
  /** Leave locked elements alone (the change would move or resize them). */
  skipLocked?: boolean
}

function patchSelection<K extends ElementKind>(kind: K, make: (el: OfKind<K>) => ElementPatch | null, opts?: PatchOptions): void {
  const s = useEditor.getState()
  const patches: Record<string, ElementPatch> = {}
  for (const el of getSelectedElements(s)) {
    if (el.kind !== kind || (opts?.skipLocked && el.locked)) continue
    const p = make(el as OfKind<K>)
    if (p) patches[el.id] = p
  }
  const ids = Object.keys(patches)
  if (!ids.length) return
  // Only changes to the same items merge into one undo step.
  const coalesce = opts?.coalesce && `${opts.coalesce}:${ids.sort().join(',')}`
  s.updateElements(patches, coalesce ? { coalesce } : undefined)
}

export type TextStylePatch = Partial<Pick<TextElement, 'fontId' | 'fontSize' | 'bold' | 'color' | 'align' | 'letterSpacing' | 'lineHeight'>>

export function setTextStyle(patch: TextStylePatch, coalesce?: string): void {
  patchSelection('text', () => patch, { coalesce, skipLocked: patch.fontSize !== undefined })
  const defaults: Partial<typeof DEFAULT_STYLES.text> = {}
  if (patch.fontId !== undefined) defaults.fontId = patch.fontId
  if (patch.fontSize !== undefined) defaults.fontSize = patch.fontSize
  if (patch.bold !== undefined) defaults.bold = patch.bold
  if (patch.color !== undefined) defaults.color = patch.color
  if (patch.align !== undefined) defaults.align = patch.align
  if (Object.keys(defaults).length) useEditor.getState().setStyle('text', defaults)
}

export function toggleBold(): void {
  const texts = getSelectedElements().filter((e): e is TextElement => e.kind === 'text')
  if (!texts.length) return
  setTextStyle({ bold: !texts.every((t) => t.bold) })
}

export function setMarkShape(shape: MarkShape): void {
  // `shape` exists on marks and shapes with different types, so ElementPatch can't express it.
  patchSelection('mark', () => ({ shape }) as unknown as ElementPatch)
}

export function setMarkColor(color: string): void {
  patchSelection('mark', () => ({ color }), { coalesce: 'style:mark-color' })
  useEditor.getState().setStyle('mark', { color })
}

/** Resizes marks around their centers. */
export function setMarkSize(size: number): void {
  patchSelection(
    'mark',
    (el) => {
      const page = pageSize(el.page)
      if (!page) return null
      const r = markRect({ x: el.x + el.width / 2, y: el.y + el.height / 2 }, size, page)
      return { x: r.x, y: r.y, width: r.width, height: r.height }
    },
    { coalesce: 'style:mark-size', skipLocked: true },
  )
  useEditor.getState().setStyle('mark', { size })
}

/** Highlight / whiteout presets don't feed the shape defaults. */
export function isPresetShape(el: ShapeElement): boolean {
  return (el.fillColor === HIGHLIGHT_COLOR || el.fillColor === WHITEOUT_COLOR) && el.strokeColor === null
}

function selectedShapes(): ShapeElement[] {
  return getSelectedElements().filter((e): e is ShapeElement => e.kind === 'shape')
}

function feedsDefaults(): boolean {
  return selectedShapes().some((e) => !isPresetShape(e))
}

/** `null` removes the stroke (lines always keep one). Re-adding a stroke restores a usable width. */
export function setShapeStroke(color: string | null): void {
  const fallback = useEditor.getState().styles.shape.strokeWidth || DEFAULT_STYLES.shape.strokeWidth
  const updateDefaults = feedsDefaults()
  patchSelection(
    'shape',
    (el) => {
      if (color === null) return el.shape === 'line' ? null : { strokeColor: null, strokeWidth: 0 }
      return { strokeColor: color, strokeWidth: el.strokeWidth > 0 ? el.strokeWidth : fallback }
    },
    { coalesce: 'style:stroke-color' },
  )
  if (color && updateDefaults) useEditor.getState().setStyle('shape', { strokeColor: color })
}

export function setShapeFill(color: string | null): void {
  const updateDefaults = feedsDefaults()
  patchSelection('shape', (el) => (el.shape === 'line' ? null : { fillColor: color }), { coalesce: 'style:fill-color' })
  if (updateDefaults) useEditor.getState().setStyle('shape', { fillColor: color })
}

export function setShapeStrokeWidth(strokeWidth: number): void {
  const updateDefaults = feedsDefaults()
  patchSelection('shape', (el) => (el.strokeColor === null ? null : { strokeWidth }), { coalesce: 'style:stroke-width' })
  if (updateDefaults) useEditor.getState().setStyle('shape', { strokeWidth })
}

export function setShapeOpacity(opacity: number): void {
  patchSelection('shape', () => ({ opacity }), { coalesce: 'style:shape-opacity' })
}

export function setInkColor(color: string): void {
  patchSelection('ink', () => ({ color }), { coalesce: 'style:ink-color' })
  useEditor.getState().setStyle('ink', { color })
}

export function setInkWidth(strokeWidth: number): void {
  patchSelection('ink', (el) => restyleInkWidth(el, strokeWidth), { coalesce: 'style:ink-width', skipLocked: true })
  useEditor.getState().setStyle('ink', { strokeWidth })
}

export function setImageOpacity(opacity: number): void {
  patchSelection('image', () => ({ opacity }), { coalesce: 'style:image-opacity' })
}
