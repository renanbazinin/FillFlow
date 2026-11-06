import { describe, expect, it } from 'vitest'
import type { Element } from '../../../model/types'
import { groupByPage, rangeIds } from './groups'

const mark = (id: string, page: number, x: number, y: number): Element => ({ id, kind: 'mark', page, x, y, width: 10, height: 10, shape: 'check', color: '#000' })

const text = (id: string, page: number, x: number, y: number, width: number, value: string): Element => ({
  id,
  kind: 'text',
  page,
  x,
  y,
  width,
  height: 14.4,
  text: value,
  fontId: 'sans',
  bold: false,
  fontSize: 12,
  color: '#000',
  align: 'right',
  lineHeight: 1.2,
  letterSpacing: 0,
})

const ids = (g: { items: Element[] }) => g.items.map((e) => e.id)

describe('groupByPage', () => {
  it('groups by page and sorts in reading order', () => {
    const groups = groupByPage([mark('c', 1, 10, 10), mark('b', 0, 200, 50), mark('a', 0, 10, 52), mark('d', 0, 50, 10)])
    expect(groups.map((g) => g.page)).toEqual([0, 1])
    // Same line (within 4pt) → left to right; then lines top to bottom.
    expect(ids(groups[0])).toEqual(['d', 'a', 'b'])
    expect(ids(groups[1])).toEqual(['c'])
  })

  it('reads the rows of a Hebrew page right to left', () => {
    // Form 101, section B (ID, last name, first name, date of birth) and the address row (street,
    // number, city, zip), filled in the boxes they belong in, in a shuffled order.
    const groups = groupByPage([
      text('zip', 0, 40, 260, 60, '6100000'),
      text('first', 0, 260, 213, 50, 'ישראל'),
      text('number', 0, 210, 261, 12, '12'),
      text('dob', 0, 125, 214, 80, '01051990'),
      text('street', 0, 330, 260, 60, 'רחוב הרצל'),
      text('id', 0, 445, 214, 90, '123456782'),
      text('city', 0, 130, 259, 70, 'תל אביב-יפו'),
      text('last', 0, 380, 215, 50, 'כהן'),
      // Page 2 only has ticks: it reads like the rest of the document.
      mark('m1', 1, 100, 400),
      mark('m3', 1, 300, 401),
      mark('m2', 1, 200, 399),
    ])
    expect(ids(groups[0])).toEqual(['id', 'last', 'first', 'dob', 'street', 'number', 'city', 'zip'])
    expect(ids(groups[1])).toEqual(['m3', 'm2', 'm1'])
  })

  it('goes by the text on each page, then the document, then left to right', () => {
    const groups = groupByPage([
      text('he', 0, 300, 100, 60, 'שלום'),
      text('en', 1, 300, 100, 60, 'Hello'),
      mark('a', 1, 100, 100),
      mark('b', 2, 300, 100),
      mark('c', 2, 100, 100),
    ])
    expect(ids(groups[0])).toEqual(['he'])
    expect(ids(groups[1])).toEqual(['a', 'en'])
    // As much Hebrew as English in the document, and no text on the page: left to right.
    expect(ids(groups[2])).toEqual(['c', 'b'])
    expect(ids(groupByPage([mark('b', 0, 300, 100), mark('a', 0, 100, 100)])[0])).toEqual(['a', 'b'])
  })

  it('goes by the PDF’s own text first, then by what is placed on the page', () => {
    // A Hebrew form with only ticks and a number on it: it reads right to left.
    const row = [mark('a', 0, 100, 400), mark('b', 0, 300, 401), text('n', 0, 200, 399, 40, '123')]
    expect(ids(groupByPage(row)[0])).toEqual(['a', 'n', 'b'])
    expect(ids(groupByPage(row, new Map([[0, 'rtl']]))[0])).toEqual(['b', 'n', 'a'])
    // English typed on a Hebrew form reads like the form; on a page without text of its own (a
    // scan), like the text placed on it.
    const typed = [text('en', 0, 300, 100, 60, 'Hello'), mark('m', 0, 100, 100)]
    expect(ids(groupByPage(typed, new Map([[0, 'rtl']]))[0])).toEqual(['en', 'm'])
    expect(ids(groupByPage(typed, new Map([[0, null]]))[0])).toEqual(['m', 'en'])
  })

  it('keeps every item in exactly one row, whatever the order they come in', () => {
    // 0 and 3 share a line, 3 and 6 would too, but 0 and 6 are too far apart: rows start at their top item.
    const items = [mark('a', 0, 50, 0), mark('b', 0, 10, 3), mark('c', 0, 0, 6)]
    for (const order of [items, items.slice().reverse(), [items[1], items[2], items[0]]]) {
      expect(ids(groupByPage(order)[0])).toEqual(['b', 'a', 'c'])
    }
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
