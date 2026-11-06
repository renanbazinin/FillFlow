import type { Element } from '../../../model/types'
import { firstStrongDirection, type TextDirection } from '../../../lib/text/direction'

export interface PageGroup {
  page: number
  items: Element[]
}

const NO_DIRECTIONS: ReadonlyMap<number, TextDirection | null> = new Map()

/**
 * Items grouped by page (ascending), each page in reading order: rows top to bottom, and each row
 * the way the page reads, left to right or, on a Hebrew or Arabic page, right to left. A page reads
 * the way the PDF's own text on it does (`pdfDirections`, where known), else the way the text
 * placed on it does.
 */
export function groupByPage(elements: readonly Element[], pdfDirections = NO_DIRECTIONS): PageGroup[] {
  const byPage = new Map<number, Element[]>()
  for (const el of elements) {
    const list = byPage.get(el.page)
    if (list) list.push(el)
    else byPage.set(el.page, [el])
  }
  const fallback = textDirection(elements) ?? 'ltr'
  return [...byPage.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([page, items]) => ({ page, items: readingOrder(items, pdfDirections.get(page) ?? textDirection(items) ?? fallback) }))
}

/**
 * How most of the text in `items` reads (null when there is none, or as much of each): a page
 * with only marks or a signature on it reads like the rest of the document.
 */
function textDirection(items: readonly Element[]): TextDirection | null {
  let balance = 0
  for (const el of items) {
    if (el.kind !== 'text') continue
    const dir = firstStrongDirection(el.text)
    if (dir) balance += dir === 'rtl' ? 1 : -1
  }
  return balance > 0 ? 'rtl' : balance < 0 ? 'ltr' : null
}

/** Rows whose tops sit within a few points of the row's first item count as the same line. */
const ROW_TOLERANCE = 4

function readingOrder(items: readonly Element[], dir: TextDirection): Element[] {
  const rows: Element[][] = []
  for (const el of items.slice().sort((a, b) => a.y - b.y || a.x - b.x)) {
    const row = rows.at(-1)
    if (row && el.y - row[0].y <= ROW_TOLERANCE) row.push(el)
    else rows.push([el])
  }
  // Right to left goes by right edges: where a right-aligned line of Hebrew starts.
  const across = dir === 'rtl' ? (a: Element, b: Element) => b.x + b.width - (a.x + a.width) : (a: Element, b: Element) => a.x - b.x
  return rows.flatMap((row) => row.sort(across))
}

/** Ids from `from` to `to` (inclusive) in list order — Shift-click range selection. */
export function rangeIds(order: readonly string[], from: string, to: string): string[] {
  const i = order.indexOf(from)
  const j = order.indexOf(to)
  if (i < 0 || j < 0) return [to]
  return order.slice(Math.min(i, j), Math.max(i, j) + 1)
}
