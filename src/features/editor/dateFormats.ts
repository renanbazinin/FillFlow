import { DATE_FORMATS, formatDate } from '../../model/elements'
import type { DateFormat } from '../../model/types'

export interface DateFormatChoice {
  format: DateFormat
  /** The date written in this format ("31/10/2026"). */
  example: string
  /** The order spelled out, where the digits alone leave it open ("DD/MM/YYYY"); null for named months. */
  pattern: string | null
}

/** The date formats on offer, each with `date` written that way. */
export function dateFormatChoices(date: Date): DateFormatChoice[] {
  return DATE_FORMATS.map((format) => ({
    format,
    example: formatDate(date, format),
    // 05/11/2026 reads as 5 November in one place and May 11 in another.
    pattern: /^[dMy]+(?:[./-][dMy]+)+$/.test(format) ? format.toUpperCase() : null,
  }))
}
