/**
 * The interface's languages. Components read their strings with `const t = useT()` (and re-render
 * when the language changes); code outside React reads them with `getT()` when it runs. Strings
 * live in ./en (the source) and ./he, one module per area; see ./README.md.
 */
import { en } from './en'
import { he } from './he'
import { getLocale, useLocale, type Locale } from './locale'
import type { Messages } from './messages'

export { dirOf, getLocale, isLocale, LOCALES, matchLocale, setLocale, useDir, useLocale } from './locale'
export type { Direction, Locale } from './locale'
export type { Messages } from './messages'
export { richText } from './rich'

const MESSAGES: Record<Locale, Messages> = { en, he }

/** Each language's own name, written in it (what the language switch offers). */
export const LANGUAGE_NAMES: Record<Locale, string> = { en: 'English', he: 'עברית' }

/** The strings of the current language, for code outside components (read them when they're used). */
export function getT(): Messages {
  return MESSAGES[getLocale()]
}

/** The strings of the current language; the component re-renders when it changes. */
export function useT(): Messages {
  return MESSAGES[useLocale()]
}

/** A language's strings, whatever the current one is (tests, the language switch). */
export function messagesFor(locale: Locale): Messages {
  return MESSAGES[locale]
}
