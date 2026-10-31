import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LoadedDocument } from '../../store/editor'

vi.mock('../../lib/pdf/pdfjs', () => ({
  looksLikePdf: () => true,
  openPdf: vi.fn(),
  readPageInfos: vi.fn(),
  PasswordRequiredError: class extends Error {},
}))
vi.mock('../../lib/storage/db', () => ({ loadDocumentBytes: vi.fn(), loadSession: vi.fn(), rememberDocument: vi.fn() }))
vi.mock('../../model/fonts', async (original) => ({ ...(await original<object>()), loadFont: vi.fn(() => Promise.resolve()) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('../editor/leaveGuard', () => ({ confirmLeaveDocument: vi.fn(async () => true) }))

const { toast } = await import('sonner')
const { useEditor } = await import('../../store/editor')
const { setSaveStatus } = await import('../../lib/storage/saveStatus')
const { confirmLeaveDocument } = await import('../editor/leaveGuard')
const { openPdfFile, openSampleForm } = await import('./openFile')

const makeDoc = (id: string, name: string): LoadedDocument => ({
  id,
  name,
  bytes: new Uint8Array(),
  pdf: { loadingTask: { destroy: async () => {} } } as never,
  pages: [],
  formFields: [],
})

const realOpenDocument = useEditor.getState().openDocument
const openDocument = vi.fn(async (input: File | { name: string; bytes: Uint8Array }) => {
  useEditor.setState({ doc: makeDoc(`id:${input.name}`, input.name), load: { status: 'idle' } })
  return true
})

beforeEach(() => {
  vi.mocked(toast.success).mockClear()
  vi.mocked(toast.error).mockClear()
  openDocument.mockClear()
  useEditor.setState({ doc: null, load: { status: 'idle' }, openDocument })
  setSaveStatus({ state: 'idle', savedAt: null })
})

afterEach(() => {
  useEditor.setState({ openDocument: realOpenDocument })
  vi.unstubAllGlobals()
})

const pdf = (name: string) => new File([new Uint8Array([37, 80, 68, 70])], name, { type: 'application/pdf' })

describe('openPdfFile', () => {
  it('reassures that the previous document’s work is saved (its name isolated for RTL)', async () => {
    useEditor.setState({ doc: makeDoc('prev', '2024 טופס בקשה.pdf') })
    vi.mocked(confirmLeaveDocument).mockImplementationOnce(async () => {
      setSaveStatus({ state: 'saved', savedAt: 1 })
      return true
    })
    expect(await openPdfFile(pdf('next.pdf'))).toBe(true)
    expect(toast.success).toHaveBeenCalledWith('Your work on “⁨2024 טופס בקשה⁩” is saved', expect.anything())
  })

  it('never claims the work is saved when the user left without it', async () => {
    useEditor.setState({ doc: makeDoc('prev', 'prev.pdf') })
    vi.mocked(confirmLeaveDocument).mockImplementationOnce(async () => {
      // The guard's write failed and the user chose "Leave anyway".
      setSaveStatus({ state: 'error', savedAt: null, error: 'Storage on this device is full.' })
      return true
    })
    expect(await openPdfFile(pdf('next.pdf'))).toBe(true)
    expect(openDocument).toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('names a file that isn’t a PDF with bidi isolation', async () => {
    expect(await openPdfFile(new File(['x'], 'תמונה 1.png', { type: 'image/png' }))).toBe(false)
    expect(toast.error).toHaveBeenCalledWith('“⁨תמונה 1.png⁩” isn’t a PDF', expect.anything())
  })
})

describe('openSampleForm', () => {
  /** A sample download that completes when the test says so. */
  function slowFetch() {
    let finish!: () => void
    const done = new Promise<void>((resolve) => (finish = resolve))
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        await done
        return new Response(new Uint8Array([37, 80, 68, 70]))
      }),
    )
    return finish
  }

  it('opens the sample once it has downloaded', async () => {
    const finish = slowFetch()
    const opening = openSampleForm()
    finish()
    expect(await opening).toBe(true)
    expect(openDocument).toHaveBeenCalledWith({ name: 'Sample application form.pdf', bytes: expect.any(Uint8Array) })
  })

  it('never replaces a document the user opened while the sample was downloading', async () => {
    const finish = slowFetch()
    const opening = openSampleForm()
    useEditor.setState({ doc: makeDoc('mine', 'form-basic.pdf') })
    finish()
    expect(await opening).toBe(false)
    expect(openDocument).not.toHaveBeenCalled()
    expect(useEditor.getState().doc?.name).toBe('form-basic.pdf')
  })

  it('gives way to another open that is still in progress', async () => {
    const finish = slowFetch()
    const opening = openSampleForm()
    useEditor.setState({ load: { status: 'loading', fileName: 'form-basic.pdf' } })
    finish()
    expect(await opening).toBe(false)
    expect(openDocument).not.toHaveBeenCalled()
  })
})
