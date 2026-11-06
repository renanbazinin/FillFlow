import { describe, expect, it } from 'vitest'
import { DATE_FORMATS } from '../../model/elements'
import { dateFormatChoices } from './dateFormats'

describe('dateFormatChoices', () => {
  it('offers every format, written out as the given date', () => {
    const choices = dateFormatChoices(new Date(2026, 9, 31))
    expect(choices.map((c) => c.format)).toEqual(DATE_FORMATS)
    expect(choices.map((c) => c.example)).toEqual(['31/10/2026', '10/31/2026', '2026-10-31', '31.10.2026', '31 Oct 2026', 'October 31, 2026'])
  })

  it('spells out the order of the all-number formats only', () => {
    // On the 5th of November, 05/11 and 11/05 both look like dates: the pattern tells them apart.
    const choices = dateFormatChoices(new Date(2026, 10, 5))
    expect(choices.map((c) => [c.example, c.pattern])).toEqual([
      ['05/11/2026', 'DD/MM/YYYY'],
      ['11/05/2026', 'MM/DD/YYYY'],
      ['2026-11-05', 'YYYY-MM-DD'],
      ['05.11.2026', 'DD.MM.YYYY'],
      ['5 Nov 2026', null],
      ['November 5, 2026', null],
    ])
  })
})
