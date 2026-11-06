import { useSyncExternalStore } from 'react'

/** The interface languages, English first (the fallback). */
export const LOCALES = ['en', 'he'] as const
export type Locale = (typeof LOCALES)[number]
export type Direction = 'ltr' | 'rtl'

/** Keep the storage key in sync with the inline script in index.html. */
const KEY = 'fillflow:locale'

const RIGHT_TO_LEFT: ReadonlySet<Locale> = new Set(['he'])

export const isLocale = (v: unknown): v is Locale => LOCALES.includes(v as Locale)

/** Which way a language's interface reads. */
export const dirOf = (locale: Locale): Direction => (RIGHT_TO_LEFT.has(locale) ? 'rtl' : 'ltr')

/**
 * The first of the browser's languages (most preferred first) the interface comes in, or English.
 * "iw" is Hebrew's old code, still sent by some older Android and Java browsers. Keep in sync
 * with the inline script in index.html.
 */
export function matchLocale(languages: readonly string[]): Locale {
  for (const tag of languages) {
    const base = tag.toLowerCase().split(/[-_]/)[0]
    if (base === 'iw') return 'he'
    if (isLocale(base)) return base
  }
  return 'en'
}

function browserLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') return []
  return navigator.languages?.length ? navigator.languages : [navigator.language ?? '']
}

/** The language picked on this device, if one was. */
function savedLocale(): Locale | null {
  try {
    const v = localStorage.getItem(KEY)
    return isLocale(v) ? v : null
  } catch {
    return null // storage unavailable
  }
}

// Outside a browser (unit tests run in Node, whose navigator reports the machine's language), English.
let locale: Locale = typeof window !== 'undefined' ? (savedLocale() ?? matchLocale(browserLanguages())) : 'en'

const listeners = new Set<() => void>()

/** <html lang dir> follow the language: CSS (:dir(), logical properties) and screen readers go by them. */
function apply() {
  // Outside a browser there may be no document, or (a test's stand-in) one without <html>.
  const root = typeof document === 'undefined' ? undefined : document.documentElement
  if (!root) return
  root.lang = locale
  root.dir = dirOf(locale)
}

apply()

export function getLocale(): Locale {
  return locale
}

/** Switches the interface language and remembers the choice on this device. */
export function setLocale(next: Locale, { remember = true }: { remember?: boolean } = {}): void {
  if (remember) {
    try {
      localStorage.setItem(KEY, next)
    } catch {
      /* storage unavailable: the choice lasts until the page is reloaded */
    }
  }
  if (next === locale) return
  locale = next
  apply()
  listeners.forEach((l) => l())
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

const snapshot = () => locale

/** The interface language; the component re-renders when it changes. */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

/** Which way the interface reads; the component re-renders when it changes. */
export function useDir(): Direction {
  return dirOf(useLocale())
}
