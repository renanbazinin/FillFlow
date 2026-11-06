import '../testing/env'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PageInfo, ToolId } from '../../../model/types'

vi.mock('../../../lib/pdf/pdfjs', () => ({
  looksLikePdf: () => true,
  openPdf: vi.fn(),
  readPageInfos: vi.fn(),
  PasswordRequiredError: class extends Error {},
}))
vi.mock('../../../lib/storage/db', () => ({ loadDocumentBytes: vi.fn(), loadSession: vi.fn(), rememberDocument: vi.fn() }))
vi.mock('../../../model/fonts', async (original) => ({ ...(await original<object>()), loadFont: vi.fn(() => Promise.resolve()) }))
vi.mock('sonner', () => ({ toast: vi.fn() }))

const { useEditor } = await import('../../../store/editor')
const { createTextElement, DEFAULT_STYLES } = await import('../../../model/elements')
const { registerViewer } = await import('../../viewer/viewerApi')
const { finishActiveTextEdit } = await import('../state/textEdit')
const { dateElement, placeAtVisibleCenter, placeDate } = await import('./place')

const s = () => useEditor.getState()
const pageInfo = (index: number): PageInfo => ({ index, width: 600, height: 800, rotation: 0, view: [0, 0, 600, 800], userUnit: 1 })
const center = (i: number) => {
  const el = s().elements[i]
  return { page: el.page, x: el.x + el.width / 2, y: el.y + el.height / 2 }
}
/** Enter with `tool` on, as the keyboard shortcut does it. */
const press = (tool: ToolId) => {
  s().setTool(tool)
  return placeAtVisibleCenter(tool)
}

beforeEach(() => {
  s().closeDocument()
  useEditor.setState({
    styles: structuredClone(DEFAULT_STYLES),
    doc: { id: 'd', name: 'd.pdf', bytes: new Uint8Array(), pdf: { loadingTask: { destroy: () => Promise.resolve() } } as never, pages: [pageInfo(0), pageInfo(1)], formFields: [] },
  })
  registerViewer({ getVisibleCenter: () => ({ page: 1, x: 300, y: 400 }) } as never)
})

afterEach(() => {
  finishActiveTextEdit()
  registerViewer(null)
})

describe('dateElement (the Date tool and its preview)', () => {
  const page = { index: 0, width: 600, height: 800 }
  const aligned = (align: 'left' | 'center' | 'right') => ({ ...s().styles, text: { ...s().styles.text, align } })
  /** Middle of the first line (12pt text: 14.4pt lines). */
  const lineMiddle = (el: { y: number }) => el.y + 7.2

  it('puts the side it grows from, by the alignment remembered for new text, at the click, as typed text does', () => {
    const at = { x: 300, y: 400 }
    const left = dateElement(page, at, aligned('left'))
    expect(left).toMatchObject({ kind: 'text', align: 'left', x: 300 })
    const right = dateElement(page, at, aligned('right'))
    expect(right).toMatchObject({ align: 'right' })
    expect(right.x + right.width).toBeCloseTo(300)
    const center = dateElement(page, at, aligned('center'))
    expect(center.x + center.width / 2).toBeCloseTo(300)
    for (const el of [left, right, center]) expect(lineMiddle(el)).toBeCloseTo(400)
  })

  it('stays on the page', () => {
    expect(dateElement(page, { x: 20, y: 400 }, aligned('right')).x).toBe(0)
    const left = dateElement(page, { x: 590, y: 400 }, aligned('left'))
    expect(left.x + left.width).toBeCloseTo(600)
  })

  it('places what its preview shows', () => {
    useEditor.setState({ styles: aligned('right') })
    const at = { x: 300, y: 400 }
    const preview = dateElement(page, at, s().styles)
    placeDate(page, at)
    expect(s().elements[0]).toEqual({ ...preview, id: s().elements[0].id })
  })
})

describe('placeAtVisibleCenter (Enter with a creation tool)', () => {
  it('adds what a click would, in the middle of the view, selected; again a step down and right', () => {
    expect(press('check')).toBe(true)
    expect(press('check')).toBe(true)
    expect(s().elements.map((e) => e.kind)).toEqual(['mark', 'mark'])
    expect(center(0)).toEqual({ page: 1, x: 300, y: 400 })
    expect(center(1)).toEqual({ page: 1, x: 312, y: 412 })
    expect(s().selection).toEqual([s().elements[1].id])
    // A sticky tool stays on; the others go back to Select, like after a click.
    expect(s().tool).toBe('check')
    expect(press('rect')).toBe(true)
    expect(s().elements[2]).toMatchObject({ kind: 'shape', shape: 'rect', width: 120, height: 60 })
    expect(s().tool).toBe('select')
  })

  it('starts typing a new text there, also over one already there', () => {
    registerViewer({ getVisibleCenter: () => ({ page: 0, x: 100, y: 200 }) } as never)
    s().addElement({ ...createTextElement(0, { x: 90, y: 190 }, s().styles.text, 'Old'), id: 'old' })
    expect(press('text')).toBe(true)
    expect(s().editingId).not.toBeNull()
    expect(s().editingId).not.toBe('old')
  })

  it('adds nothing with the pen, or with no signature or picture picked yet', () => {
    for (const tool of ['ink', 'signature', 'initials', 'image', 'select'] as const) expect(press(tool)).toBe(false)
    expect(s().elements).toEqual([])
  })

  it('goes to the middle of the current page when the view has no center', () => {
    registerViewer(null)
    s().setCurrentPage(0)
    expect(press('dot')).toBe(true)
    expect(center(0)).toEqual({ page: 0, x: 300, y: 400 })
  })
})
