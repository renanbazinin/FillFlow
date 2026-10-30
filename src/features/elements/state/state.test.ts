import '../testing/env'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Element, InkElement, MarkElement, PageInfo, ShapeElement, TextElement } from '../../../model/types'

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
const { startNewText, editText, finishTextEdit, finishActiveTextEdit } = await import('./textEdit')
const { deleteSelection, nudgeSelection, selectAllOnPage, toggleLockSelection } = await import('./commands')
const { copySelection, pasteItems, clipboardMarker, systemClipboardIsNewer, pastePlainText } = await import('./clipboard')
const styles = await import('../toolbar/styleActions')
const place = await import('../create/place')

const s = () => useEditor.getState()
const pageInfo = (index: number): PageInfo => ({ index, width: 600, height: 800, rotation: 0, view: [0, 0, 600, 800], userUnit: 1 })

const mark = (id: string, x = 100, y = 100, page = 0): MarkElement => ({ id, kind: 'mark', page, x, y, width: 14, height: 14, shape: 'check', color: '#111827' })
const rect = (id: string): ShapeElement => ({
  id,
  kind: 'shape',
  page: 0,
  x: 50,
  y: 50,
  width: 100,
  height: 40,
  shape: 'rect',
  strokeColor: '#c81e1e',
  fillColor: null,
  strokeWidth: 2,
  opacity: 1,
})

beforeEach(() => {
  s().closeDocument()
  useEditor.setState({
    styles: structuredClone(DEFAULT_STYLES),
    doc: { id: 'd', name: 'd.pdf', bytes: new Uint8Array(), pdf: { loadingTask: { destroy: () => Promise.resolve() } } as never, pages: [pageInfo(0), pageInfo(1)], formFields: [] },
  })
})

describe('text editing sessions', () => {
  it('drops a new text block committed empty without leaving an undo step', () => {
    const before = s().past.length
    const el = createTextElement(0, { x: 10, y: 10 }, s().styles.text)
    startNewText(el)
    expect(s().editingId).toBe(el.id)
    expect(s().elements).toHaveLength(1)
    finishTextEdit(el.id)
    expect(s().elements).toHaveLength(0)
    expect(s().editingId).toBeNull()
    expect(s().selection).toEqual([])
    expect(s().past.length).toBe(before)
  })

  it('records creating + typing a new block as one undo step', () => {
    const before = s().past.length
    const el = createTextElement(0, { x: 10, y: 10 }, s().styles.text)
    startNewText(el)
    for (const t of ['H', 'He', 'Hey']) s().updateElement(el.id, { text: t }, { coalesce: `text:${el.id}` })
    finishActiveTextEdit()
    expect((s().elements[0] as TextElement).text).toBe('Hey')
    expect(s().selection).toEqual([el.id])
    expect(s().past.length).toBe(before + 1)
    s().undo()
    expect(s().elements).toHaveLength(0)
  })

  it('removes an existing block emptied while editing (undoable)', () => {
    const el = { ...createTextElement(0, { x: 10, y: 10 }, s().styles.text, 'abc') }
    s().addElement(el)
    editText(el.id)
    expect(s().editingId).toBe(el.id)
    s().updateElement(el.id, { text: '  ' }, { coalesce: `text:${el.id}` })
    finishTextEdit(el.id)
    expect(s().elements).toHaveLength(0)
    s().undo()
    expect(s().elements).toHaveLength(1)
  })

  it('re-measures text as it is typed', () => {
    const el = createTextElement(0, { x: 10, y: 10 }, { ...s().styles.text, fontSize: 10 })
    startNewText(el)
    s().updateElement(el.id, { text: 'abcd' }, { coalesce: `text:${el.id}` })
    expect(s().elements[0].width).toBeCloseTo(20)
    finishActiveTextEdit()
  })
})

