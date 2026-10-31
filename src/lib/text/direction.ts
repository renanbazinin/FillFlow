export type TextDirection = 'ltr' | 'rtl'

/** Letters of the right-to-left scripts. */
const RTL_SCRIPT = /[\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Samaritan}\p{Script=Mandaic}\p{Script=Adlam}]/u
/** Characters with a direction of their own: letters (and the spacing marks of some scripts). */
const STRONG = /[\p{L}\p{Mc}]/u

/**
 * Direction of the first strong character, which is what `dir="auto"` goes by, or null while
 * there is none: digits, spaces, punctuation and marks are neutral ("12, (" has no direction).
 */
export function firstStrongDirection(text: string): TextDirection | null {
  for (const ch of text) {
    if (ch === '‏') return 'rtl'
    if (ch === '‎') return 'ltr'
    if (STRONG.test(ch)) return RTL_SCRIPT.test(ch) ? 'rtl' : 'ltr'
  }
  return null
}
