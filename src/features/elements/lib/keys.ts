/** A character of a script other than Latin: Hebrew, Cyrillic, Greek, Arabic, Thai… */
const NON_LATIN = /[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u

/** The punctuation the Hebrew layout types on two letter keys (no Latin layout puts it there). */
const HEBREW_PUNCTUATION: Readonly<Record<string, string>> = { KeyQ: '/', KeyW: "'" }

/**
 * Layout-independent shortcut keys: letters go by the Latin letter the layout types (QWERTY,
 * AZERTY, Dvorak…). Where the layout types no Latin letter (Hebrew, Russian, Greek…), they fall
 * back to the physical key in `event.code`. Punctuation and accented letters that a Latin layout
 * puts on a letter key (Dvorak ",", AZERTY ",", Turkish "ğ") are that layout's own keys: no letter.
 */
export function shortcutLetter(e: Pick<KeyboardEvent, 'key' | 'code'>): string | null {
  if (/^[a-z]$/i.test(e.key)) return e.key.toLowerCase()
  const m = /^Key([A-Z])$/.exec(e.code)
  if (!m || !(NON_LATIN.test(e.key) || HEBREW_PUNCTUATION[e.code] === e.key)) return null
  return m[1].toLowerCase()
}

/** Ctrl on Windows/Linux, ⌘ on Apple platforms (either is accepted, like most web apps). */
export function hasMod(e: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey'>): boolean {
  return e.ctrlKey || e.metaKey
}

/** Bracket keys by physical position too (`[` / `]`). */
export function bracketKey(e: Pick<KeyboardEvent, 'key' | 'code'>): '[' | ']' | null {
  if (e.code === 'BracketLeft') return '['
  if (e.code === 'BracketRight') return ']'
  if (e.key === '[' || e.key === ']') return e.key
  return null
}
