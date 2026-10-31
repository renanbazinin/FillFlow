import { createImageElement, createTextElement, IMAGE_DEFAULT_WIDTH } from '../../../model/elements'
import type { Asset, Element, Point } from '../../../model/types'
import { getSelectedElements, useEditor } from '../../../store/editor'
import { createId } from '../../../lib/utils/id'
import { viewer } from '../../viewer/viewerApi'
import { fitRectInPage } from '../lib/geometry'
import { nextPasteIndex, pasteDelta } from '../lib/paste'
import { boundsOf, pageSize } from './commands'
import { finishActiveTextEdit } from './textEdit'

/**
 * Internal clipboard for placed items. Copy also writes a marker to the system clipboard (when
 * the browser lets us), so a later paste can tell whether the system clipboard holds something
 * newer — an image or text copied elsewhere — and paste that instead.
 */

export const CLIPBOARD_MARKER = 'fillflow-items:'

interface ClipboardEntry {
  id: string
  elements: Element[]
  assets: Record<string, Asset>
  sourcePage: number
  /** Whether the copy event managed to write our marker to the system clipboard. */
  markerWritten: boolean
}

let entry: ClipboardEntry | null = null
let lastPaste: { page: number; index: number } | null = null

export function hasClipboardItems(): boolean {
  return entry !== null
}

/** Copies the selection; with `cut`, removes the unlocked ones afterwards. */
export function copySelection(cut = false): ClipboardEntry | null {
  const s = useEditor.getState()
  finishActiveTextEdit()
  const sel = getSelectedElements(useEditor.getState())
  if (!sel.length) return null
  const assets: Record<string, Asset> = {}
  for (const el of sel) if (el.kind === 'image' && s.assets[el.assetId]) assets[el.assetId] = s.assets[el.assetId]
  entry = {
    id: createId(),
    elements: sel.map((e) => structuredClone(e)),
    assets,
    sourcePage: sel[0].page,
    markerWritten: false,
  }
  lastPaste = null
  if (cut) s.removeElements(sel.filter((e) => !e.locked).map((e) => e.id))
  return entry
}

/** Text to put on the system clipboard for the current entry. */
export function clipboardMarker(): string | null {
  if (!entry) return null
  entry.markerWritten = true
  return `${CLIPBOARD_MARKER}${entry.id}`
}

/**
 * Writes the current entry's marker to the system clipboard outside a copy event (the context
 * menu, the shortcut fallback). It only counts once the browser accepted it.
 */
export function writeClipboardMarker(): void {
  const current = entry
  const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined
  if (!current || !clipboard?.writeText) return
  clipboard.writeText(`${CLIPBOARD_MARKER}${current.id}`).then(
    () => {
      current.markerWritten = true
    },
    () => {
      /* not allowed here: pasting keeps preferring the items copied here */
    },
  )
}

/** Whether a system-clipboard text payload refers to our current entry. */
export function isOwnMarker(text: string): boolean {
  return !!entry && text.trim() === `${CLIPBOARD_MARKER}${entry.id}`
}

/** Whether a text payload is the marker of items copied in FillFlow (in any tab, before any reload). */
export function isClipboardMarker(text: string): boolean {
  const t = text.trim()
  return t.length > CLIPBOARD_MARKER.length && t.startsWith(CLIPBOARD_MARKER) && !/\s/.test(t)
}

/** True when the system clipboard content should win over our items. */
export function systemClipboardIsNewer(text: string, hasFiles: boolean): boolean {
  if (!entry) return true
  if (isOwnMarker(text)) return false
  // Copying items never puts files on the clipboard, so files were copied somewhere else.
  if (hasFiles) return true
  // We never managed to write our marker, so we can't tell; prefer the items copied here.
  if (!entry.markerWritten) return false
  return text.trim().length > 0
}

function targetPage(): number {
  const s = useEditor.getState()
  const count = s.doc?.pages.length ?? 0
  return Math.max(0, Math.min(s.currentPage, count - 1))
}

function visibleCenterOn(page: number): Point | null {
  const c = viewer.getVisibleCenter()
  if (c && c.page === page) return { x: c.x, y: c.y }
  const size = pageSize(page)
  return size ? { x: size.width / 2, y: size.height / 2 } : null
}

/** Pastes the internal clipboard onto the current page. */
export function pasteItems(): boolean {
  const s = useEditor.getState()
  if (!entry || !s.doc) return false
  finishActiveTextEdit()
  const page = targetPage()
  const size = pageSize(page)
  const bounds = boundsOf(entry.elements)
  if (!size || !bounds) return false
  for (const asset of Object.values(entry.assets)) {
    if (!useEditor.getState().assets[asset.id]) useEditor.getState().addAsset(asset)
  }
  const index = nextPasteIndex(lastPaste, page)
  lastPaste = { page, index }
  const d = pasteDelta(bounds, {
    samePage: page === entry.sourcePage,
    index,
    center: page === entry.sourcePage ? null : visibleCenterOn(page),
    page: size,
  })
  const copies = entry.elements.map((e) => ({ ...structuredClone(e), id: createId(), page, x: e.x + d.x, y: e.y + d.y, locked: false }) as Element)
  useEditor.getState().addElements(copies)
  return true
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Unsupported image'))
    img.src = src
  })
}

/** Pastes an image from the system clipboard as a new picture on the current page. */
export async function pasteImageBlob(blob: Blob): Promise<boolean> {
  if (!useEditor.getState().doc) return false
  let dataUrl = await readAsDataUrl(blob)
  const img = await loadImage(dataUrl)
  let mime: Asset['mime'] = blob.type === 'image/jpeg' ? 'image/jpeg' : 'image/png'
  if (blob.type !== 'image/png' && blob.type !== 'image/jpeg') {
    // Re-encode anything else (webp, gif, bmp…) as PNG, which every exporter path supports.
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    canvas.getContext('2d')?.drawImage(img, 0, 0)
    dataUrl = canvas.toDataURL('image/png')
    mime = 'image/png'
  }
  const w = img.naturalWidth || 1
  const h = img.naturalHeight || 1
  const s = useEditor.getState()
  const assetId = s.addAsset({ mime, dataUrl, width: w, height: h })
  const page = targetPage()
  const size = pageSize(page)
  const center = visibleCenterOn(page)
  if (!size || !center) return false
  let width = Math.min(IMAGE_DEFAULT_WIDTH.image, size.width * 0.8)
  if (width / (w / h) > size.height * 0.8) width = size.height * 0.8 * (w / h)
  const el = createImageElement(page, center, 'image', assetId, w / h, width)
  const fitted = fitRectInPage(el, size)
  finishActiveTextEdit()
  useEditor.getState().addElement({ ...el, x: fitted.x, y: fitted.y })
  return true
}

/** Pastes plain text from the system clipboard as a new text block. */
export function pastePlainText(text: string): boolean {
  const s = useEditor.getState()
  const clean = text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').replace(/\s+$/, '')
  if (!clean.trim() || !s.doc) return false
  const page = targetPage()
  const size = pageSize(page)
  const center = visibleCenterOn(page)
  if (!size || !center) return false
  const el = createTextElement(page, { x: 0, y: 0 }, s.styles.text, clean.slice(0, 20000))
  const fitted = fitRectInPage({ x: center.x - el.width / 2, y: center.y - el.height / 2, width: el.width, height: el.height }, size)
  finishActiveTextEdit()
  s.addElement({ ...el, x: fitted.x, y: fitted.y })
  return true
}
