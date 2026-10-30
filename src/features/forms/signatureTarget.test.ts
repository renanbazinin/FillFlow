import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The store's document-loading dependencies need a browser; the flow under test doesn't.
vi.mock('../../lib/pdf/pdfjs', () => ({
  looksLikePdf: () => true,
  openPdf: vi.fn(),
  readPageInfos: vi.fn(),
  PasswordRequiredError: class extends Error {},
}))
vi.mock('../../lib/storage/db', () => ({
  loadDocumentBytes: vi.fn(),
  loadSession: vi.fn(),
  rememberDocument: vi.fn(),
}))
vi.mock('../../model/fonts', async (orig) => ({ ...(await orig<object>()), loadFont: vi.fn(() => Promise.resolve()) }))
vi.mock('../viewer/viewerApi', () => ({ viewer: { scrollToRect: vi.fn() } }))

const { useEditor } = await import('../../store/editor')
const { hasPendingSignature, requestSignatureFor } = await import('./signatureTarget')

const s = () => useEditor.getState()
const RECT = { x: 50, y: 600, width: 240, height: 50 }

/** What the signature dialog does on "Use signature": close, add the image, arm placement. */
function useSignature(width = 300, height = 100) {
  s().closeDialog()
  const id = s().addAsset({ mime: 'image/png', dataUrl: 'data:image/png;base64,AA==', width, height })
  s().startPlacingAsset('signature', id)
  return id
}

beforeEach(() => {
  vi.useFakeTimers()
  s().closeDocument()
})
afterEach(() => vi.useRealTimers())

describe('"Sign here" on a signature field', () => {
  it('places the signature fitted inside the field and returns to Select', () => {
    requestSignatureFor(0, RECT)
    expect(s().activeDialog).toBe('signature')
    const assetId = useSignature()
    const [el] = s().elements
    expect(el).toMatchObject({ kind: 'image', role: 'signature', page: 0, assetId })
    // aspect 3: height-limited → 150 × 50, centered in the field
    expect(el.width).toBeCloseTo(150)
    expect(el.height).toBeCloseTo(50)
    expect(el.x + el.width / 2).toBeCloseTo(RECT.x + RECT.width / 2)
    expect(el.y + el.height / 2).toBeCloseTo(RECT.y + RECT.height / 2)
    expect(s().tool).toBe('select')
    expect(s().placingAssetId).toBeNull()
    expect(s().selection).toEqual([el.id])
    expect(hasPendingSignature()).toBe(false)
  })

  it('replaces the signature already in the field, as one undo step', () => {
    requestSignatureFor(0, RECT)
    useSignature()
    const first = s().elements[0].id
    requestSignatureFor(0, RECT)
    useSignature(200, 100)
    expect(s().elements).toHaveLength(1)
    expect(s().elements[0].id).not.toBe(first)
    s().undo()
    expect(s().elements.map((e) => e.id)).toEqual([first])
  })

  it('forgets the field when the dialog is dismissed', () => {
    requestSignatureFor(0, RECT)
    s().closeDialog()
    vi.advanceTimersByTime(1000)
    expect(hasPendingSignature()).toBe(false)
    // A later, unrelated placement is left to the page (no element is added here).
    s().startPlacingAsset('signature', s().addAsset({ mime: 'image/png', dataUrl: 'data:,', width: 10, height: 10 }))
    expect(s().elements).toHaveLength(0)
  })
})
