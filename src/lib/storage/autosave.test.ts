import 'fake-indexeddb/auto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import type { FormField, ImageElement, MarkElement } from '../../model/types'
import { useEditor, type LoadedDocument } from '../../store/editor'
import { AUTOSAVE_DELAY_MS, startAutosave } from './autosave'
import { clearAllData, getRecentDocument, loadSession, rememberDocument, saveSession } from './db'
import { useSaveStatusStore } from './saveStatus'
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

/** What the store does when a document finishes opening. */
function open(doc: LoadedDocument | null) {
  useEditor.setState({
    doc,
    load: { status: 'idle' },
    elements: [],
    formValues: doc ? { Name: '' } : {},
    assets: {},
    past: [],
    future: [],
    revision: 0,
    selection: [],
  })
}

let markN = 0
const mark = (): MarkElement => ({ id: `m${++markN}`, kind: 'mark', page: 0, x: 10, y: 10, width: 14, height: 14, shape: 'check', color: '#111827' })

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

async function openRemembered(id: string) {
  const doc = makeDoc(id)
  await rememberDocument({ id, name: doc.name, size: 4, pageCount: 1 }, doc.bytes)
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
    await settle()
    expect(saveMock).toHaveBeenCalledTimes(1)
    useEditor.getState().addElement(mark())
    stop()
    stop = null
    await settle()
    expect(saveMock).toHaveBeenCalledTimes(2)
    expect((await loadSession('pagehide'))?.elements).toHaveLength(2)
  })

  it('reports errors once, then recovers on the next change', async () => {
    await openRemembered('quota')
    stop = startAutosave()
    const quota = new DOMException('The quota has been exceeded.', 'QuotaExceededError')
    saveMock.mockRejectedValueOnce(quota).mockRejectedValueOnce(quota)
    useEditor.getState().addElement(mark())
    await waitForSave()
    expect(status()).toMatchObject({ state: 'error', error: 'Storage on this device is full.' })
    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(toast.error).toHaveBeenCalledWith("Couldn't save your progress on this device", expect.anything())

    useEditor.getState().addElement(mark())
    expect(status().state).toBe('saving')
    await waitForSave()
    expect(status().state).toBe('error')
    expect(toast.error).toHaveBeenCalledTimes(1)

    useEditor.getState().addElement(mark())
    await waitForSave()
    expect(status().state).toBe('saved')
    expect(toast.dismiss).toHaveBeenCalled()
    expect((await loadSession('quota'))?.elements).toHaveLength(3)
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
