import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Element, FormField, MarkElement } from '../model/types'

// The store's document-loading dependencies need a browser; the history logic doesn't.
vi.mock('../lib/pdf/pdfjs', () => ({
  looksLikePdf: () => true,
  openPdf: vi.fn(),
  readPageInfos: vi.fn(),
  PasswordRequiredError: class extends Error {},
}))
vi.mock('../lib/storage/db', () => ({
  loadDocumentBytes: vi.fn(),
  loadSession: vi.fn(),
  rememberDocument: vi.fn(),
}))
vi.mock('../model/fonts', async (original) => ({ ...(await original<object>()), loadFont: vi.fn(() => Promise.resolve()) }))
vi.mock('../lib/utils/misc', async (original) => {
  const misc = await original<typeof import('../lib/utils/misc')>()
  return { ...misc, sha256Hex: vi.fn(misc.sha256Hex) }
})

const { useEditor, filledCount, parseStyles } = await import('./editor')
const pdfjs = await import('../lib/pdf/pdfjs')
const db = await import('../lib/storage/db')
const misc = await import('../lib/utils/misc')
const { DEFAULT_STYLES } = await import('../model/elements')

const mark = (id: string, x = 10): MarkElement => ({
  id,
  kind: 'mark',
  page: 0,
  x,
  y: 10,
  width: 14,
  height: 14,
  shape: 'check',
  color: '#111827',
})

const s = () => useEditor.getState()

beforeEach(() => {
  s().closeDocument()
})

