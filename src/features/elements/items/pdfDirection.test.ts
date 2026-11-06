import { describe, expect, it } from 'vitest'
import { letterDirection } from './pdfDirection'

describe('letterDirection', () => {
  it('goes by most of the letters, whatever order a PDF stores them in', () => {
    expect(letterDirection(['שם משפחה', 'Name'])).toBe('rtl')
    expect(letterDirection(['הקפשמ םש', 'Name'])).toBe('rtl')
    expect(letterDirection(['Full name', 'שם'])).toBe('ltr')
  })

  it('has no direction without letters', () => {
    expect(letterDirection([])).toBeNull()
    expect(letterDirection(['123', ' – ', '01/05/1990'])).toBeNull()
    expect(letterDirection(['ab', 'אב'])).toBeNull()
  })
})
