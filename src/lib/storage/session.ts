import { DEFAULT_STYLES, TEXT_LINE_HEIGHT } from '../../model/elements'
import { FONT_IDS } from '../../model/fonts'
import type { Asset, DocumentSession, Element, FontId, FormValues, TextAlign, TextElement } from '../../model/types'

/** What a document session is built from (a slice of the editor state). */
export interface SessionSource {
  docId: string
  fileName: string
  elements: Element[]
  formValues: FormValues
  assets: Record<string, Asset>
}

/**
 * Assets still referenced by an image element. The editor's asset table is append-only (undo
 * can bring an image back), but a saved session only needs what is actually placed.
 */
export function referencedAssets(elements: Element[], assets: Record<string, Asset>): Record<string, Asset> {
  const out: Record<string, Asset> = {}
  for (const el of elements) {
    if (el.kind !== 'image' || el.assetId in out) continue
    const asset = assets[el.assetId]
    if (asset) out[el.assetId] = asset
  }
  return out
}

/**
 * Elements worth storing. A text block with nothing but whitespace is only ever transient (a
 * new one still being typed into; it goes away when editing ends), so it is never persisted,
 * even when the page or the document goes away mid-edit.
 */
function storableElements(elements: Element[]): Element[] {
  return elements.filter((el) => el.kind !== 'text' || el.text.trim() !== '')
}

/** Snapshot of the user's work on a document, ready to be persisted. Pure. */
export function buildSession(src: SessionSource, updatedAt = Date.now()): DocumentSession {
  const elements = storableElements(src.elements)
  return {
    version: 1,
    docId: src.docId,
    fileName: src.fileName,
    elements,
    formValues: src.formValues,
    assets: referencedAssets(elements, src.assets),
    updatedAt,
  }
}

/** A stored session's `updatedAt`: its version for compare-and-swap writes (0 when it has none). */
export function storedVersion(raw: unknown): number {
  return isRecord(raw) && typeof raw.updatedAt === 'number' ? raw.updatedAt : 0
}

const ELEMENT_KINDS = new Set<string>(['text', 'mark', 'image', 'shape', 'ink'])
const TEXT_ALIGNS = new Set<string>(['left', 'center', 'right'])

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isUsableElement(v: unknown, assets: Record<string, Asset>): v is Element {
  if (!isRecord(v)) return false
  if (typeof v.id !== 'string' || !ELEMENT_KINDS.has(v.kind as string)) return false
  if (!Number.isInteger(v.page) || (v.page as number) < 0) return false
  if (![v.x, v.y, v.width, v.height].every(Number.isFinite)) return false
  switch (v.kind) {
    case 'text':
      return typeof v.text === 'string' && v.text.trim() !== '' && Number.isFinite(v.fontSize) && (v.fontSize as number) > 0
    case 'image':
      return typeof v.assetId === 'string' && isRecord(assets[v.assetId])
    case 'ink':
      return Array.isArray(v.strokes)
    default:
      return true
  }
}

/** A stored text block's style, with anything this build can't lay out replaced by a default. */
function withUsableStyle(el: TextElement): TextElement {
  const v = el as unknown as Record<string, unknown>
  return {
    ...el,
    fontId: FONT_IDS.includes(v.fontId as FontId) ? el.fontId : DEFAULT_STYLES.text.fontId,
    bold: v.bold === true,
    align: TEXT_ALIGNS.has(v.align as string) ? (v.align as TextAlign) : 'left',
    lineHeight: Number.isFinite(v.lineHeight) && (v.lineHeight as number) > 0 ? el.lineHeight : TEXT_LINE_HEIGHT,
    letterSpacing: Number.isFinite(v.letterSpacing) ? el.letterSpacing : 0,
    color: typeof v.color === 'string' ? el.color : DEFAULT_STYLES.text.color,
  }
}

/**
 * Validates a stored session (anything read back from IndexedDB is untrusted: older builds,
 * other tabs, manual tinkering). Returns null when it isn't a v1 session; drops individual
 * elements that could not be rendered (or show nothing) rather than discarding the whole
 * session, and gives text blocks a style this build supports (e.g. an unknown font).
 */
export function parseSession(raw: unknown): DocumentSession | null {
  if (!isRecord(raw) || raw.version !== 1 || typeof raw.docId !== 'string') return null
  const assets = isRecord(raw.assets) ? (raw.assets as Record<string, Asset>) : {}
  const elements = Array.isArray(raw.elements)
    ? raw.elements.filter((e) => isUsableElement(e, assets)).map((e) => (e.kind === 'text' ? withUsableStyle(e) : e))
    : []
  return {
    version: 1,
    docId: raw.docId,
    fileName: typeof raw.fileName === 'string' ? raw.fileName : '',
    elements,
    formValues: isRecord(raw.formValues) ? (raw.formValues as FormValues) : {},
    assets: referencedAssets(elements, assets),
    updatedAt: storedVersion(raw),
  }
}
