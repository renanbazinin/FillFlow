import { describe, expect, it } from 'vitest'
import type { Element } from '../../model/types'
import { editingPage, selectionPages } from './pagesInUse'

function mark(id: string, page: number): Element {
  return { id, kind: 'mark', page, x: 0, y: 0, width: 10, height: 10, shape: 'check', color: '#000000' }
}

const elements = [mark('a', 0), mark('b', 3), mark('c', 3), mark('d', 7)]
const sorted = (pages: ReadonlySet<number>) => [...pages].sort((x, y) => x - y)

describe('editingPage', () => {
  it('is the page of the text being edited', () => {
    expect(editingPage({ elements, editingId: 'b' })).toBe(3)
    expect(editingPage({ elements, editingId: null })).toBe(-1)
    expect(editingPage({ elements, editingId: 'gone' })).toBe(-1)
  })

  it('follows the element while the inputs change', () => {
    expect(editingPage({ elements, editingId: 'd' })).toBe(7)
    const moved = elements.map((e) => (e.id === 'd' ? { ...e, page: 2 } : e))
    expect(editingPage({ elements: moved, editingId: 'd' })).toBe(2)
  })
})

describe('selectionPages', () => {
  it('lists the pages holding the selection', () => {
    expect(sorted(selectionPages({ elements, selection: ['d', 'a', 'c'] }))).toEqual([0, 3, 7])
    expect(sorted(selectionPages({ elements, selection: [] }))).toEqual([])
  })

  it('answers every page from one pass while the inputs are unchanged', () => {
    const input = { elements, selection: ['a', 'd'] }
    const pages = selectionPages(input)
    expect(selectionPages({ ...input })).toBe(pages)
    const moved = elements.map((e) => (e.id === 'a' ? { ...e, page: 5 } : e))
    expect(sorted(selectionPages({ ...input, elements: moved }))).toEqual([5, 7])
  })
})
