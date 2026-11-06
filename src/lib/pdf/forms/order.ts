import type { Rect } from '../../../model/types'

export interface Placed {
  page: number
  rect: Rect
}

/** Two boxes sit on the same "line" when they overlap vertically by half the smaller height. */
function sameRow(a: Rect, b: Rect): boolean {
  const overlap = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  const centers = Math.abs(a.y + a.height / 2 - (b.y + b.height / 2))
  return overlap >= Math.min(a.height, b.height) * 0.5 || centers <= 3
}

/**
 * Sorts items in reading order: by page, then top-to-bottom, then left-to-right, where boxes
 * whose vertical centers are within a few points count as one line. Stable for equal inputs.
 */
export function readingOrder<T>(items: readonly T[], place: (item: T) => Placed): T[] {
  const byPage = new Map<number, { item: T; p: Placed; i: number }[]>()
  items.forEach((item, i) => {
    const p = place(item)
    let list = byPage.get(p.page)
    if (!list) byPage.set(p.page, (list = []))
    list.push({ item, p, i })
  })

  const out: T[] = []
  for (const page of [...byPage.keys()].sort((a, b) => a - b)) {
    const list = byPage.get(page)!
    list.sort((a, b) => a.p.rect.y - b.p.rect.y || a.p.rect.x - b.p.rect.x || a.i - b.i)
    let row: typeof list = []
    const flush = () => {
      row.sort((a, b) => a.p.rect.x - b.p.rect.x || a.p.rect.y - b.p.rect.y || a.i - b.i)
      for (const r of row) out.push(r.item)
      row = []
    }
    for (const entry of list) {
      if (row.length && !sameRow(row[0].p.rect, entry.p.rect)) flush()
      row.push(entry)
    }
    flush()
  }
  return out
}
