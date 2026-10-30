import { useSyncExternalStore } from 'react'

/** Keep the storage key in sync with the inline script in index.html. */
const KEY = 'fillflow:theme'

export type ThemePreference = 'light' | 'dark' | 'system'

const listeners = new Set<() => void>()
const media = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null

function readPreference(): ThemePreference {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

let preference: ThemePreference = typeof window !== 'undefined' ? readPreference() : 'system'

function apply() {
  const dark = preference === 'dark' || (preference === 'system' && !!media?.matches)
  document.documentElement.classList.toggle('dark', dark)
  listeners.forEach((l) => l())
}

media?.addEventListener('change', () => {
  if (preference === 'system') apply()
})

export function setThemePreference(p: ThemePreference): void {
  preference = p
  try {
    if (p === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, p)
  } catch {
    /* storage unavailable */
  }
  apply()
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** Current preference plus the resolved theme. */
export function useTheme(): { preference: ThemePreference; resolved: 'light' | 'dark' } {
  const pref = useSyncExternalStore(subscribe, () => preference, () => 'system' as ThemePreference)
  const dark = useSyncExternalStore(
    subscribe,
    () => document.documentElement.classList.contains('dark'),
    () => false,
  )
  return { preference: pref, resolved: dark ? 'dark' : 'light' }
}
