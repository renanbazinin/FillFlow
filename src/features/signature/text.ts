const RTL_CHAR = /[\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}]/u
const LETTER = /\p{L}/u

/** Base direction from the first strong character (like `dir="auto"`). */
export function textDirection(text: string): 'ltr' | 'rtl' {
  for (const ch of text) {
    if (RTL_CHAR.test(ch)) return 'rtl'
    if (LETTER.test(ch)) return 'ltr'
  }
  return 'ltr'
}

/**
 * Initials of a name: the first letter of each word (hyphenated parts count as words),
 * upper-cased, at most `max` letters. "Jean-Luc Picard" → "JLP", "ישראל ישראלי" → "יי".
 */
export function initialsFrom(name: string, max = 3): string {
  const out: string[] = []
  for (const word of name.split(/[\s\-‐‑–—_.]+/u)) {
    const first = Array.from(word).find((ch) => LETTER.test(ch))
    if (first) out.push(first.toLocaleUpperCase())
    if (out.length >= max) break
  }
  return out.join('')
}
