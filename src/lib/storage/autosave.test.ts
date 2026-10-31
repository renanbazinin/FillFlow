import 'fake-indexeddb/auto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import type { FormField, ImageElement, MarkElement, TextElement } from '../../model/types'
import { useEditor, type LoadedDocument } from '../../store/editor'
import { AUTOSAVE_DELAY_MS, SESSIONS_CHANNEL, flushAutosave, startAutosave } from './autosave'
import { clearAllData, getRecentDocument, loadSession, rememberDocument, saveSession } from './db'
import { useSaveStatusStore } from './saveStatus'
import { buildSession } from './session'
import { renderThumbnail } from './thumbnail'

// The real store and the real IndexedDB layer (fake-indexeddb); only pdf.js, rendering and
// toasts are replaced.
vi.mock('../pdf/pdfjs', () => ({
  looksLikePdf: () => true,
  openPdf: vi.fn(),
  readPageInfos: vi.fn(),
  PasswordRequiredError: class extends Error {},
}))
vi.mock('./thumbnail', () => ({
  renderThumbnail: vi.fn(async () => 'data:image/jpeg;base64,THUMB'),
  whenIdle: vi.fn(async () => {}),
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), dismiss: vi.fn() } }))
vi.mock('./db', async (importOriginal) => {
  const real = await importOriginal<typeof import('./db')>()
  return { ...real, saveSession: vi.fn(real.saveSession) }
})

const page = { index: 0, width: 600, height: 800, rotation: 0 as const, view: [0, 0, 600, 800] as [number, number, number, number], userUnit: 1 }
const nameField: FormField = {
  name: 'Name',
  type: 'text',
  widgets: [{ id: 'w1', page: 0, rect: { x: 10, y: 10, width: 100, height: 20 } }],
  readOnly: false,
  required: true,
  defaultValue: '',
}

function makeDoc(id: string): LoadedDocument {
  const pdf = { loadingTask: { destroy: async () => {} } } as unknown as LoadedDocument['pdf']
  return { id, name: `${id}.pdf`, bytes: new Uint8Array([37, 80, 68, 70]), pdf, pages: [page], formFields: [nameField] }
}

/** What the store does when a document finishes opening (with the form values its load found). */
function open(doc: LoadedDocument | null, formValues: Record<string, string> = doc ? { Name: '' } : {}) {
  useEditor.setState({
    doc,
    load: { status: 'idle' },
    elements: [],
    formValues,
    assets: {},
    past: [],
    future: [],
    revision: 0,
    selection: [],
  })
}

let markN = 0
const mark = (): MarkElement => ({ id: `m${++markN}`, kind: 'mark', page: 0, x: 10, y: 10, width: 14, height: 14, shape: 'check', color: '#111827' })
const text = (value: string): TextElement => ({
  id: `t${++markN}`,
  kind: 'text',
  page: 0,
  x: 10,
  y: 40,
  width: 7.2,
  height: 14.4,
  text: value,
  fontId: 'sans',
  bold: false,
  fontSize: 12,
  color: '#111827',
  align: 'left',
  lineHeight: 1.2,
  letterSpacing: 0,
})
const quota = new DOMException('The quota has been exceeded.', 'QuotaExceededError')

/** A real (never faked) macrotask: fake-indexeddb schedules its work with setImmediate. */
const nextTask = () =>
  new Promise<void>((resolve) => (globalThis as unknown as { setImmediate(cb: () => void): void }).setImmediate(resolve))

/** Lets pending IndexedDB requests and promise chains finish. */
async function settle() {
  for (let i = 0; i < 20; i++) await nextTask()
}

async function waitForSave() {
  await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS)
  await settle()
}

const status = () => useSaveStatusStore.getState()
const saveMock = vi.mocked(saveSession)

let stop: (() => void) | null = null
let visibility: 'visible' | 'hidden' = 'visible'

beforeAll(() => {
  const doc = new EventTarget()
  Object.defineProperty(doc, 'visibilityState', { get: () => visibility })
  vi.stubGlobal('document', doc)
  vi.stubGlobal('window', new EventTarget())
})

afterAll(() => {
  vi.unstubAllGlobals()
})

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  await clearAllData()
  saveMock.mockClear()
  vi.mocked(toast.error).mockClear()
  vi.mocked(toast.dismiss).mockClear()
  vi.mocked(renderThumbnail).mockClear()
  open(null)
  visibility = 'visible'
})