describe('editor store history', () => {
  it('adds, undoes and redoes elements', () => {
    s().addElement(mark('a'))
    s().addElement(mark('b'))
    expect(s().elements.map((e) => e.id)).toEqual(['a', 'b'])
    expect(s().selection).toEqual(['b'])
    s().undo()
    expect(s().elements.map((e) => e.id)).toEqual(['a'])
    // Undo restores the selection from before the change.
    expect(s().selection).toEqual(['a'])
    s().redo()
    expect(s().elements.map((e) => e.id)).toEqual(['a', 'b'])
  })

  it('collapses a gesture into one undo step and can cancel it', () => {
    s().addElement(mark('a', 0))
    const before = s().past.length
    s().beginGesture()
    for (let x = 1; x <= 20; x++) s().updateElement('a', { x })
    s().endGesture()
    expect(s().past.length).toBe(before + 1)
    expect((s().elements[0] as MarkElement).x).toBe(20)
    s().undo()
    expect((s().elements[0] as MarkElement).x).toBe(0)

    s().beginGesture()
    s().updateElement('a', { x: 99 })
    s().cancelGesture()
    expect((s().elements[0] as MarkElement).x).toBe(0)
  })

  it('does not record an empty gesture', () => {
    s().addElement(mark('a'))
    const before = s().past.length
    s().beginGesture()
    s().endGesture()
    expect(s().past.length).toBe(before)
  })

  it('coalesces updates with the same key', () => {
    s().addElement(mark('a', 0))
    const before = s().past.length
    s().updateElement('a', { x: 1 }, { coalesce: 'nudge' })
    s().updateElement('a', { x: 2 }, { coalesce: 'nudge' })
    s().updateElement('a', { x: 3 }, { coalesce: 'nudge' })
    expect(s().past.length).toBe(before + 1)
    s().updateElement('a', { y: 50 }, { coalesce: 'other' })
    expect(s().past.length).toBe(before + 2)
  })

  it('clears redo on a new change and prunes selection on undo', () => {
    s().addElement(mark('a'))
    s().undo()
    expect(s().future.length).toBe(1)
    s().addElement(mark('b'))
    expect(s().future.length).toBe(0)
    s().select(['b'])
    s().undo()
    expect(s().selection).toEqual([])
  })

  it('never removes locked elements', () => {
    s().addElement({ ...mark('a'), locked: true } as Element)
    s().addElement(mark('b'))
    s().removeElements(['a', 'b'])
    expect(s().elements.map((e) => e.id)).toEqual(['a'])
  })

  it('duplicates with an offset and selects the copies', () => {
    s().addElement(mark('a', 10))
    const ids = s().duplicateElements(['a'], 12)
    expect(ids).toHaveLength(1)
    expect(s().selection).toEqual(ids)
    const copy = s().elements.find((e) => e.id === ids[0]) as MarkElement
    expect(copy.x).toBe(22)
    expect(copy.id).not.toBe('a')
  })

  it('reorders to front and back', () => {
    s().addElements([mark('a'), mark('b'), mark('c')])
    s().reorderElements(['a'], 'front')
    expect(s().elements.map((e) => e.id)).toEqual(['b', 'c', 'a'])
    s().reorderElements(['a'], 'back')
    expect(s().elements.map((e) => e.id)).toEqual(['a', 'b', 'c'])
  })

  it('tracks form values with undo and resets them with clearAll', () => {
    const field: FormField = {
      name: 'name',
      type: 'text',
      widgets: [],
      readOnly: false,
      required: false,
      defaultValue: 'orig',
    }
    useEditor.setState({ doc: { id: 'x', name: 'x.pdf', bytes: new Uint8Array(), pdf: {} as never, pages: [], formFields: [field] } })
    s().setFormValue('name', 'A', { coalesce: 'field:name' })
    s().setFormValue('name', 'AB', { coalesce: 'field:name' })
    expect(s().formValues.name).toBe('AB')
    s().undo()
    expect(s().formValues.name).toBeUndefined()
    s().redo()
    s().addElement(mark('m'))
    s().clearAll()
    expect(s().elements).toEqual([])
    expect(s().formValues).toEqual({ name: 'orig' })
    useEditor.setState({ doc: null })
  })

  it('never takes a property every object inherits for the value of a field named after it', () => {
    const field = (name: string): FormField => ({ name, type: 'text', widgets: [], readOnly: false, required: false, defaultValue: '' })
    const formFields = ['constructor', '__proto__', 'toString'].map(field)
    const pdf = { loadingTask: { destroy: async () => {} } } as never
    useEditor.setState({ doc: { id: 'x', name: 'x.pdf', bytes: new Uint8Array(), pdf, pages: [], formFields } })
    expect(filledCount()).toBe(0)
    s().setFormValue('__proto__', 'Ada')
    s().setFormValue('constructor', '')
    expect(Object.hasOwn(s().formValues, '__proto__')).toBe(true)
    expect(s().formValues).toEqual({ ['__proto__']: 'Ada', constructor: '' })
    expect(filledCount()).toBe(1)
    useEditor.setState({ doc: null })
  })

  it('bumps revision on content changes only', () => {
    const r0 = s().revision
    s().select([])
    s().setScale(2)
    expect(s().revision).toBe(r0)
    s().addElement(mark('a'))
    expect(s().revision).toBe(r0 + 1)
  })

  it('keeps locked items when clearing everything', () => {
    s().addElements([{ ...mark('a'), locked: true } as Element, mark('b')])
    s().select(['a', 'b'])
    s().clearAll()
    expect(s().elements.map((e) => e.id)).toEqual(['a'])
    expect(s().selection).toEqual(['a'])
    s().undo()
    expect(s().elements.map((e) => e.id)).toEqual(['a', 'b'])
  })

  it('records nothing for a gesture that ends where it started, and keeps redo', () => {
    s().addElement(mark('a', 50))
    s().addElement(mark('b'))
    s().undo()
    const before = s().past.length
    // Pushing against the page edge: every move re-applies the same position.
    s().beginGesture()
    s().updateElements({ a: { x: 50 } })
    s().updateElements({ a: { x: 50 } })
    s().endGesture()
    // Dragged away and back.
    s().beginGesture()
    s().updateElement('a', { x: 80 })
    s().updateElement('a', { x: 50 })
    s().endGesture()
    expect(s().past.length).toBe(before)
    expect(s().future).toHaveLength(1)
  })

  it('records nothing for changes that change nothing, and keeps redo', () => {
    s().addElements([mark('a'), mark('b')])
    s().addElement(mark('c'))
    s().undo()
    const { past, revision } = s()
    s().reorderElements(['b'], 'front')
    s().reorderElements(['a'], 'back')
    s().updateElement('a', { x: 10 })
    expect(s().past).toBe(past)
    expect(s().future).toHaveLength(1)
    expect(s().revision).toBe(revision)
  })

  it('folds a history-free change into the latest step, dropping a step left changing nothing', () => {
    s().addElement(mark('a', 0))
    const before = s().past.length
    s().updateElement('a', { x: 5 })
    s().updateElement('a', { y: 30 }, { history: false })
    expect(s().past.length).toBe(before + 1)
    s().undo()
    expect(s().elements[0]).toMatchObject({ x: 0, y: 10 })
    s().redo()
    s().updateElement('a', { x: 0, y: 10 }, { history: false })
    expect(s().past.length).toBe(before)
    s().addElement(mark('b'))
    s().removeElements(['b'], { history: false })
    expect(s().past.length).toBe(before)
  })
})

