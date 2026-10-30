import type { Element } from '../../../model/types'

export interface PageGroup {
  page: number
  items: Element[]
}

/** Items grouped by page (ascending), each page in reading order (top→bottom, then left→right). */
export function groupByPage(elements: readonly Element[]): PageGroup[] {
  const byPage = new Map<number, Element[]>()
  for (const el of elements) {
    const list = byPage.get(el.page)
    if (list) list.push(el)
    else byPage.set(el.page, [el])
  }
  return [...byPage.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([page, items]) => ({ page, items: items.slice().sort(readingOrder) }))
}

/** Rows that sit within a few points of each other count as the same line. */
function readingOrder(a: Element, b: Element): number {
  const dy = a.y - b.y
  if (Math.abs(dy) > 4) return dy
  return a.x - b.x
}

/** Ids from `from` to `to` (inclusive) in list order — Shift-click range selection. */
export function rangeIds(order: readonly string[], from: string, to: string): string[] {
  const i = order.indexOf(from)
  const j = order.indexOf(to)
  if (i < 0 || j < 0) return [to]
  return order.slice(Math.min(i, j), Math.max(i, j) + 1)
}