afterEach(async () => {
  stop?.()
  stop = null
  await settle()
  vi.useRealTimers()
})

/** Opens a stored document the way the store does: its saved work is loaded first. */
async function openRemembered(id: string) {
  const doc = makeDoc(id)
  await rememberDocument({ id, name: doc.name, size: 4, pageCount: 1 }, doc.bytes)
  await loadSession(id)
  open(doc)
  return doc
}

describe('autosave', () => {
  it('never saves a freshly opened, untouched document', async () => {
    await openRemembered('fresh')
    stop = startAutosave()
    await vi.advanceTimersByTimeAsync(5000)
    await settle()
    expect(saveMock).not.toHaveBeenCalled()
    expect(status().state).toBe('idle')
    expect(await loadSession('fresh')).toBeNull()
  })

  it('debounces changes into one save and updates the recents progress', async () => {
    await openRemembered('doc')
    stop = startAutosave()
    const { addElement, setFormValue } = useEditor.getState()
    addElement(mark())
    expect(status().state).toBe('saving')
    await vi.advanceTimersByTimeAsync(300)
    setFormValue('Name', 'Ada')
    await vi.advanceTimersByTimeAsync(300)
    expect(saveMock).not.toHaveBeenCalled()
    await waitForSave()
    expect(saveMock).toHaveBeenCalledTimes(1)
    const session = await loadSession('doc')
    expect(session?.elements).toHaveLength(1)
    expect(session?.formValues).toEqual({ Name: 'Ada' })
    expect(status()).toMatchObject({ state: 'saved', savedAt: expect.any(Number) })
    expect((await getRecentDocument('doc'))?.filledCount).toBe(2)
    expect((await getRecentDocument('doc'))?.editedAt).toBe(session?.updatedAt)
  })

  it('skips the write when an undo returns to what is stored', async () => {
    await openRemembered('undo')
    stop = startAutosave()
    useEditor.getState().addElement(mark())
    await vi.advanceTimersByTimeAsync(100)
    useEditor.getState().undo()
    expect(status().state).toBe('idle')
    await waitForSave()
    expect(saveMock).not.toHaveBeenCalled()
  })

  it('saves after the user clears everything', async () => {
    await openRemembered('clear')
    stop = startAutosave()
    useEditor.getState().addElement(mark())
    await waitForSave()
    useEditor.getState().clearAll()
    await waitForSave()
    expect(saveMock).toHaveBeenCalledTimes(2)
    expect((await loadSession('clear'))?.elements).toEqual([])
    expect((await getRecentDocument('clear'))?.filledCount).toBe(0)
  })

  it('stores only the assets that placed images reference', async () => {
    await openRemembered('assets')
    stop = startAutosave()
    const { addAsset, addElement } = useEditor.getState()
    const unused = addAsset({ mime: 'image/png', dataUrl: 'data:image/png;base64,AA', width: 2, height: 1 })
    await waitForSave()
    expect(saveMock).not.toHaveBeenCalled() // an asset alone changes nothing visible
    const used = addAsset({ mime: 'image/png', dataUrl: 'data:image/png;base64,BB', width: 2, height: 1 })
    const img: ImageElement = { id: 'img', kind: 'image', page: 0, x: 0, y: 0, width: 20, height: 10, role: 'signature', assetId: used, opacity: 1 }
    addElement(img)
    await waitForSave()
    const session = await loadSession('assets')
    expect(Object.keys(session?.assets ?? {})).toEqual([used])
    expect(session?.assets[unused]).toBeUndefined()
  })

  it('flushes pending work when another document opens, and resets the status', async () => {
    await openRemembered('first')
    stop = startAutosave()
    useEditor.getState().addElement(mark())
    expect(status().state).toBe('saving')
    await openRemembered('second')
    await settle()
    expect(saveMock).toHaveBeenCalledTimes(1)
    expect((await loadSession('first'))?.elements).toHaveLength(1)
    expect(status().state).toBe('idle')
    await vi.advanceTimersByTimeAsync(5000)
    await settle()
    expect(await loadSession('second')).toBeNull()
  })

  describe('when the open file is opened again', () => {
    /** Opens 'again' the way the store does, and saves a first change. */
    async function openAgainDoc() {
      await loadSession('again')
      await openRemembered('again')
      stop = startAutosave()
      useEditor.getState().setFormValue('Name', 'Ada L')
      // Opening the file again: the leave guard writes the pending work first.
      await flushAutosave()
      await settle()
    }

    it('keeps saving when changes still reached the copy it replaces during the load', async () => {
      await openAgainDoc()
      await loadSession('again') // the new copy's load
      useEditor.getState().setFormValue('Name', 'Ada Lovelace') // typing on during the load
      open(makeDoc('again'), { Name: 'Ada L' })
      await settle()
      // The replaced copy's late change is written as it is retired…
      expect((await loadSession('again'))?.formValues).toEqual({ Name: 'Ada Lovelace' })
      // …and isn't taken for another tab's work: the new copy keeps saving.
      useEditor.getState().addElement(mark())
      await waitForSave()
      expect(status().state).toBe('saved')
      expect(toast.error).not.toHaveBeenCalled()
      const session = await loadSession('again')
      expect(session?.formValues).toEqual({ Name: 'Ada L' })
      expect(session?.elements).toHaveLength(1)
    })

    it('never saves over stored work that the new copy could not load', async () => {
      await openAgainDoc()
      const read = vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementationOnce(() => {
        throw new DOMException('Data lost due to missing file.', 'NotReadableError')
      })
      await expect(loadSession('again')).rejects.toThrow() // the store then opens it without the work
      read.mockRestore()
      open(makeDoc('again'))
      useEditor.getState().addElement(mark())
      await waitForSave()
      expect(status()).toMatchObject({ state: 'error', error: 'Your saved work on this document didn’t load.' })
      expect((await loadSession('again'))?.formValues).toEqual({ Name: 'Ada L' })
    })

    it.each([
      [
        'the page is hidden',
        () => {
          visibility = 'hidden'
          document.dispatchEvent(new Event('visibilitychange'))
        },
      ],
      ['the page is unloaded', () => window.dispatchEvent(new Event('pagehide'))],
    ])('never saves over stored work that the new copy could not load, not even when %s', async (_, leave) => {
      await openAgainDoc()
      const read = vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementationOnce(() => {
        throw new DOMException('Data lost due to missing file.', 'NotReadableError')
      })
      await expect(loadSession('again')).rejects.toThrow()
      read.mockRestore()
      open(makeDoc('again'))
      useEditor.getState().addElement(mark())
      // Well inside the autosave delay: the write made on the way out must still check.
      leave()
      await settle()
      expect(status()).toMatchObject({ state: 'error', error: 'Your saved work on this document didn’t load.' })
      const session = await loadSession('again')
      expect(session?.formValues).toEqual({ Name: 'Ada L' })
      expect(session?.elements).toEqual([])
    })

    it('takes newer work from another tab as the base, and says the replaced copy’s late changes are lost', async () => {
      await openAgainDoc()
      const mine = (await loadSession('again'))?.updatedAt ?? 0
      const theirs = { docId: 'again', fileName: 'again.pdf', elements: [], formValues: { Name: 'Grace' }, assets: {} }
      await saveSession(buildSession(theirs, mine + 1000)) // another tab, not heard from
      await loadSession('again') // the new copy's load finds it
      useEditor.getState().setFormValue('Name', 'Ada Lovelace')
      open(makeDoc('again'), { Name: 'Grace' })
      await settle()
      expect(toast.error).toHaveBeenCalledWith('Your latest changes to “⁨again.pdf⁩” couldn’t be saved', {
        description: 'It was changed in another tab.',
      })
      useEditor.getState().addElement(mark())
      await waitForSave()
      expect(status().state).toBe('saved')
      const session = await loadSession('again')
      expect(session?.formValues).toEqual({ Name: 'Grace' })
      expect(session?.elements).toHaveLength(1)
    })
  })

  describe('when its saved work could not be read as it opened', () => {
    const NOT_LOADED = 'Your saved work on this document didn’t load'

    /** Opens 'lost' the way the store does when reading its saved work fails: without it. */
    async function openWithoutWork() {
      const read = vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementationOnce(() => {
        throw new DOMException('Data lost due to missing file.', 'NotReadableError')
      })
      await expect(loadSession('lost')).rejects.toThrow()
      read.mockRestore()
      const doc: LoadedDocument = { ...makeDoc('lost'), sessionLoadFailed: true }
      await rememberDocument({ id: 'lost', name: doc.name, size: 4, pageCount: 1 }, doc.bytes)
      open(doc)
      stop = startAutosave()
      return doc
    }

    const lastToast = () => vi.mocked(toast.error).mock.calls.at(-1) as unknown as [string, { id?: string; description?: string; action?: { onClick(): void } }]

    it('says so before any work goes in, and keeps to that one message', async () => {
      await saveSession(buildSession({ docId: 'lost', fileName: 'lost.pdf', elements: [], formValues: { Name: 'Ada' }, assets: {} }, 100))
      const doc = await openWithoutWork()
      expect(toast.error).toHaveBeenCalledTimes(1)
      // It stays until acted on, in its own stack under the top bar (at the bottom it would cover the dock's popovers).
      expect(lastToast()).toMatchObject([
        NOT_LOADED,
        { id: 'autosave-outdated', description: 'Reload it to try again before you make changes.', duration: Infinity, toasterId: 'staying' },
      ])
      expect(status().state).toBe('idle')

      // The first change finds that work and isn't saved over it; the same toast says so.
      useEditor.getState().setFormValue('Name', 'Grace')
      await waitForSave()
      expect((await loadSession('lost'))?.formValues).toEqual({ Name: 'Ada' })
      expect(status()).toMatchObject({ state: 'error', error: `${NOT_LOADED}.` })
      expect(toast.error).toHaveBeenCalledTimes(2)
      expect(lastToast()).toMatchObject([
        NOT_LOADED,
        { id: 'autosave-outdated', description: expect.stringMatching(/aren’t being saved/), duration: Infinity, toasterId: 'staying' },
      ])

      // "Reload" opens the document again, which reads its saved work again.
      const openDocument = vi.fn(async () => true)
      const real = useEditor.getState().openDocument
      useEditor.setState({ openDocument })
      lastToast()[1].action?.onClick()
      useEditor.setState({ openDocument: real })
      expect(openDocument).toHaveBeenCalledWith({ name: doc.name, bytes: doc.bytes })
    })

    it('says why a change still waiting in it is lost when the document is opened again', async () => {
      await saveSession(buildSession({ docId: 'lost', fileName: 'lost.pdf', elements: [], formValues: { Name: 'Ada' }, assets: {} }, 100))
      await openWithoutWork()
      useEditor.getState().setFormValue('Name', 'Grace')
      // "Reload" before the change is written: a copy that reads the work replaces this one.
      await loadSession('lost')
      open(makeDoc('lost'), { Name: 'Ada' })
      await settle()
      expect(toast.error).toHaveBeenLastCalledWith('Your latest changes to “⁨lost.pdf⁩” couldn’t be saved', {
        description: 'Its saved work didn’t load.',
      })
      expect((await loadSession('lost'))?.formValues).toEqual({ Name: 'Ada' })
    })

    it('takes the message back once its work is saved, when no work can be read there', async () => {
      await openWithoutWork()
      expect(lastToast()[0]).toBe(NOT_LOADED)
      vi.mocked(toast.dismiss).mockClear()
      useEditor.getState().setFormValue('Name', 'Grace')
      await waitForSave()
      expect(status().state).toBe('saved')
      expect(toast.dismiss).toHaveBeenCalledWith('autosave-outdated')
      expect((await loadSession('lost'))?.formValues).toEqual({ Name: 'Grace' })
    })
  })

  it('flushes pending work when the document is closed', async () => {
    await openRemembered('closing')
    stop = startAutosave()
    useEditor.getState().addElement(mark())
    useEditor.getState().closeDocument()
    await settle()
    expect((await loadSession('closing'))?.elements).toHaveLength(1)
  })

  it('flushes immediately when the page is hidden', async () => {
    await openRemembered('hidden')
    stop = startAutosave()
    useEditor.getState().addElement(mark())
    visibility = 'hidden'
    document.dispatchEvent(new Event('visibilitychange'))
    await settle()
    expect(saveMock).toHaveBeenCalledTimes(1)
    expect(status().state).toBe('saved')
  })

  it('flushes on pagehide and on stop', async () => {
    await openRemembered('pagehide')
    stop = startAutosave()
    useEditor.getState().addElement(mark())
    window.dispatchEvent(new Event('pagehide'))
    // The write is issued at once, without a read first, so it can commit before an unload.
    expect(saveMock).toHaveBeenCalledTimes(1)
    expect(saveMock.mock.calls[0][2]).toEqual({ blind: true })
    await settle()
    useEditor.getState().addElement(mark())
    stop()
    stop = null
    await settle()
    expect(saveMock).toHaveBeenCalledTimes(2)
    expect(saveMock.mock.calls[1][2]).toEqual({ blind: false })
    expect((await loadSession('pagehide'))?.elements).toHaveLength(2)
  })

  describe('with the same document open in another tab', () => {
    const stored = (formValues: Record<string, string>, updatedAt: number) =>
      buildSession({ docId: 'shared', fileName: 'shared.pdf', elements: [], formValues, assets: {} }, updatedAt)

    /** Opens 'shared' the way the store does: its saved session is loaded first. */
    async function openShared() {
      await saveSession(stored({ Name: 'Ada' }, 100))
      await loadSession('shared')
      const doc = await openRemembered('shared')
      stop = startAutosave()
      saveMock.mockClear()
      return doc
    }

    const lastToast = () => vi.mocked(toast.error).mock.calls.at(-1) as unknown as [string, { action?: { onClick(): void } }]

    it('never overwrites newer work saved there, and offers to reload', async () => {
      const doc = await openShared()
      await saveSession(stored({ Name: 'Grace' }, 200)) // the other tab
      useEditor.getState().setFormValue('Name', 'Stale edit')
      await waitForSave()
      expect((await loadSession('shared'))?.formValues).toEqual({ Name: 'Grace' })
      expect(status()).toMatchObject({ state: 'error', error: 'This document was changed in another tab.' })
      expect(lastToast()).toMatchObject(['This document was changed in another tab', { duration: Infinity, toasterId: 'staying' }])

      // Nothing else is written from this tab.
      useEditor.getState().addElement(mark())
      window.dispatchEvent(new Event('pagehide'))
      await waitForSave()
      expect(saveMock).toHaveBeenCalledTimes(2)
      expect((await loadSession('shared'))?.formValues).toEqual({ Name: 'Grace' })

      // "Reload" opens the document again, which loads the newer work.
      const openDocument = vi.fn(async () => true)
      const real = useEditor.getState().openDocument
      useEditor.setState({ openDocument })
      lastToast()[1].action?.onClick()
      useEditor.setState({ openDocument: real })
      expect(openDocument).toHaveBeenCalledWith({ name: doc.name, bytes: doc.bytes })
    })

    it('keeps saving its own consecutive changes', async () => {
      await openShared()
      useEditor.getState().setFormValue('Name', 'One')
      await waitForSave()
      useEditor.getState().setFormValue('Name', 'Two')
      await waitForSave()
      expect(status().state).toBe('saved')
      expect((await loadSession('shared'))?.formValues).toEqual({ Name: 'Two' })
    })

    it('stops saving as soon as the other tab announces a save', async () => {
      await openShared()
      const otherTab = new BroadcastChannel(SESSIONS_CHANNEL)
      otherTab.postMessage({ docId: 'shared', updatedAt: 300 })
      await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith('This document was changed in another tab', expect.anything()))
      otherTab.close()
      // Nothing was unsaved here yet; the next change can't be saved and says so.
      expect(status().state).toBe('idle')
      useEditor.getState().addElement(mark())
      expect(status()).toMatchObject({ state: 'error', error: 'This document was changed in another tab.' })
      await waitForSave()
      expect(saveMock).not.toHaveBeenCalled()
    })

    it('announces its own saves', async () => {
      await openShared()
      const otherTab = new BroadcastChannel(SESSIONS_CHANNEL)
      const heard: unknown[] = []
      otherTab.onmessage = (e) => heard.push(e.data)
      useEditor.getState().setFormValue('Name', 'Told')
      await waitForSave()
      const { updatedAt } = (await loadSession('shared')) ?? {}
      await vi.waitFor(() => expect(heard).toEqual([{ docId: 'shared', updatedAt }]))
      otherTab.close()
    })
  })

  it('reports errors once, keeps reporting them until a save succeeds, then recovers', async () => {
    await openRemembered('quota')
    stop = startAutosave()
    saveMock.mockRejectedValueOnce(quota).mockRejectedValueOnce(quota)
    useEditor.getState().addElement(mark())
    await waitForSave()
    expect(status()).toMatchObject({ state: 'error', error: 'Storage on this device is full.' })
    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(toast.error).toHaveBeenCalledWith("Couldn't save your progress on this device", expect.anything())

    // More changes don't hide the failure: the status (which guards leaving) stays 'error'
    // until a write actually succeeds.
    useEditor.getState().addElement(mark())
    expect(status().state).toBe('error')
    await vi.advanceTimersByTimeAsync(200)
    expect(status().state).toBe('error')
    await waitForSave()
    expect(status().state).toBe('error')
    expect(toast.error).toHaveBeenCalledTimes(1)

    useEditor.getState().addElement(mark())
    await waitForSave()
    expect(status().state).toBe('saved')
    expect(toast.dismiss).toHaveBeenCalled()
    expect((await loadSession('quota'))?.elements).toHaveLength(3)
  })

  it('flushAutosave resolves once the pending write has settled, so the status is final', async () => {
    await openRemembered('settled')
    stop = startAutosave()
    saveMock.mockRejectedValueOnce(quota)
    useEditor.getState().addElement(mark())
    await flushAutosave()
    expect(status().state).toBe('error')
    useEditor.getState().addElement(mark())
    await flushAutosave()
    expect(status().state).toBe('saved')
  })

  it('says so when the last write of a closed document fails, unless the user already knew', async () => {
    await openRemembered('closed')
    stop = startAutosave()
    saveMock.mockRejectedValueOnce(quota)
    useEditor.getState().addElement(mark())
    useEditor.getState().closeDocument()
    await settle()
    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(toast.error).toHaveBeenCalledWith('Your latest changes to “⁨closed.pdf⁩” couldn’t be saved', {
      description: 'Storage on this device is full.',
    })

    // Saving was already failing (and the user chose to leave anyway): no second message.
    vi.mocked(toast.error).mockClear()
    await openRemembered('known')
    saveMock.mockRejectedValueOnce(quota).mockRejectedValueOnce(quota)
    useEditor.getState().addElement(mark())
    await waitForSave()
    expect(status().state).toBe('error')
    useEditor.getState().closeDocument()
    await settle()
    expect(saveMock).toHaveBeenCalledTimes(3)
    expect(toast.error).toHaveBeenCalledTimes(1)
  })

  it('writes a long burst of changes without waiting for a pause', async () => {
    await openRemembered('burst')
    stop = startAutosave()
    for (let i = 1; i <= 10; i++) {
      useEditor.getState().setFormValue('Name', 'Ada Lovelace'.slice(0, i))
      await vi.advanceTimersByTimeAsync(400)
    }
    expect(saveMock).toHaveBeenCalledTimes(1)
  })

  it('never stores a text block that is still empty, nor counts it as filled', async () => {
    await openRemembered('blank')
    stop = startAutosave()
    useEditor.getState().addElement(text(''))
    useEditor.getState().addElement(mark())
    useEditor.getState().addElement(text('Hello'))
    await waitForSave()
    expect((await loadSession('blank'))?.elements.map((e) => e.kind)).toEqual(['mark', 'text'])
    expect((await getRecentDocument('blank'))?.filledCount).toBe(2)
  })

  it('renders a thumbnail for documents that do not have one yet', async () => {
    await openRemembered('thumb')
    stop = startAutosave()
    await settle()
    expect(renderThumbnail).toHaveBeenCalledTimes(1)
    expect((await getRecentDocument('thumb'))?.thumbnail).toBe('data:image/jpeg;base64,THUMB')

    // Opening it again does not re-render.
    open(null)
    await openRemembered('thumb')
    await settle()
    expect(renderThumbnail).toHaveBeenCalledTimes(1)
  })

  it('never stores a preview of a password-protected document', async () => {
    stop = startAutosave()
    useEditor.setState({ load: { status: 'password', fileName: 'secret.pdf', incorrect: false } })
    useEditor.setState({ load: { status: 'password', fileName: 'secret.pdf', incorrect: true } })
    await openRemembered('secret')
    await settle()
    expect(renderThumbnail).not.toHaveBeenCalled()
    expect((await getRecentDocument('secret'))?.thumbnail).toBeUndefined()

    // A cancelled prompt doesn't taint the next document.
    useEditor.setState({ load: { status: 'password', fileName: 'other.pdf', incorrect: false } })
    useEditor.setState({ load: { status: 'idle' } })
    await openRemembered('plain')
    await settle()
    expect(renderThumbnail).toHaveBeenCalledTimes(1)
  })

  it('waits for the recents entry of a first open before storing the thumbnail', async () => {
    const doc = makeDoc('late')
    open(doc)
    stop = startAutosave()
    await settle()
    expect(await getRecentDocument('late')).toBeNull()
    await rememberDocument({ id: 'late', name: doc.name, size: 4, pageCount: 1 }, doc.bytes)
    await vi.advanceTimersByTimeAsync(300)
    await settle()
    expect((await getRecentDocument('late'))?.thumbnail).toBe('data:image/jpeg;base64,THUMB')
  })
})