describe('commands', () => {
  it('nudges within the page and coalesces a burst into one step', () => {
    s().addElements([mark('a', 2, 100), mark('b', 300, 100)])
    s().select(['a', 'b'])
    const before = s().past.length
    nudgeSelection(-1, 0)
    nudgeSelection(-10, 0)
    expect(s().elements.map((e) => e.x)).toEqual([0, 298])
    expect(s().past.length).toBe(before + 1)
  })

  it('never deletes or nudges locked items', () => {
    s().addElements([{ ...mark('a'), locked: true } as Element, mark('b', 200)])
    s().select(['a', 'b'])
    deleteSelection()
    expect(s().elements.map((e) => e.id)).toEqual(['a'])
    s().select(['a'])
    nudgeSelection(10, 0)
    expect(s().elements[0].x).toBe(100)
    toggleLockSelection()
    expect(s().elements[0].locked).toBe(false)
  })

  it('selects everything on one page', () => {
    s().addElements([mark('a', 10, 10, 0), mark('b', 10, 10, 1), mark('c', 50, 50, 0)])
    selectAllOnPage(0)
    expect(s().selection).toEqual(['a', 'c'])
  })
})

describe('clipboard', () => {
  it('pastes in place on the same page, then cascades by 12pt', () => {
    s().addElement(mark('a', 100, 100))
    s().select(['a'])
    copySelection()
    pasteItems()
    pasteItems()
    const xs = s().elements.map((e) => [e.x, e.y])
    expect(xs).toEqual([
      [100, 100],
      [100, 100],
      [112, 112],
    ])
    expect(s().selection).toHaveLength(1)
    expect(s().selection[0]).toBe(s().elements[2].id)
  })

  it('pastes centered on another page and unlocks copies', () => {
    s().addElement({ ...mark('a', 100, 100), locked: true } as Element)
    s().select(['a'])
    copySelection()
    s().setCurrentPage(1)
    pasteItems()
    const copy = s().elements[1]
    expect(copy.page).toBe(1)
    expect(copy.x).toBe(300 - 7)
    expect(copy.y).toBe(400 - 7)
    expect(copy.locked).toBe(false)
  })

  it('cut removes the unlocked originals', () => {
    s().addElements([mark('a'), { ...mark('b', 200), locked: true } as Element])
    s().select(['a', 'b'])
    copySelection(true)
    expect(s().elements.map((e) => e.id)).toEqual(['b'])
    pasteItems()
    expect(s().elements).toHaveLength(3)
  })

  it('tells our own clipboard marker apart from newer system content', () => {
    s().addElement(mark('a'))
    s().select(['a'])
    copySelection()
    // Before the marker reached the system clipboard we can't tell: prefer our items.
    expect(systemClipboardIsNewer('something else', false)).toBe(false)
    const marker = clipboardMarker()!
    expect(systemClipboardIsNewer(marker, false)).toBe(false)
    expect(systemClipboardIsNewer('copied elsewhere', false)).toBe(true)
    expect(systemClipboardIsNewer('', true)).toBe(true)
  })

  it('pastes plain text as a text block that fits the page', () => {
    s().setCurrentPage(0)
    expect(pastePlainText('Hello\r\nworld\t!  \n')).toBe(true)
    const t = s().elements[0] as TextElement
    expect(t.text).toBe('Hello\nworld    !')
    expect(t.x + t.width).toBeLessThanOrEqual(600)
    expect(pastePlainText('   ')).toBe(false)
  })
})

