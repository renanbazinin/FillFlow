import { describe, expect, it } from 'vitest'
import type { Element } from '../../../model/types'
import { groupByPage, rangeIds } from './groups'

const mark = (id: string, page: number, x: number, y: number): Element => ({ id, kind: 'mark', page, x, y, width: 10, height: 10, shape: 'check', color: '#000' })

describe('groupByPage', () => {
  it('groups by page and sorts in reading order', () => {
    const groups = groupByPage([mark('c', 1, 10, 10), mark('b', 0, 200, 50), mark('a', 0, 10, 52), mark('d', 0, 50, 10)])
    expect(groups.map((g) => g.page)).toEqual([0, 1])
    // Same line (within 4pt) → left to right; then lines top to bottom.
    expect(groups[0].items.map((e) => e.id)).toEqual(['d', 'a', 'b'])
    expect(groups[1].items.map((e) => e.id)).toEqual(['c'])
  })

  it('returns nothing for no elements', () => {
    expect(groupByPage([])).toEqual([])
  })
})

describe('rangeIds', () => {
  it('selects the inclusive range in either direction', () => {
    const order = ['a', 'b', 'c', 'd']
    expect(rangeIds(order, 'b', 'd')).toEqual(['b', 'c', 'd'])
    expect(rangeIds(order, 'd', 'a')).toEqual(['a', 'b', 'c', 'd'])
    expect(rangeIds(order, 'x', 'c')).toEqual(['c'])
  })
})
