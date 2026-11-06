import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FormField } from '../../model/types'

// The store's document-loading dependencies need a browser; moving between fields doesn't.
vi.mock('../../lib/pdf/pdfjs', () => ({
  looksLikePdf: () => true,
  openPdf: vi.fn(),
  readPageInfos: vi.fn(),
  PasswordRequiredError: class extends Error {},
  WorkerUnavailableError: class extends Error {},
}))
vi.mock('../../lib/storage/db', () => ({
  loadDocumentBytes: vi.fn(),
  loadSession: vi.fn(),
  rememberDocument: vi.fn(),
}))
vi.mock('../../model/fonts', async (orig) => ({ ...(await orig<object>()), loadFont: vi.fn(() => Promise.resolve()) }))
vi.mock('../viewer/viewerApi', () => ({ viewer: { scrollToRect: vi.fn() } }))

const { useEditor } = await import('../../store/editor')
const { viewer } = await import('../viewer/viewerApi')
const { focusField, revealField } = await import('./navigation')

/** A field 900pt wide: wider than the view at most zoom levels. */
const RECT = { x: 72, y: 100, width: 900, height: 24 }
const field = (over: Partial<FormField> = {}): FormField => ({
  name: 'name',
  type: 'text',
  widgets: [{ id: 'w1', page: 0, rect: RECT }],
  readOnly: false,
  required: false,
  defaultValue: '',
  ...over,
})

/** An on-page control, laid out with this style (what getComputedStyle reads here). */
const control = (textAlign: string, direction = 'ltr') => ({
  tabIndex: 0,
  style: { textAlign, direction },
  closest: () => null,
  focus: vi.fn(),
})
/** The controls on the pages that `document.querySelectorAll` finds: none while the page isn't mounted. */
let controls: ReturnType<typeof control>[] = []

/** The `inlineEnd` the field's reveal asked the viewer for. */
function inlineEnd(f: FormField): unknown {
  revealField(f)
  return vi.mocked(viewer.scrollToRect).mock.lastCall?.[2]
}

beforeEach(() => {
  controls = []
  vi.stubGlobal('document', { querySelectorAll: () => controls })
  vi.stubGlobal('getComputedStyle', (el: ReturnType<typeof control>) => el.style)
  vi.stubGlobal('HTMLInputElement', class {})
  vi.stubGlobal('HTMLTextAreaElement', class {})
  vi.stubGlobal('requestAnimationFrame', (run: () => void) => setTimeout(run, 0))
  vi.mocked(viewer.scrollToRect).mockReset()
  useEditor.setState({ formValues: {}, activeFieldName: null })
})

afterEach(() => vi.unstubAllGlobals())

describe('revealing a field wider than the view', () => {
  it('lines up the edge its text sits at, as its control shows it', () => {
    for (const [style, end] of [
      [control('start', 'rtl'), true],
      [control('right'), true],
      [control('end'), true],
      [control('start'), false],
      [control('left', 'rtl'), false],
      [control('center', 'rtl'), false],
    ] as const) {
      controls = [style]
      expect(inlineEnd(field()), JSON.stringify(style.style)).toEqual({ behavior: undefined, margin: 96, inlineEnd: end })
    }
  })

  it('while its page is not mounted, as its control would lay it out', () => {
    const hebrew = 'ישראל כהן'
    expect(inlineEnd(field({ textAlign: 'right' }))).toMatchObject({ inlineEnd: true })
    expect(inlineEnd(field({ defaultValue: hebrew }))).toMatchObject({ inlineEnd: true })
    useEditor.setState({ formValues: { name: `12 ${hebrew}` } })
    expect(inlineEnd(field())).toMatchObject({ inlineEnd: true })
    useEditor.setState({ formValues: { name: 'Israel Cohen' } })
    expect(inlineEnd(field({ defaultValue: hebrew }))).toMatchObject({ inlineEnd: false })
    useEditor.setState({ formValues: { name: hebrew } })
    // Centred, one character per box (left to right), or not a text box.
    expect(inlineEnd(field({ textAlign: 'center' }))).toMatchObject({ inlineEnd: false })
    expect(inlineEnd(field({ comb: true, maxLength: 9 }))).toMatchObject({ inlineEnd: false })
    expect(inlineEnd(field({ type: 'dropdown', options: [{ value: hebrew, label: hebrew }] }))).toMatchObject({ inlineEnd: false })
  })
})

describe('focusField', () => {
  it('focuses a control that is there before it scrolls: the scroll sees the tool dock as it will be', async () => {
    const order: string[] = []
    const input = control('start')
    input.focus.mockImplementation(() => order.push('focus'))
    vi.mocked(viewer.scrollToRect).mockImplementation(() => void order.push('scroll'))
    controls = [input]
    await expect(focusField(field())).resolves.toBe(true)
    expect(order).toEqual(['focus', 'scroll'])
    expect(input.focus).toHaveBeenCalledWith({ preventScroll: true })
    expect(useEditor.getState().activeFieldName).toBe('name')
    expect(viewer.scrollToRect).toHaveBeenCalledWith(0, RECT, { behavior: undefined, margin: 96, inlineEnd: false })
  })

  it('scrolls to a page that is not mounted, then focuses the control once it is', async () => {
    const order: string[] = []
    const input = control('start', 'rtl')
    input.focus.mockImplementation(() => order.push('focus'))
    vi.mocked(viewer.scrollToRect).mockImplementation(() => void order.push('scroll'))
    const focused = focusField(field({ textAlign: 'right' }), { behavior: 'auto' })
    expect(order).toEqual(['scroll'])
    expect(viewer.scrollToRect).toHaveBeenCalledWith(0, RECT, { behavior: 'auto', margin: 96, inlineEnd: true })
    controls = [input]
    await expect(focused).resolves.toBe(true)
    expect(order).toEqual(['scroll', 'focus'])
  })
})
