/**
 * Layout-independent shortcut keys: on non-Latin keyboard layouts (e.g. Hebrew) `event.key` is
 * the local character, so letters fall back to the physical key in `event.code`.
 */
export function shortcutLetter(e: Pick<KeyboardEvent, 'key' | 'code'>): string | null {
  if (/^[a-z]$/i.test(e.key)) return e.key.toLowerCase()
  const m = /^Key([A-Z])$/.exec(e.code)
  return m ? m[1].toLowerCase() : null
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
