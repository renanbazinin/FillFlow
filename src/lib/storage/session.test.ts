import { describe, expect, it } from 'vitest'
import type { Asset, Element, ImageElement, MarkElement, TextElement } from '../../model/types'
import { buildSession, parseSession, referencedAssets, storedVersion } from './session'

const asset = (id: string): Asset => ({ id, mime: 'image/png', dataUrl: `data:image/png;base64,${id}`, width: 10, height: 5 })

const image = (id: string, assetId: string, page = 0): ImageElement => ({
  id,
  kind: 'image',
  page,
  x: 10,
  y: 20,
  width: 100,
  height: 50,
  role: 'signature',
  assetId,
  opacity: 1,
})

const mark: MarkElement = { id: 'm1', kind: 'mark', page: 1, x: 5, y: 6, width: 14, height: 14, shape: 'check', color: '#111827' }

const text: TextElement = {
  id: 't1',
  kind: 'text',
  page: 0,
  x: 1,
  y: 2,
  width: 30,
  height: 14.4,
  text: 'שלום world',
  fontId: 'sans',
  bold: false,
  fontSize: 12,
  color: '#111827',
  align: 'left',
  lineHeight: 1.2,
  letterSpacing: 0,
}

describe('referencedAssets', () => {
  it('keeps only assets that placed images use, once each', () => {
    const assets = { a: asset('a'), b: asset('b'), c: asset('c') }
    const elements: Element[] = [image('i1', 'a'), mark, image('i2', 'a', 1), image('i3', 'c')]
    expect(referencedAssets(elements, assets)).toEqual({ a: assets.a, c: assets.c })
  })

  it('ignores references to assets that do not exist', () => {
    expect(referencedAssets([image('i1', 'missing')], { a: asset('a') })).toEqual({})
  })
})

describe('buildSession', () => {
  it('snapshots the content and garbage-collects unused assets', () => {
    const assets = { used: asset('used'), deleted: asset('deleted'), undone: asset('undone') }
    const elements: Element[] = [text, mark, image('i1', 'used')]
    const formValues = { 'Full name': 'Ada Lovelace', Agree: true, Referral: ['Friend', 'Event'] }
    const session = buildSession({ docId: 'doc-1', fileName: 'form.pdf', elements, formValues, assets }, 1234)
    expect(session).toEqual({
      version: 1,
      docId: 'doc-1',
      fileName: 'form.pdf',
      elements,
      formValues,
      assets: { used: assets.used },
      updatedAt: 1234,
    })
  })

  it('never stores a blank text block (a new one still being typed into)', () => {
    const blank = { ...text, id: 'blank', text: '' }
    const spaces = { ...text, id: 'spaces', text: ' \n\t ' }
    const session = buildSession({ docId: 'd', fileName: 'f.pdf', elements: [blank, mark, spaces, text], formValues: {}, assets: {} }, 1)
    expect(session.elements.map((e) => e.id)).toEqual(['m1', 't1'])
  })

  it('stores an empty session after everything was cleared', () => {
    const session = buildSession({ docId: 'd', fileName: 'f.pdf', elements: [], formValues: {}, assets: { a: asset('a') } }, 1)
    expect(session.elements).toEqual([])
    expect(session.assets).toEqual({})
  })

  it('round-trips through structured clone and parseSession', () => {
    const session = buildSession(
      { docId: 'd', fileName: 'f.pdf', elements: [text, image('i', 'a')], formValues: { x: 'y' }, assets: { a: asset('a') } },
      99,
    )
    expect(parseSession(structuredClone(session))).toEqual(session)
  })
})

describe('parseSession', () => {
  const valid = () =>
    structuredClone(
      buildSession({ docId: 'd', fileName: 'f.pdf', elements: [text, mark, image('i', 'a')], formValues: { n: 'v' }, assets: { a: asset('a') } }, 5),
    )

  it('rejects anything that is not a v1 session', () => {
    expect(parseSession(undefined)).toBeNull()
    expect(parseSession(null)).toBeNull()
    expect(parseSession('session')).toBeNull()
    expect(parseSession([])).toBeNull()
    expect(parseSession({ ...valid(), version: 2 })).toBeNull()
    expect(parseSession({ ...valid(), docId: 42 })).toBeNull()
  })

  it('drops elements that could not be rendered, keeps the rest', () => {
    const raw = valid() as unknown as Record<string, unknown>
    raw.elements = [
      ...(raw.elements as unknown[]),
      null,
      'nope',
      { ...mark, id: 'bad-kind', kind: 'video' },
      { ...mark, id: 'bad-page', page: -1 },
      { ...mark, id: 'nan', x: Number.NaN },
      { ...text, id: 'no-text', text: undefined },
      { ...text, id: 'zero-font', fontSize: 0 },
      image('orphan', 'gone'),
      { id: 'ink-bad', kind: 'ink', page: 0, x: 0, y: 0, width: 1, height: 1 },
    ]
    const parsed = parseSession(raw)
    expect(parsed?.elements.map((e) => e.id)).toEqual(['t1', 'm1', 'i'])
    expect(Object.keys(parsed?.assets ?? {})).toEqual(['a'])
  })

  it('fills in missing containers', () => {
    const parsed = parseSession({ version: 1, docId: 'd' })
    expect(parsed).toEqual({ version: 1, docId: 'd', fileName: '', elements: [], formValues: {}, assets: {}, updatedAt: 0 })
  })

  it('drops blank text blocks saved by an earlier build', () => {
    const raw = valid() as unknown as Record<string, unknown>
    raw.elements = [{ ...text, id: 'empty', text: '' }, { ...text, id: 'spaces', text: '   ' }, mark]
    expect(parseSession(raw)?.elements.map((e) => e.id)).toEqual(['m1'])
  })

  it('gives text blocks a style this build supports instead of failing to open', () => {
    const raw = valid() as unknown as Record<string, unknown>
    raw.elements = [
      { ...text, id: 'odd', fontId: 'script', bold: 'yes', align: 'justify', lineHeight: 0, letterSpacing: null, color: 7 },
      { ...text, id: 'fine', fontId: 'mono', bold: true, align: 'right', lineHeight: 1.5, letterSpacing: 2, color: '#c81e1e' },
    ]
    const [odd, fine] = (parseSession(raw)?.elements ?? []) as TextElement[]
    expect(odd).toMatchObject({ id: 'odd', text: text.text, fontId: 'sans', bold: false, align: 'left', lineHeight: 1.2, letterSpacing: 0, color: '#111827' })
    expect(fine).toEqual({ ...text, id: 'fine', fontId: 'mono', bold: true, align: 'right', lineHeight: 1.5, letterSpacing: 2, color: '#c81e1e' })
  })
})

describe('storedVersion', () => {
  it('is the record’s updatedAt, or 0', () => {
    expect(storedVersion(buildSession({ docId: 'd', fileName: 'f.pdf', elements: [], formValues: {}, assets: {} }, 5))).toBe(5)
    expect(storedVersion(undefined)).toBe(0)
    expect(storedVersion({ version: 1, docId: 'd' })).toBe(0)
    expect(storedVersion('junk')).toBe(0)
  })
})
