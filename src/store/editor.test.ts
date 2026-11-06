import '../features/elements/testing/env'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Element, FormField, MarkElement, PageInfo } from '../model/types'

// The store's document-loading dependencies need a browser; the history logic doesn't.
vi.mock('../lib/pdf/pdfjs', () => ({
  looksLikePdf: () => true,
  openPdf: vi.fn(),
  readPageInfos: vi.fn(),
  stopLoading: (task: { destroy(): Promise<void> }) => void task.destroy(),
  PasswordRequiredError: class extends Error {},
  WorkerUnavailableError: class extends Error {
    readonly network: boolean
    constructor(cause: unknown) {
      super('The pdf.js worker could not be downloaded.')
      this.network = cause instanceof TypeError
    }
  },
}))
vi.mock('../lib/storage/db', () => ({
  hasSession: vi.fn(),
  loadDocumentBytes: vi.fn(),
  loadSession: vi.fn(),
  rememberDocument: vi.fn(),
  StorageUnavailableError: class extends Error {},
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
const { createTextElement, DEFAULT_STYLES, defaultDateFormat } = await import('../model/elements')

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
      text: { fontId: 'serif', fontSize: 18, color: '#1d4ed8', bold: true, align: 'right' },
      mark: { color: '#c81e1e', size: 20 },
      shape: { strokeColor: '#047857', fillColor: null, strokeWidth: 3 },
      ink: { color: '#7c3aed', strokeWidth: 4 },
    }
    expect(parseStyles(saved, 'yyyy-MM-dd')).toEqual({ ...saved, dateFormat: 'yyyy-MM-dd' })
  })

  it('falls back field by field for unknown or broken values', () => {
    const styles = parseStyles(
      {
        text: { fontId: 'script', fontSize: 'big', color: 'red', bold: 1, align: 'justify' },
        mark: { size: -3 },
        shape: { fillColor: '#ffffff', strokeWidth: Number.NaN },
        ink: null,
      },
      'dd-MM',
    )
    expect(styles.text).toEqual(DEFAULT_STYLES.text)
    expect(styles.mark).toEqual(DEFAULT_STYLES.mark)
    expect(styles.shape).toEqual({ ...DEFAULT_STYLES.shape, fillColor: '#ffffff' })
    expect(styles.ink).toEqual(DEFAULT_STYLES.ink)
    expect(styles.dateFormat).toBe(defaultDateFormat())
    expect(parseStyles('garbage').text).toEqual(DEFAULT_STYLES.text)
    expect(parseStyles({ text: { fontSize: 999 } }).text.fontSize).toBe(144)
  })

  it('ignores a date format saved with the other styles: it was never picked, so the locale’s default applies', () => {
    // Older builds saved the default of the day with any style change: month first for en-US.
    vi.stubGlobal('navigator', { language: 'en-US', languages: ['en-US', 'he'] })
    try {
      expect(parseStyles({ ...DEFAULT_STYLES, dateFormat: 'MM/dd/yyyy' }).dateFormat).toBe('dd/MM/yyyy')
      expect(parseStyles({ ...DEFAULT_STYLES, dateFormat: 'MM/dd/yyyy' }, 'MM/dd/yyyy').dateFormat).toBe('MM/dd/yyyy')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('saves a date format only when one is picked, on its own, and keeps the pick after a reload', async () => {
    const stored = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => stored.get(k) ?? null,
      setItem: (k: string, v: string) => void stored.set(k, String(v)),
      removeItem: (k: string) => void stored.delete(k),
    })
    try {
      s().setStyle('text', { bold: true })
      s().setStyle('mark', { size: 20 })
      expect(JSON.parse(stored.get('fillflow:styles')!)).not.toHaveProperty('dateFormat')
      expect(stored.has('fillflow:dateFormat')).toBe(false)

      s().setStyle('dateFormat', 'dd.MM.yyyy')
      expect(stored.get('fillflow:dateFormat')).toBe('dd.MM.yyyy')
      s().setStyle('ink', { strokeWidth: 3 })
      expect(JSON.parse(stored.get('fillflow:styles')!)).not.toHaveProperty('dateFormat')

      // A reload: a new store reads what was saved.
      vi.resetModules()
      const reloaded = (await import('./editor')).useEditor.getState().styles
      expect(reloaded).toMatchObject({ dateFormat: 'dd.MM.yyyy', text: { bold: true }, mark: { size: 20 }, ink: { strokeWidth: 3 } })
      // An unknown one is no pick.
      stored.set('fillflow:dateFormat', 'yyyy/dd/MM')
      vi.resetModules()
      expect((await import('./editor')).useEditor.getState().styles.dateFormat).toBe(defaultDateFormat())

      // Saved by an older build with another style, month first: no pick, the locale's applies.
      vi.stubGlobal('navigator', { language: 'en-US', languages: ['en-US', 'he'] })
      stored.clear()
      stored.set('fillflow:styles', JSON.stringify({ ...DEFAULT_STYLES, text: { ...DEFAULT_STYLES.text, fontSize: 18 }, dateFormat: 'MM/dd/yyyy' }))
      vi.resetModules()
      expect((await import('./editor')).useEditor.getState().styles).toMatchObject({ dateFormat: 'dd/MM/yyyy', text: { fontSize: 18 } })
    } finally {
      vi.unstubAllGlobals()
      useEditor.setState({ styles: structuredClone(DEFAULT_STYLES) })
    }
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
    // In words for the user: pdf.js's own text goes to the console only.
    expect(s().load).toEqual({
      status: 'error',
      fileName: 'f.pdf',
      message: 'This PDF couldn’t be read. It may be damaged, or use features FillFlow doesn’t support.',
    })
    expect(pdf.loadingTask.destroy).toHaveBeenCalledTimes(1)
  })

  it('never blames the file when pdf.js couldn’t be downloaded, and opens it once it can be', async () => {
    const offline = () => new pdfjs.WorkerUnavailableError(new TypeError('Failed to fetch'))
    vi.mocked(pdfjs.openPdf).mockRejectedValueOnce(offline())
    expect(await s().openDocument(bytes)).toBe(false)
    expect(s().load).toEqual({
      status: 'error',
      fileName: 'f.pdf',
      reason: 'unavailable',
      message: 'FillFlow needs to finish downloading before it can open files. Check your connection and try again.',
    })
    // Offline, it says so.
    vi.stubGlobal('navigator', { onLine: false })
    vi.mocked(pdfjs.openPdf).mockRejectedValueOnce(offline())
    expect(await s().retryOpen()).toBe(false)
    vi.unstubAllGlobals()
    expect(s().load).toMatchObject({ reason: 'unavailable', message: expect.stringMatching(/^You’re offline/) })
    // The server no longer has it (a newer version of the app replaced it), or pdf.js gave up on
    // its worker for the rest of the page's life: only a reload helps.
    for (const failure of [
      new pdfjs.WorkerUnavailableError(new Error('HTTP 404')),
      new Error('Setting up fake worker failed: "Failed to fetch dynamically imported module: https://example.com/pdf.worker.mjs".'),
    ]) {
      vi.mocked(pdfjs.openPdf).mockRejectedValueOnce(failure)
      expect(await s().retryOpen()).toBe(false)
      expect(s().load).toEqual({
        status: 'error',
        fileName: 'f.pdf',
        reason: 'unavailable',
        message: 'FillFlow couldn’t download what it needs to open files. Reload the page and try again.',
      })
    }

    // Back online: the same file opens, without choosing it again.
    const pdf = fakePdf()
    vi.mocked(pdfjs.openPdf).mockClear().mockResolvedValueOnce(pdf as never)
    vi.mocked(pdfjs.readPageInfos).mockResolvedValueOnce([])
    vi.mocked(db.loadSession).mockResolvedValueOnce(null)
    vi.mocked(db.rememberDocument).mockResolvedValueOnce()
    expect(await s().retryOpen()).toBe(true)
    expect(pdfjs.openPdf).toHaveBeenCalledWith(bytes.bytes, undefined, expect.any(AbortSignal))
    expect(s().doc).toMatchObject({ name: 'f.pdf', pdf })
    expect(s().load).toEqual({ status: 'idle' })
    // Nothing is left to try again.
    expect(await s().retryOpen()).toBe(false)
  })

  it('only the file’s own failures offer no second try', async () => {
    vi.mocked(pdfjs.openPdf).mockRejectedValueOnce(Object.assign(new Error('Invalid PDF structure.'), { name: 'InvalidPDFException' }))
    await s().openDocument(bytes)
    expect(s().load).toEqual({ status: 'error', fileName: 'f.pdf', message: 'This PDF is damaged or not a valid PDF file.' })
    vi.mocked(pdfjs.openPdf).mockClear()
    expect(await s().retryOpen()).toBe(false)
    expect(pdfjs.openPdf).not.toHaveBeenCalled()
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
    // Its file is gone, but not its work: the same file, opened again, continues it.
    vi.mocked(db.loadDocumentBytes).mockResolvedValueOnce(null)
    vi.mocked(db.hasSession).mockResolvedValueOnce(true)
    expect(await s().openRecent('id', 'f.pdf')).toBe(false)
    expect(s().load).toEqual({
      status: 'error',
      fileName: 'f.pdf',
      reason: 'missing',
      message: 'It isn’t stored on this device, but your work on it is. Choose the same file to pick up where you left off.',
    })
    vi.mocked(db.loadDocumentBytes).mockResolvedValueOnce(null)
    vi.mocked(db.hasSession).mockResolvedValueOnce(false)
    expect(await s().openRecent('id', 'f.pdf')).toBe(false)
    expect(s().load).toMatchObject({ reason: 'missing', message: 'It isn’t stored on this device. Choose it again to open it.' })
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
    expect(s().doc).toMatchObject({ name: 'f.pdf', sessionLoadFailed: true, storageUnavailable: false })
    expect(s().elements).toEqual([])
    expect((await openFully()).opened).toBe(true)
    expect(s().doc?.sessionLoadFailed).toBe(false)
  })

  it('where nothing can be stored, opens a document without any saved work having failed to load', async () => {
    const opened = await openFully(() => Promise.reject(new db.StorageUnavailableError('The user denied permission to access the database.')))
    expect(opened.opened).toBe(true)
    expect(s().doc).toMatchObject({ name: 'f.pdf', sessionLoadFailed: false, storageUnavailable: true })
  })

  it('measures saved text again with its font, keeping it on its page as typing does', async () => {
    const page: PageInfo = { index: 0, width: 600, height: 800, rotation: 0, view: [0, 0, 600, 800], userUnit: 1 }
    // Saved narrower than it is (measured before its font had loaded), 6pt from the right edge.
    const saved = { ...createTextElement(0, { x: 570, y: 400 }, DEFAULT_STYLES.text, 'abcdef'), id: 't', width: 24 }
    vi.mocked(pdfjs.openPdf).mockResolvedValueOnce(fakePdf() as never)
    vi.mocked(pdfjs.readPageInfos).mockResolvedValueOnce([page])
    vi.mocked(db.loadSession).mockResolvedValueOnce({ version: 1, docId: 'x', fileName: 'f.pdf', elements: [saved], formValues: {}, assets: {}, updatedAt: 0 })
    vi.mocked(db.rememberDocument).mockResolvedValueOnce()
    expect(await s().openDocument(bytes)).toBe(true)
    expect(s().elements[0]).toMatchObject({ id: 't', x: 600 - 36, width: 36 })
  })

  it('tells the document whether its file could be stored', async () => {
    const quota = new DOMException('The quota has been exceeded.', 'QuotaExceededError')
    vi.mocked(pdfjs.openPdf).mockResolvedValueOnce(fakePdf() as never)
    vi.mocked(pdfjs.readPageInfos).mockResolvedValueOnce([])
    vi.mocked(db.loadSession).mockResolvedValueOnce(null)
    vi.mocked(db.rememberDocument).mockRejectedValueOnce(quota)
    expect(await s().openDocument(bytes)).toBe(true)
    await expect(s().doc?.stored).rejects.toBe(quota)
    expect((await openFully()).opened).toBe(true)
    await expect(s().doc?.stored).resolves.toBeUndefined()
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

  it('a cancel stops pdf.js at once, and the load it stops is never reported as a failure', async () => {
    vi.mocked(pdfjs.openPdf).mockClear()
    vi.mocked(console.error).mockClear()
    // As pdf.js does: a stopped load fails (or never ends).
    vi.mocked(pdfjs.openPdf).mockImplementationOnce(
      (_bytes, _password, signal) => new Promise((_, reject) => signal?.addEventListener('abort', () => reject(new Error('Loading aborted')))),
    )
    const late = s().openDocument(bytes)
    const signal = vi.mocked(pdfjs.openPdf).mock.lastCall?.[2]
    expect(signal?.aborted).toBe(false)
    s().cancelOpen()
    expect(signal?.aborted).toBe(true)
    expect(await late).toBe(false)
    await settled()
    expect(s().load).toEqual({ status: 'idle' })
    expect(console.error).not.toHaveBeenCalled()
  })

  it('lets go of the parsed document at once when a later step that never ends is given up on, and never of the open one', async () => {
    await openFully()
    const open = s().doc
    const pdf = fakePdf()
    vi.mocked(pdfjs.openPdf).mockResolvedValueOnce(pdf as never)
    vi.mocked(pdfjs.readPageInfos).mockReset().mockReturnValueOnce(new Promise(() => {}))
    const late = s().openDocument({ name: 'g.pdf', bytes: bytes.bytes })
    await vi.waitFor(() => expect(pdfjs.readPageInfos).toHaveBeenCalled())
    s().cancelOpen()
    expect(await late).toBe(false)
    expect(pdf.loadingTask.destroy).toHaveBeenCalledTimes(1)
    expect(s().doc).toBe(open)
    expect(open?.pdf.loadingTask.destroy).not.toHaveBeenCalled()
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
    // pdf.js is told at once.
    expect(vi.mocked(pdfjs.openPdf).mock.lastCall?.[2]?.aborted).toBe(true)
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
