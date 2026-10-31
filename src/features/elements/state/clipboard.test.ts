import '../testing/env'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Asset, ImageElement, PageInfo } from '../../../model/types'

vi.mock('../../../lib/pdf/pdfjs', () => ({
  looksLikePdf: () => true,
  openPdf: vi.fn(),
  readPageInfos: vi.fn(),
  PasswordRequiredError: class extends Error {},
}))
vi.mock('../../../lib/storage/db', () => ({ loadDocumentBytes: vi.fn(), loadSession: vi.fn(), rememberDocument: vi.fn() }))
vi.mock('../../../model/fonts', async (original) => ({ ...(await original<object>()), loadFont: vi.fn(() => Promise.resolve()) }))
vi.mock('sonner', () => ({ toast: vi.fn() }))
// Decoding needs a browser (decode.test.ts covers it with fakes): here it hands back a prepared picture.
vi.mock('../../signature/decode', () => ({ importImageAsset: vi.fn() }))

const { useEditor } = await import('../../../store/editor')
const { importImageAsset } = await import('../../signature/decode')
const { pasteImageBlob } = await import('./clipboard')

const s = () => useEditor.getState()
const page: PageInfo = { index: 0, width: 600, height: 800, rotation: 0, view: [0, 0, 600, 800], userUnit: 1 }

function openDoc(id: string) {
  const pdf = { loadingTask: { destroy: () => Promise.resolve() } } as never
  useEditor.setState({ doc: { id, name: `${id}.pdf`, bytes: new Uint8Array(), pdf, pages: [page], formFields: [] } })
}

/** The picture the next import hands back. */
function preparedAs(width: number, height: number): Omit<Asset, 'id'> {
  const asset = { mime: 'image/png' as const, dataUrl: `data:image/png;base64,${width}x${height}`, width, height }
  vi.mocked(importImageAsset).mockResolvedValueOnce(asset)
  return asset
}

beforeEach(() => {
  vi.mocked(importImageAsset).mockReset()
  s().closeDocument()
  openDoc('d')
})

describe('pasteImageBlob', () => {
  it('prepares the picture as the image tool does and places it in the middle of the page', async () => {
    const svg = new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"/>'], { type: 'image/svg+xml' })
    const asset = preparedAs(2000, 1000)
    expect(await pasteImageBlob(svg)).toBe(true)
    expect(importImageAsset).toHaveBeenCalledWith(svg)
    const el = s().elements[0] as ImageElement
    expect(s().assets[el.assetId]).toMatchObject(asset)
    expect(el).toMatchObject({ kind: 'image', role: 'image', page: 0, x: 210, y: 355, width: 180, height: 90 })
  })

  it('keeps a tall picture within 80% of the page height', async () => {
    preparedAs(100, 2000)
    expect(await pasteImageBlob(new Blob([], { type: 'image/png' }))).toBe(true)
    expect(s().elements[0]).toMatchObject({ width: expect.closeTo(32), height: expect.closeTo(640), y: expect.closeTo(80) })
  })

  it('drops the picture when another document was opened while it was being prepared', async () => {
    let finish!: (asset: Omit<Asset, 'id'>) => void
    vi.mocked(importImageAsset).mockReturnValueOnce(new Promise((resolve) => (finish = resolve)))
    const pasted = pasteImageBlob(new Blob([], { type: 'image/png' }))
    openDoc('other')
    finish({ mime: 'image/png', dataUrl: 'data:image/png;base64,', width: 10, height: 10 })
    expect(await pasted).toBe(false)
    expect(s().elements).toEqual([])
    expect(s().assets).toEqual({})
  })
})
