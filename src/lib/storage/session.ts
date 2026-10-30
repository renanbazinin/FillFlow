import type { Asset, DocumentSession, Element, FormValues } from '../../model/types'

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

/** Snapshot of the user's work on a document, ready to be persisted. Pure. */
export function buildSession(src: SessionSource, updatedAt = Date.now()): DocumentSession {
  return {
    version: 1,
    docId: src.docId,
    fileName: src.fileName,
    elements: src.elements,
    formValues: src.formValues,
    assets: referencedAssets(src.elements, src.assets),
    updatedAt,
  }
}

const ELEMENT_KINDS = new Set<string>(['text', 'mark', 'image', 'shape', 'ink'])

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
      return typeof v.text === 'string' && Number.isFinite(v.fontSize) && (v.fontSize as number) > 0
    case 'image':
      return typeof v.assetId === 'string' && isRecord(assets[v.assetId])
    case 'ink':
      return Array.isArray(v.strokes)
    default:
      return true
  }
}

/**
 * Validates a stored session (anything read back from IndexedDB is untrusted: older builds,
 * other tabs, manual tinkering). Returns null when it isn't a v1 session; drops individual
 * elements that could not be rendered rather than discarding the whole session.
 */
export function parseSession(raw: unknown): DocumentSession | null {
  if (!isRecord(raw) || raw.version !== 1 || typeof raw.docId !== 'string') return null
  const assets = isRecord(raw.assets) ? (raw.assets as Record<string, Asset>) : {}
  const elements = Array.isArray(raw.elements) ? raw.elements.filter((e) => isUsableElement(e, assets)) : []
  return {
    version: 1,
    docId: raw.docId,
    fileName: typeof raw.fileName === 'string' ? raw.fileName : '',
    elements,
    formValues: isRecord(raw.formValues) ? (raw.formValues as FormValues) : {},
    assets: referencedAssets(elements, assets),
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : 0,
  }
}