describe('style defaults', () => {
  it('keeps valid saved values', () => {
    const saved = {
      text: { fontId: 'serif', fontSize: 18, color: '#1d4ed8', bold: true },
      mark: { color: '#c81e1e', size: 20 },
      shape: { strokeColor: '#047857', fillColor: null, strokeWidth: 3 },
      ink: { color: '#7c3aed', strokeWidth: 4 },
      dateFormat: 'yyyy-MM-dd',
    }
    expect(parseStyles(saved)).toEqual(saved)
  })

  it('falls back field by field for unknown or broken values', () => {
    const styles = parseStyles({
      text: { fontId: 'script', fontSize: 'big', color: 'red', bold: 1 },
      mark: { size: -3 },
      shape: { fillColor: '#ffffff', strokeWidth: Number.NaN },
      ink: null,
      dateFormat: 'dd-MM',
    })
    expect(styles.text).toEqual(DEFAULT_STYLES.text)
    expect(styles.mark).toEqual(DEFAULT_STYLES.mark)
    expect(styles.shape).toEqual({ ...DEFAULT_STYLES.shape, fillColor: '#ffffff' })
    expect(styles.ink).toEqual(DEFAULT_STYLES.ink)
    expect(['dd/MM/yyyy', 'MM/dd/yyyy']).toContain(styles.dateFormat)
    expect(parseStyles('garbage').text).toEqual(DEFAULT_STYLES.text)
    expect(parseStyles({ text: { fontSize: 999 } }).text.fontSize).toBe(144)
  })
})