describe('style actions', () => {
  it('apply to every selected item of the kind and update the defaults', () => {
    const a = createTextElement(0, { x: 0, y: 0 }, s().styles.text, 'one')
    const b = createTextElement(0, { x: 0, y: 50 }, s().styles.text, 'two')
    s().addElements([a, b, mark('m')])
    s().select([a.id, b.id, 'm'])
    styles.setTextStyle({ fontSize: 20, color: '#1d4ed8' })
    const texts = s().elements.filter((e): e is TextElement => e.kind === 'text')
    expect(texts.map((t) => t.fontSize)).toEqual([20, 20])
    expect(texts[0].width).toBeCloseTo(30)
    expect(s().styles.text.fontSize).toBe(20)
    expect(s().styles.text.color).toBe('#1d4ed8')
    expect((s().elements[2] as MarkElement).color).toBe('#111827')
  })

  it('removes and restores a shape border sensibly', () => {
    s().addElement(rect('r'))
    s().select(['r'])
    styles.setShapeStroke(null)
    expect(s().elements[0]).toMatchObject({ strokeColor: null, strokeWidth: 0 })
    styles.setShapeStroke('#047857')
    expect((s().elements[0] as ShapeElement).strokeWidth).toBeGreaterThan(0)
    expect(s().styles.shape.strokeColor).toBe('#047857')
  })

  it('resizes marks around their center', () => {
    s().addElement(mark('m', 100, 100))
    s().select(['m'])
    styles.setMarkSize(24)
    expect(s().elements[0]).toMatchObject({ x: 95, y: 95, width: 24, height: 24 })
    expect(s().styles.mark.size).toBe(24)
  })

  it('re-pads ink when the pen width changes', () => {
    const ink: InkElement = { id: 'k', kind: 'ink', page: 0, x: 9, y: 9, width: 22, height: 12, strokes: [[1 / 22, 1 / 12, 21 / 22, 11 / 12]], color: '#000', strokeWidth: 2 }
    s().addElement(ink)
    s().select(['k'])
    styles.setInkWidth(6)
    expect(s().elements[0]).toMatchObject({ strokeWidth: 6 })
    expect(s().elements[0].x).toBeCloseTo(7)
  })
})

describe('placement', () => {
  it('keeps sticky tools active and returns others to Select', () => {
    s().setTool('check')
    place.placeMark(pageInfo(0), { x: 50, y: 50 }, 'check')
    expect(s().tool).toBe('check')
    expect(s().elements[0]).toMatchObject({ kind: 'mark', x: 43, y: 43 })
    s().setTool('rect')
    place.placeBox(pageInfo(0), 'rect', null, { x: 300, y: 300 })
    expect(s().tool).toBe('select')
    expect(s().elements[1]).toMatchObject({ kind: 'shape', width: 120, height: 60 })
    expect(s().selection).toEqual([s().elements[1].id])
  })

  it('respects a locked tool', () => {
    s().setTool('rect', { locked: true })
    place.placeBox(pageInfo(0), 'rect', { x: 10, y: 10, width: 20, height: 20 }, { x: 0, y: 0 })
    expect(s().tool).toBe('rect')
  })

  it('starts typing on a text click and edits existing text instead of stacking', () => {
    s().setTool('text')
    place.placeText(pageInfo(0), { x: 100, y: 100 })
    expect(s().tool).toBe('select')
    const id = s().editingId!
    expect(id).toBeTruthy()
    s().updateElement(id, { text: 'hi' }, { coalesce: `text:${id}` })
    finishActiveTextEdit()
    s().setTool('text')
    place.placeText(pageInfo(0), { x: 101, y: 100 })
    expect(s().editingId).toBe(id)
    expect(s().elements).toHaveLength(1)
    finishActiveTextEdit()
  })

  it('places an armed asset at its aspect ratio', () => {
    const assetId = s().addAsset({ mime: 'image/png', dataUrl: 'data:image/png;base64,', width: 300, height: 100 })
    s().startPlacingAsset('signature', assetId)
    expect(place.placeAsset(pageInfo(0), { x: 300, y: 400 }, 'signature')).toBe(true)
    expect(s().elements[0]).toMatchObject({ kind: 'image', width: 150, height: 50, x: 225, y: 375 })
    expect(s().tool).toBe('select')
    expect(place.placeAsset(pageInfo(0), { x: 300, y: 400 }, 'signature')).toBe(false)
  })

  it('joins quick ink strokes on the same page into one drawing', () => {
    place.commitInkStroke(0, [{ x: 10, y: 10 }, { x: 20, y: 20 }], null)
    const first = s().elements[0]
    const join = place.inkJoinTarget(0, performance.now())
    expect(join).toBe(first.id)
    expect(place.inkJoinTarget(1, performance.now())).toBeNull()
    place.commitInkStroke(0, [{ x: 40, y: 10 }], join)
    expect(s().elements).toHaveLength(1)
    expect((s().elements[0] as InkElement).strokes).toHaveLength(2)
    expect(place.inkJoinTarget(0, performance.now() + 5000)).toBeNull()
  })
})
