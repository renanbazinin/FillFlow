import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/pdf/pdfjs', () => ({
  looksLikePdf: () => true,
  openPdf: vi.fn(),
  readPageInfos: vi.fn(),
  PasswordRequiredError: class extends Error {},
}))
vi.mock('../../lib/storage/db', () => ({ loadDocumentBytes: vi.fn(), loadSession: vi.fn(), rememberDocument: vi.fn() }))
vi.mock('../../model/fonts', async (original) => ({ ...(await original<object>()), loadFont: vi.fn(() => Promise.resolve()) }))
vi.mock('../../components/ui/confirm', () => ({ confirm: vi.fn(async () => false) }))
vi.mock('../../lib/storage/autosave', () => ({ flushAutosave: vi.fn(async () => {}) }))

const { useEditor } = await import('../../store/editor')
const { setLocale } = await import('../../i18n')
const { confirm } = await import('../../components/ui/confirm')
const { flushAutosave } = await import('../../lib/storage/autosave')
const { setSaveStatus } = await import('../../lib/storage/saveStatus')
const { confirmLeaveDocument } = await import('./leaveGuard')

const doc = { id: 'd', name: 'd.pdf', bytes: new Uint8Array(), pdf: {} as never, pages: [], formFields: [] }

beforeEach(() => {
  vi.mocked(confirm).mockClear()
  vi.mocked(flushAutosave).mockReset().mockResolvedValue()
  useEditor.setState({ doc })
  setSaveStatus({ state: 'idle', savedAt: null })
})

describe('confirmLeaveDocument', () => {
  it('lets you go without asking when nothing is open', async () => {
    useEditor.setState({ doc: null })
    expect(await confirmLeaveDocument()).toBe(true)
    expect(flushAutosave).not.toHaveBeenCalled()
  })

  it('writes pending changes first and lets you go once they are stored', async () => {
    setSaveStatus({ state: 'saving', savedAt: null })
    vi.mocked(flushAutosave).mockImplementation(async () => setSaveStatus({ state: 'saved', savedAt: 1 }))
    expect(await confirmLeaveDocument()).toBe(true)
    expect(confirm).not.toHaveBeenCalled()
  })

  it('asks when the pending changes could not be stored (the status said "saving" until then)', async () => {
    setSaveStatus({ state: 'saving', savedAt: null })
    vi.mocked(flushAutosave).mockImplementation(async () => setSaveStatus({ state: 'error', savedAt: null, error: 'Full.' }))
    expect(await confirmLeaveDocument()).toBe(false)
    expect(confirm).toHaveBeenCalledWith({
      title: 'Leave without your latest changes?',
      description: 'They couldn’t be saved on this device. Download your PDF first if you want to keep them.',
      confirmLabel: 'Leave anyway',
      cancelLabel: 'Stay',
      danger: true,
    })
  })

  it('asks in the interface language', async () => {
    setSaveStatus({ state: 'error', savedAt: null, error: 'Full.' })
    setLocale('he')
    try {
      await confirmLeaveDocument()
    } finally {
      setLocale('en')
    }
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'לצאת בלי השינויים האחרונים שלכם?', confirmLabel: 'יציאה בכל זאת' }))
  })
})
