import { describe, expect, it } from 'vitest'
import type { Element, FormField, PageInfo } from '../../model/types'
import type { LoadedDocument } from '../../store/editor'
import { THUMB_MAX_HEIGHT, THUMB_WIDTH, pageBadgeCounts, thumbnailPixelRatio, thumbnailSize } from './thumbnailModel'

const page = (index: number, width = 600, height = 800): PageInfo => ({
  index,
  width,
  height,
  rotation: 0,
  view: [0, 0, width, height],
  userUnit: 1,
})

function field(name: string, pages: number[], defaultValue: FormField['defaultValue'], type: FormField['type'] = 'text'): FormField {
  return {
    name,
    type,
    widgets: pages.map((p, i) => ({ id: `${name}-${i}`, page: p, rect: { x: 0, y: 0, width: 10, height: 10 } })),
    readOnly: false,
    required: false,
    defaultValue,
  }
}

function mark(id: string, p: number): Element {
  return { id, kind: 'mark', page: p, x: 0, y: 0, width: 10, height: 10, shape: 'check', color: '#000000' }
}

function doc(pages: PageInfo[], formFields: FormField[]): LoadedDocument {
  return { id: 'doc', name: 'x.pdf', bytes: new Uint8Array(), pdf: null as never, pages, formFields }
}

describe('thumbnailSize', () => {
  it('is 150px wide for portrait and landscape pages', () => {
    expect(thumbnailSize({ width: 595, height: 842 })).toEqual({ width: THUMB_WIDTH, height: 212 })
    expect(thumbnailSize({ width: 842, height: 595 })).toEqual({ width: THUMB_WIDTH, height: 106 })
  })
  it('limits very tall pages by height', () => {
    const s = thumbnailSize({ width: 200, height: 2000 })
    expect(s.height).toBe(THUMB_MAX_HEIGHT)
    expect(s.width).toBe(22)
  })
  it('survives degenerate pages', () => {
    expect(thumbnailSize({ width: 0, height: 0 }).width).toBe(THUMB_WIDTH)
  })
  it('renders at 2-3x', () => {
    expect(thumbnailPixelRatio(1)).toBe(2)
    expect(thumbnailPixelRatio(2.625)).toBe(2.625)
    expect(thumbnailPixelRatio(4)).toBe(3)
  })
})

describe('pageBadgeCounts', () => {
  const pages = [page(0), page(1), page(2)]
  const fields = [
    field('name', [0], ''),
    field('agree', [1], false, 'checkbox'),
    field('copies', [1, 2], 'x'),
    field('tags', [2, 2], [], 'listbox'),
  ]

  it('counts elements and changed fields per page', () => {
    const counts = pageBadgeCounts({
      doc: doc(pages, fields),
      elements: [mark('a', 0), mark('b', 0), mark('c', 2)],
      formValues: { name: 'Ada', agree: false, copies: 'y', tags: ['t1'] },
    })
    // page 0: 2 marks + name; page 1: copies (agree unchanged); page 2: mark + copies + tags (two widgets, once)
    expect(counts).toEqual([3, 1, 3])
  })

  it('ignores unchanged values, missing values and out-of-range pages', () => {
    const counts = pageBadgeCounts({
      doc: doc(pages, fields),
      elements: [mark('z', 7)],
      formValues: { name: '', agree: false, tags: [] },
    })
    expect(counts).toEqual([0, 0, 0])
  })

  it('returns the same array while inputs are unchanged', () => {
    const input = { doc: doc(pages, fields), elements: [mark('a', 1)], formValues: {} }
    expect(pageBadgeCounts(input)).toBe(pageBadgeCounts({ ...input }))
  })

  it('handles no document', () => {
    expect(pageBadgeCounts({ doc: null, elements: [], formValues: {} })).toEqual([])
  })
})