describe('opening documents', () => {
  const fakePdf = () => ({ loadingTask: { destroy: vi.fn(() => Promise.resolve()) } })
  const bytes = { name: 'f.pdf', bytes: new Uint8Array([37, 80, 68, 70]) }

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it('destroys the parsed document when a later step fails', async () => {
    const pdf = fakePdf()
    vi.mocked(pdfjs.openPdf).mockResolvedValueOnce(pdf as never)
    vi.mocked(pdfjs.readPageInfos).mockRejectedValueOnce(new Error('Invalid page request.'))
    expect(await s().openDocument(bytes)).toBe(false)
    expect(s().load).toMatchObject({ status: 'error', message: 'Invalid page request.' })
    expect(pdf.loadingTask.destroy).toHaveBeenCalledTimes(1)
  })

  it('destroys a document that finishes opening after hashing failed', async () => {
    const pdf = fakePdf()
    let resolve!: (p: unknown) => void
    vi.mocked(pdfjs.openPdf).mockReturnValueOnce(new Promise((r) => (resolve = r)) as never)
    vi.mocked(misc.sha256Hex).mockRejectedValueOnce(new Error('no crypto'))
    expect(await s().openDocument(bytes)).toBe(false)
    resolve(pdf)
    await vi.waitFor(() => expect(pdf.loadingTask.destroy).toHaveBeenCalledTimes(1))
  })

  it('forgets the pending file after a failed password retry or a dismissed error', async () => {
    vi.mocked(pdfjs.openPdf).mockClear()
    vi.mocked(pdfjs.openPdf).mockRejectedValueOnce(new pdfjs.PasswordRequiredError(false))
    await s().openDocument(bytes)
    expect(s().load.status).toBe('password')
    vi.mocked(pdfjs.openPdf).mockResolvedValueOnce(fakePdf() as never)
    vi.mocked(pdfjs.readPageInfos).mockRejectedValueOnce(new Error('broken'))
    await s().submitPassword('secret')
    expect(s().load.status).toBe('error')
    await s().submitPassword('again')
    expect(pdfjs.openPdf).toHaveBeenCalledTimes(2)
    expect(s().load.status).toBe('idle')

    vi.mocked(pdfjs.openPdf).mockRejectedValueOnce(new pdfjs.PasswordRequiredError(false))
    await s().openDocument(bytes)
    s().dismissLoadError()
    await s().submitPassword('late')
    expect(pdfjs.openPdf).toHaveBeenCalledTimes(3)
  })

  it('tells a failed read of a stored document apart from a missing one', async () => {
    vi.mocked(db.loadDocumentBytes).mockRejectedValueOnce(new Error('NotReadableError'))
    expect(await s().openRecent('id', 'f.pdf')).toBe(false)
    expect(s().load).toMatchObject({ status: 'error', message: 'Couldn’t read this document from this device’s storage.' })
    vi.mocked(db.loadDocumentBytes).mockResolvedValueOnce(null)
    expect(await s().openRecent('id', 'f.pdf')).toBe(false)
    expect(s().load).toMatchObject({ status: 'error', message: 'This document is no longer stored on this device.' })
  })

  /** A promise settled by the test. */
  function deferred<T>() {
    let resolve!: (value: T) => void
    let reject!: (err: unknown) => void
    const promise = new Promise<T>((res, rej) => {
      resolve = res
      reject = rej
    })
    return { promise, resolve, reject }
  }

  /** Opens `bytes`, every step succeeding; `readSession` stands in for reading its saved work. */
  async function openFully(readSession: () => Promise<null> = async () => null) {
    const pdf = fakePdf()
    vi.mocked(pdfjs.openPdf).mockResolvedValueOnce(pdf as never)
    vi.mocked(pdfjs.readPageInfos).mockResolvedValueOnce([])
    vi.mocked(db.loadSession).mockImplementationOnce(readSession)
    vi.mocked(db.rememberDocument).mockResolvedValueOnce()
    const opened = await s().openDocument(bytes)
    return { pdf, opened }
  }

  it('opens a document whose saved work can’t be read without it, and says so on the document', async () => {
    const lost = await openFully(() => Promise.reject(new DOMException('Data lost due to missing file.', 'NotReadableError')))
    expect(lost.opened).toBe(true)
    expect(s().doc).toMatchObject({ name: 'f.pdf', sessionLoadFailed: true })
    expect(s().elements).toEqual([])
    expect((await openFully()).opened).toBe(true)
    expect(s().doc?.sessionLoadFailed).toBe(false)
  })

  /** Lets pending promise chains run. */
  const settled = () => new Promise((resolve) => setTimeout(resolve, 0))

  it('a cancelled open never applies nor is waited on, lets go of what it parsed and leaves the open document', async () => {
    await openFully()
    const open = s().doc
    const parsing = deferred<unknown>()
    vi.mocked(pdfjs.openPdf).mockReturnValueOnce(parsing.promise as never)
    vi.mocked(pdfjs.readPageInfos).mockClear()
    const late = s().openDocument({ name: 'g.pdf', bytes: bytes.bytes })
    expect(s().load).toEqual({ status: 'loading', fileName: 'g.pdf' })
    s().cancelOpen()
    expect(s().load).toEqual({ status: 'idle' })
    // Settled at once, while pdf.js is still busy (a stalled load may never finish).
    expect(await late).toBe(false)
    const pdf = fakePdf()
    parsing.resolve(pdf)
    await vi.waitFor(() => expect(pdf.loadingTask.destroy).toHaveBeenCalledTimes(1))
    expect(pdfjs.readPageInfos).not.toHaveBeenCalled()
    expect(s().doc).toBe(open)
    expect(open?.pdf.loadingTask.destroy).not.toHaveBeenCalled()
    expect(s().load).toEqual({ status: 'idle' })
  })

  it('a stored document read after a cancel neither opens nor reports a failure', async () => {
    vi.mocked(pdfjs.openPdf).mockClear()
    const found = deferred<Uint8Array | null>()
    vi.mocked(db.loadDocumentBytes).mockReturnValueOnce(found.promise)
    const late = s().openRecent('id', 'f.pdf')
    s().cancelOpen()
    expect(await late).toBe(false)
    found.resolve(bytes.bytes)
    await settled()
    expect(pdfjs.openPdf).not.toHaveBeenCalled()

    const failed = deferred<Uint8Array | null>()
    vi.mocked(db.loadDocumentBytes).mockReturnValueOnce(failed.promise)
    const lateFailure = s().openRecent('id', 'f.pdf')
    s().cancelOpen()
    expect(await lateFailure).toBe(false)
    failed.reject(new Error('NotReadableError'))
    await settled()
    expect(s().load).toEqual({ status: 'idle' })
  })

  it('the open started last wins, however long reading the earlier file takes', async () => {
    const file = new File([bytes.bytes], 'slow.pdf', { type: 'application/pdf' })
    const reading = deferred<ArrayBuffer>()
    vi.spyOn(file, 'arrayBuffer').mockReturnValueOnce(reading.promise)
    const slow = s().openDocument(file)
    expect((await openFully()).opened).toBe(true)
    expect(await slow).toBe(false)
    reading.resolve(bytes.bytes.slice().buffer)
    await settled()
    expect(s().doc?.name).toBe('f.pdf')
    expect(s().load).toEqual({ status: 'idle' })
  })

  it('cancels the password prompt, even while the password is being tried', async () => {
    vi.mocked(pdfjs.openPdf).mockRejectedValueOnce(new pdfjs.PasswordRequiredError(false))
    await s().openDocument(bytes)
    expect(s().load.status).toBe('password')
    const trying = deferred<unknown>()
    vi.mocked(pdfjs.openPdf).mockReturnValueOnce(trying.promise as never)
    const attempt = s().submitPassword('secret')
    expect(s().load).toEqual({ status: 'loading', fileName: 'f.pdf', unlocking: true })
    await s().submitPassword(null)
    expect(s().load).toEqual({ status: 'idle' })
    await attempt
    const pdf = fakePdf()
    trying.resolve(pdf)
    await vi.waitFor(() => expect(pdf.loadingTask.destroy).toHaveBeenCalledTimes(1))
    expect(s().doc).toBeNull()
    // Nothing is left to retry.
    await s().submitPassword('again')
    expect(s().load).toEqual({ status: 'idle' })
  })
})
