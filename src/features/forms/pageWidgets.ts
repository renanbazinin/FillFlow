import { readingOrder } from '../../lib/pdf/forms/order'
import type { FormField, FormWidget } from '../../model/types'

export interface PageWidget {
  field: FormField
  widget: FormWidget
}

const EMPTY: PageWidget[] = []
const cache = new WeakMap<readonly FormField[], Map<number, PageWidget[]>>()

/** The widgets on one page in reading (= tab) order. Cached per field list. */
export function widgetsOnPage(fields: readonly FormField[] | undefined, page: number): PageWidget[] {
  if (!fields?.length) return EMPTY
  let byPage = cache.get(fields)
  if (!byPage) {
    byPage = new Map()
    for (const field of fields) {
      if (field.type === 'button') continue
      for (const widget of field.widgets) {
        let list = byPage.get(widget.page)
        if (!list) byPage.set(widget.page, (list = []))
        list.push({ field, widget })
      }
    }
    for (const [p, list] of byPage) byPage.set(p, readingOrder(list, (i) => i.widget))
    cache.set(fields, byPage)
  }
  return byPage.get(page) ?? EMPTY
}
