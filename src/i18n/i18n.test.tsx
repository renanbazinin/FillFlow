import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { dirOf, getLocale, getT, LOCALES, matchLocale, messagesFor, richText, setLocale } from '.'

/** Every message in a dictionary, by its path ("home.dropzone.title"). */
function entries(node: unknown, path = ''): [string, unknown][] {
  if (typeof node === 'string' || typeof node === 'function') return [[path, node]]
  if (node && typeof node === 'object') {
    return Object.entries(node).flatMap(([k, v]) => entries(v, path ? `${path}.${k}` : k))
  }
  return [[path, node]]
}

/**
 * Words that stay in Latin letters in every language: names, file types and keys. Anything else in
 * Latin letters in a translation is most likely English left behind.
 */
const KEEP_LATIN =
  /\b(FillFlow|GitHub|PDF\.js|pdf-lib|PDFs?|XFA|AcroForm|Adobe|Acrobat|Reader|PNG|JPE?G|SVG|WebP|GIF|HEIC|Ctrl|Shift|Alt|Option|Esc|Enter|Return|Tab|Space|Backspace|Del|Delete|Home|End|Cmd|Windows|Mac|macOS|iOS|iPhone|iPad|Android|Safari|Chrome|Firefox|Edge|IndexedDB|DD|MM|YYYY|pt|px|Ab|Aa)\b/g

type MessageFn = (...args: unknown[]) => unknown

/** Values to call a message function with, so every branch that counts gets tried. */
const SAMPLE_VALUES: unknown[] = [0, 1, 2, 3, 11, 21, 100, 'ABC', 'טופס']

/** What a message prints when it got the wrong kind of argument, or none. */
const BROKEN = /undefined|NaN|\[object Object\]/

/**
 * A translated message function called the ways its English one can be: as many arguments as the
 * English one takes, each the same sample value. Samples the English one can't take (another kind of
 * argument: it throws or prints "undefined") are left out; a translation that throws where English
 * doesn't comes back as an Error.
 */
function calls(translated: MessageFn, english: MessageFn): { args: unknown[]; out: unknown }[] {
  const results: { args: unknown[]; out: unknown }[] = []
  for (const value of SAMPLE_VALUES) {
    const args = Array<unknown>(Math.max(1, english.length)).fill(value)
    let reference: unknown
    try {
      reference = english(...args)
    } catch {
      continue
    }
    if (typeof reference !== 'string' || BROKEN.test(reference)) continue
    let out: unknown
    try {
      out = translated(...args)
    } catch (err) {
      out = err instanceof Error ? err : new Error(String(err))
    }
    results.push({ args, out })
  }
  return results
}

describe('dictionaries', () => {
  const en = entries(messagesFor('en'))
  const enByPath = new Map(en)

  for (const locale of LOCALES.filter((l) => l !== 'en')) {
    const other = new Map(entries(messagesFor(locale)))

    it(`${locale} has every English message, and no others`, () => {
      expect([...other.keys()].sort()).toEqual([...enByPath.keys()].sort())
    })

    it(`${locale} messages are the same kind as the English ones`, () => {
      const mismatched = en.filter(([path, value]) => typeof other.get(path) !== typeof value).map(([p]) => p)
      expect(mismatched).toEqual([])
    })

    it(`${locale} messages give text for every count and value English takes`, () => {
      const broken: string[] = []
      for (const [path, value] of other) {
        if (typeof value === 'string' && !value.trim()) broken.push(`${path}: empty`)
        const english = enByPath.get(path)
        if (typeof value !== 'function' || typeof english !== 'function') continue
        for (const { args, out } of calls(value as MessageFn, english as MessageFn)) {
          if (typeof out !== 'string' || !out.trim() || BROKEN.test(out)) broken.push(`${path}(${args.join(', ')}): ${String(out)}`)
        }
      }
      expect(broken).toEqual([])
    })

    it(`${locale} leaves nothing in English`, () => {
      const leftovers: string[] = []
      const check = (path: string, text: string) => {
        const latin = text.replace(KEEP_LATIN, '').replace(/\{\w+\}/g, '')
        if (/[A-Za-z]{2,}/.test(latin)) leftovers.push(`${path}: ${text}`)
      }
      for (const [path, value] of other) {
        if (typeof value === 'string') check(path, value)
        const english = enByPath.get(path)
        if (typeof value !== 'function' || typeof english !== 'function') continue
        for (const { out } of calls(value as MessageFn, english as MessageFn)) {
          // The inserted sample ("ABC") is the caller's text, not the message's.
          if (typeof out === 'string') check(path, out.replace(/\bABC\b/g, ''))
        }
      }
      expect(leftovers).toEqual([])
    })
  }

  it('English messages are not empty', () => {
    expect(en.filter(([, value]) => typeof value === 'string' && !value.trim()).map(([p]) => p)).toEqual([])
  })
})

describe('matchLocale', () => {
  it('takes the first of the browser languages the interface comes in', () => {
    expect(matchLocale(['he-IL', 'en-US'])).toBe('he')
    expect(matchLocale(['en-US', 'he'])).toBe('en')
    expect(matchLocale(['fr-FR', 'he'])).toBe('he')
    expect(matchLocale(['iw'])).toBe('he')
    expect(matchLocale(['HE_il'])).toBe('he')
  })

  it('falls back to English', () => {
    expect(matchLocale(['fr', 'de-DE'])).toBe('en')
    expect(matchLocale([])).toBe('en')
    expect(matchLocale([''])).toBe('en')
  })
})

describe('locale', () => {
  afterEach(() => setLocale('en'))

  it('is English outside a browser, and switches', () => {
    expect(getLocale()).toBe('en')
    expect(getT().common.cancel).toBe('Cancel')
    setLocale('he')
    expect(getLocale()).toBe('he')
    expect(getT().common.cancel).toBe('ביטול')
  })

  it('knows which way each language reads', () => {
    expect(dirOf('en')).toBe('ltr')
    expect(dirOf('he')).toBe('rtl')
  })
})

describe('richText', () => {
  it('fills the slots with elements, in the message’s own order', () => {
    const html = renderToStaticMarkup(<p>{richText('מבוסס על {a} ו-{b}', { a: <i>A</i>, b: <b>B</b> })}</p>)
    expect(html).toBe('<p>מבוסס על <i>A</i> ו-<b>B</b></p>')
  })

  it('leaves unknown slots as written', () => {
    expect(renderToStaticMarkup(<p>{richText('a {x} b', {})}</p>)).toBe('<p>a {x} b</p>')
  })
})
