import { useEffect, useState } from 'react'
import type { PDFDocumentProxy } from '../../../lib/pdf/pdfjs'
import { firstStrongDirection, type TextDirection } from '../../../lib/text/direction'

/** How text reads by most of its letters: null when it has none (or as many each way). */
export function letterDirection(texts: Iterable<string>): TextDirection | null {
  let balance = 0
  for (const text of texts) {
    for (const ch of text) {
      const dir = firstStrongDirection(ch)
      if (dir) balance += dir === 'rtl' ? 1 : -1
    }
  }
  return balance > 0 ? 'rtl' : balance < 0 ? 'ltr' : null
}

const read = new WeakMap<PDFDocumentProxy, Map<number, Promise<TextDirection | null>>>()

/** How the PDF's own text on a page reads (null on a page without any, like a scan); read once. */
function pdfPageDirection(pdf: PDFDocumentProxy, page: number): Promise<TextDirection | null> {
  let pages = read.get(pdf)
  if (!pages) read.set(pdf, (pages = new Map()))
  let dir = pages.get(page)
  if (!dir) {
    dir = pdf
      .getPage(page + 1)
      .then((p) => p.getTextContent())
      .then((content) => letterDirection(content.items.map((item) => ('str' in item ? item.str : ''))))
      .catch(() => null)
    pages.set(page, dir)
  }
  return dir
}

const NONE: ReadonlyMap<number, TextDirection | null> = new Map()

/**
 * How the given pages of the PDF read by its own text (a Hebrew form right to left), as it's
 * found: a page not read yet has none.
 */
export function usePdfDirections(pdf: PDFDocumentProxy | null, pages: readonly number[]): ReadonlyMap<number, TextDirection | null> {
  const [found, setFound] = useState<{ pdf: PDFDocumentProxy | null; dirs: ReadonlyMap<number, TextDirection | null> }>({ pdf: null, dirs: NONE })
  const wanted = pages.join(',')
  useEffect(() => {
    if (!pdf || !wanted) return
    let live = true
    for (const page of wanted.split(',').map(Number)) {
      void pdfPageDirection(pdf, page).then((dir) => {
        if (!live) return
        setFound((prev) => {
          if (prev.pdf === pdf && prev.dirs.has(page)) return prev
          const dirs = new Map(prev.pdf === pdf ? prev.dirs : NONE)
          dirs.set(page, dir)
          return { pdf, dirs }
        })
      })
    }
    return () => {
      live = false
    }
  }, [pdf, wanted])
  return found.pdf === pdf ? found.dirs : NONE
}
