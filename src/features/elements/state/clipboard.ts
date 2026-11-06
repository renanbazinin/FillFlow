import { toast } from 'sonner'
import { createImageElement, createTextElement, IMAGE_DEFAULT_WIDTH, withTextLayout } from '../../../model/elements'
import type { Asset, Element, Point, TextElement } from '../../../model/types'
import { getSelectedElements, useEditor } from '../../../store/editor'
import { firstStrongDirection } from '../../../lib/text/direction'
import { wrapText } from '../../../lib/text/wrap'
import { createId } from '../../../lib/utils/id'
import { importImageAsset } from '../../signature/decode'
import { viewer } from '../../viewer/viewerApi'
import { fitRectInPage } from '../lib/geometry'
import { nextPasteIndex, pasteDelta } from '../lib/paste'
import { boundsOf, pageSize } from './commands'
import { finishActiveTextEdit } from './textEdit'

/**
 * Internal clipboard for placed items. Copy also writes a marker to the system clipboard (when
 * the browser lets us): the copied text, so it pastes into other apps, or, when nothing copied
 * has text, an id. A later paste can then tell whether the system clipboard holds something
 * newer — an image or text copied elsewhere — and paste that instead.
 */

export const CLIPBOARD_MARKER = 'fillflow-items:'

interface ClipboardEntry {
  id: string
  elements: Element[]
  assets: Record<string, Asset>
  sourcePage: number
  /** Text of the copied text items in reading order, one per line ('' when there is none). */
  text: string
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
  const texts = readingOrder(
    sel.filter((e): e is TextElement => e.kind === 'text' && !!e.text.trim()),
    useEditor.getState().elements,
  )
  entry = {
    id: createId(),
    elements: sel.map((e) => structuredClone(e)),
    assets,
    sourcePage: sel[0].page,
    text: texts.map((e) => e.text).join('\n'),
    markerWritten: false,
  }
  lastPaste = null
  if (cut) s.removeElements(sel.filter((e) => !e.locked).map((e) => e.id))
  return entry
}

/**
 * Text items in reading order: page by page, rows top to bottom, each row from where it is read.
 * A row is read from the right when any of its text reads right to left (digits read either way),
 * or when most of the text on its page does, like a row of only numbers or an e-mail address in a
 * Hebrew form.
 */
function readingOrder(texts: readonly TextElement[], all: readonly Element[]): TextElement[] {
  const middle = (e: TextElement) => e.y + e.height / 2
  const rows: TextElement[][] = []
  for (const el of texts.slice().sort((a, b) => a.page - b.page || middle(a) - middle(b) || a.y - b.y)) {
    const row = rows.at(-1)
    if (row && sameRow(row[row.length - 1], el)) row.push(el)
    else rows.push([el])
  }
  return rows.flatMap((row) => {
    const rtl = row.some((e) => firstStrongDirection(e.text) === 'rtl') || readsRightToLeft(all, row[0].page)
    return row.sort(rtl ? (a, b) => b.x + b.width - (a.x + a.width) || a.y - b.y : (a, b) => a.x - b.x || a.y - b.y)
  })
}

/**
 * Whether two boxes are on one row: on the same page, overlapping vertically by half the smaller
 * one's height (so a two-line box is on the row of the boxes beside its first line).
 */
function sameRow(a: TextElement, b: TextElement): boolean {
  return a.page === b.page && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) >= Math.min(a.height, b.height) / 2
}

/** Whether more of the text placed on a page reads right to left than left to right. */
function readsRightToLeft(elements: readonly Element[], page: number): boolean {
  let balance = 0
  for (const el of elements) {
    if (el.page !== page || el.kind !== 'text') continue
    const dir = firstStrongDirection(el.text)
    if (dir) balance += dir === 'rtl' ? 1 : -1
  }
  return balance > 0
}

/** The system clipboard's plain text for an entry: its text, or its id when it has none. */
function markerOf(e: ClipboardEntry): string {
  return e.text || `${CLIPBOARD_MARKER}${e.id}`
}

/** Text to put on the system clipboard for the current entry. */
export function clipboardMarker(): string | null {
  if (!entry) return null
  entry.markerWritten = true
  return markerOf(entry)
}

/**
 * Writes the current entry's marker to the system clipboard outside a copy event (the context
 * menu, the shortcut fallback). It only counts once the browser accepted it.
 */
export function writeClipboardMarker(): void {
  const current = entry
  const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined
  if (!current || !clipboard?.writeText) return
  clipboard.writeText(markerOf(current)).then(
    () => {
      current.markerWritten = true
    },
    () => {
      /* not allowed here: pasting keeps preferring the items copied here */
    },
  )
}

/** Whether a system-clipboard text payload is our current entry's marker (whatever line breaks the system wrote). */
export function isOwnMarker(text: string): boolean {
  return !!entry && text.replace(/\r\n?/g, '\n').trim() === markerOf(entry).trim()
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

/** Pastes an image from the system clipboard as a new picture on the current page. */
export async function pasteImageBlob(blob: Blob): Promise<boolean> {
  const doc = useEditor.getState().doc
  if (!doc) return false
  // Prepared like a picture from the image tool: upright (EXIF), at most 2000 px, SVG drawn sharp.
  const asset = await importImageAsset(blob)
  // Another document was opened meanwhile: the picture was meant for this one.
  if (useEditor.getState().doc !== doc) return false
  const page = targetPage()
  const size = pageSize(page)
  const center = visibleCenterOn(page)
  if (!size || !center) return false
  const { width: w, height: h } = asset
  const assetId = useEditor.getState().addAsset(asset)
  let width = Math.min(IMAGE_DEFAULT_WIDTH.image, size.width * 0.8)
  if (width / (w / h) > size.height * 0.8) width = size.height * 0.8 * (w / h)
  const el = createImageElement(page, center, 'image', assetId, w / h, width)
  const fitted = fitRectInPage(el, size)
  finishActiveTextEdit()
  useEditor.getState().addElement({ ...el, x: fitted.x, y: fitted.y })
  return true
}

/** Room (points) that pasted text broken into lines leaves at each side of the page. */
const PASTE_MARGIN = 36

/**
 * Pastes plain text from the system clipboard as a new text block. Lines too long for the page
 * break between words, so that all of it is on the page (what runs past the page bottom is cut,
 * as the download would cut it, and the user is told).
 */
export function pastePlainText(text: string): boolean {
  const s = useEditor.getState()
  const clean = text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').replace(/\s+$/, '')
  if (!clean.trim() || !s.doc) return false
  const page = targetPage()
  const size = pageSize(page)
  const center = visibleCenterOn(page)
  if (!size || !center) return false
  const draft = createTextElement(page, { x: 0, y: 0 }, s.styles.text, clean.slice(0, 20000))
  const el = withTextLayout({ ...draft, text: wrapText(draft.text, draft, Math.max(size.width - 2 * PASTE_MARGIN, size.width * 0.75)) })
  const fitted = fitRectInPage({ x: center.x - el.width / 2, y: center.y - el.height / 2, width: el.width, height: el.height }, size)
  finishActiveTextEdit()
  // Right-to-left text (Hebrew, Arabic…) lines up on the right, as it is read, unless another
  // alignment was chosen for new text.
  const align = el.align === 'left' && firstStrongDirection(clean) === 'rtl' ? 'right' : el.align
  s.addElement({ ...el, align, x: fitted.x, y: fitted.y })
  if (el.height > size.height) {
    toast('The pasted text doesn’t fit on the page', { description: 'Text past the bottom of the page won’t be in the download.' })
  }
  return true
}
