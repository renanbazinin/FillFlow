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
const { startNewText, editText, finishTextEdit, finishActiveTextEdit, registerTextarea, hasTextarea, setEditedText, takePendingCaret } = await import('./textEdit')
const { deleteElements, deleteSelection, nudgeSelection, revealElement, selectAllOnPage, setLocked, toggleLockSelection } = await import('./commands')
const { registerViewer } = await import('../../viewer/viewerApi')
const { copySelection, pasteItems, clipboardMarker, isClipboardMarker, systemClipboardIsNewer, pastePlainText, writeClipboardMarker } = await import('./clipboard')
const styles = await import('../toolbar/styleActions')
const place = await import('../create/place')
const { toast } = await import('sonner')

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
  vi.mocked(toast).mockClear()
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

  it('right-aligns a new block typed in Hebrew, keeping its right edge where it was started', () => {
    const el = createTextElement(0, { x: 200, y: 10 }, s().styles.text)
    startNewText(el)
    const text = () => s().elements[0] as TextElement
    // Neutral characters first (digits, a bracket): no direction yet, so it stays as it was.
    setEditedText(el.id, '12 (')
    expect(text().align).toBe('left')
    expect(text().x).toBe(200)
    // The first Hebrew letter decides: from now on it grows leftwards from where it was started.
    setEditedText(el.id, '12 (ש')
    expect(text().align).toBe('right')
    expect(text().x + text().width).toBeCloseTo(200)
    setEditedText(el.id, '12 (שלום)')
    expect(text().x + text().width).toBeCloseTo(200)
    expect(text().x).toBeLessThan(200)
    finishActiveTextEdit()
    s().undo()
    expect(s().elements).toHaveLength(0)
  })

  it('leaves the alignment of English text, of existing blocks, and one chosen while typing', () => {
    const english = createTextElement(0, { x: 200, y: 10 }, s().styles.text)
    startNewText(english)
    setEditedText(english.id, 'Hello שלום')
    expect(s().elements.find((e) => e.id === english.id)).toMatchObject({ align: 'left', x: 200 })
    finishActiveTextEdit()

    const existing = { ...createTextElement(0, { x: 200, y: 60 }, s().styles.text, '12'), id: 'existing' }
    s().addElement(existing)
    editText(existing.id)
    setEditedText(existing.id, '12 שלום')
    expect(s().elements.find((e) => e.id === existing.id)).toMatchObject({ align: 'left', x: 200 })
    finishActiveTextEdit()

    const centered = createTextElement(0, { x: 200, y: 110 }, s().styles.text)
    startNewText(centered)
    s().updateElement(centered.id, { align: 'center' })
    setEditedText(centered.id, 'שלום')
    expect(s().elements.find((e) => e.id === centered.id)).toMatchObject({ align: 'center' })
    finishActiveTextEdit()
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

  it('brings the text back with one undo after an existing block was emptied', () => {
    const el = createTextElement(0, { x: 10, y: 10 }, s().styles.text, 'abc')
    s().addElement(el)
    const before = s().past.length
    editText(el.id)
    s().updateElement(el.id, { text: '' }, { coalesce: `text:${el.id}` })
    finishTextEdit(el.id)
    expect(s().elements).toHaveLength(0)
    expect(s().past.length).toBe(before + 1)
    s().undo()
    expect((s().elements[0] as TextElement).text).toBe('abc')
    s().redo()
    expect(s().elements).toHaveLength(0)
  })

  it('gives an emptied locked block its text back, leaving no undo step', () => {
    const el = { ...createTextElement(0, { x: 10, y: 10 }, s().styles.text, 'abc'), locked: true }
    s().addElement(el)
    const past = s().past
    editText(el.id)
    s().updateElement(el.id, { text: ' ' }, { coalesce: `text:${el.id}` })
    finishTextEdit(el.id)
    expect(s().elements[0]).toMatchObject({ text: 'abc', width: el.width, locked: true })
    expect(s().past).toEqual(past)
    expect(toast).toHaveBeenCalledWith('This item is locked', expect.anything())
  })

  it('drops an empty new block without undoing what else changed meanwhile', () => {
    s().addElement(mark('m'))
    const before = s().past.length
    const el = createTextElement(0, { x: 10, y: 10 }, s().styles.text)
    startNewText(el)
    // E.g. the editor went away without ending the session, then other edits happened.
    s().updateElement('m', { x: 300 })
    finishTextEdit(el.id)
    expect(s().elements.map((e) => [e.id, e.x])).toEqual([['m', 300]])
    expect(s().past.length).toBe(before + 1)
    s().undo()
    expect(s().elements.map((e) => [e.id, e.x])).toEqual([['m', 100]])
  })

  it('drops an empty new block even if it was locked while typing', () => {
    const before = s().past.length
    const el = createTextElement(0, { x: 10, y: 10 }, s().styles.text)
    startNewText(el)
    setLocked([el.id], true)
    finishTextEdit(el.id)
    expect(s().elements).toHaveLength(0)
    expect(s().past.length).toBe(before)
  })

  it('keeps the caret request for an editor that mounts later', () => {
    const el = createTextElement(0, { x: 10, y: 10 }, s().styles.text, 'Hello')
    s().addElement(el)
    editText(el.id)
    expect(hasTextarea(el.id)).toBe(false)
    expect(takePendingCaret(el.id)).toBe('end')
    finishActiveTextEdit()

    const node = { value: 'Hello', focus: vi.fn(), setSelectionRange: vi.fn() }
    registerTextarea(el.id, node as never)
    expect(hasTextarea(el.id)).toBe(true)
    editText(el.id, 2)
    expect(node.focus).toHaveBeenCalled()
    expect(node.setSelectionRange).toHaveBeenCalledWith(2, 2)
    expect(takePendingCaret(el.id)).toBeNull()
    registerTextarea(el.id, null)
    expect(hasTextarea(el.id)).toBe(false)
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

  it('keeps nudges of different items in separate undo steps', () => {
    s().addElements([mark('a', 100), mark('b', 300)])
    const before = s().past.length
    s().select(['a'])
    nudgeSelection(1, 0)
    s().select(['b'])
    nudgeSelection(1, 0)
    expect(s().elements.map((e) => e.x)).toEqual([101, 301])
    expect(s().past.length).toBe(before + 2)
    s().undo()
    expect(s().elements.map((e) => e.x)).toEqual([101, 300])
  })

  it('deletes given items, keeping locked ones', () => {
    s().addElements([{ ...mark('a'), locked: true } as Element, mark('b', 200)])
    s().select(['b'])
    deleteElements(['a'])
    expect(s().elements.map((e) => e.id)).toEqual(['a', 'b'])
    expect(toast).toHaveBeenCalledWith('This item is locked', expect.anything())
    deleteElements(['a', 'b'])
    expect(s().elements.map((e) => e.id)).toEqual(['a'])
    expect(s().selection).toEqual([])
  })

  it('leaves it to the viewer whether revealing an item animates (reduced motion, long jumps)', () => {
    const scrollToRect = vi.fn()
    registerViewer({ scrollToRect } as never)
    try {
      revealElement(mark('a', 100, 200, 1))
      expect(scrollToRect).toHaveBeenLastCalledWith(1, { x: 100, y: 200, width: 14, height: 14 }, { behavior: undefined, margin: 48 })
      revealElement(mark('a'), 'auto')
      expect(scrollToRect).toHaveBeenLastCalledWith(0, expect.anything(), { behavior: 'auto', margin: 48 })
    } finally {
      registerViewer(null)
    }
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

  it('lets an image from elsewhere win even when the marker could not be written', async () => {
    s().addElement(mark('a'))
    s().select(['a'])
    copySelection()
    expect(systemClipboardIsNewer('', true)).toBe(true)
    expect(systemClipboardIsNewer('some text', false)).toBe(false)

    // Copied from the context menu: the marker goes through the async clipboard API.
    const writeText = vi.fn(() => Promise.resolve())
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    try {
      copySelection()
      writeClipboardMarker()
      const marker = (writeText.mock.calls[0] as unknown as [string])[0]
      expect(isClipboardMarker(marker)).toBe(true)
      await vi.waitFor(() => expect(systemClipboardIsNewer('Jane Doe, 12 Main St', false)).toBe(true))
      expect(systemClipboardIsNewer(marker, false)).toBe(false)

      // Writing refused: we still can't tell text apart, so the items copied here win.
      writeText.mockImplementationOnce(() => Promise.reject(new Error('NotAllowedError')))
      copySelection()
      writeClipboardMarker()
      await Promise.resolve()
      expect(systemClipboardIsNewer('Jane Doe', false)).toBe(false)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('recognizes item markers from any tab', () => {
    expect(isClipboardMarker('fillflow-items:cf877ef3-1c2d-4e5f-9a8b-0123456789ab')).toBe(true)
    expect(isClipboardMarker('  fillflow-items:abc\n')).toBe(true)
    expect(isClipboardMarker('fillflow-items:')).toBe(false)
    expect(isClipboardMarker('fillflow-items: my notes')).toBe(false)
    expect(isClipboardMarker('Jane Doe')).toBe(false)
  })

  it('pastes plain text as a text block that fits the page', () => {
    s().setCurrentPage(0)
    expect(pastePlainText('Hello\r\nworld\t!  \n')).toBe(true)
    const t = s().elements[0] as TextElement
    expect(t.text).toBe('Hello\nworld    !')
    expect(t.x + t.width).toBeLessThanOrEqual(600)
    expect(t.align).toBe('left')
    expect(pastePlainText('   ')).toBe(false)
    // Hebrew lines up on the right, as it is read.
    expect(pastePlainText('ישראל כהן\nרחוב הרצל 12')).toBe(true)
    expect((s().elements[1] as TextElement).align).toBe('right')
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

  it('never resizes locked items', () => {
    const ink: InkElement = { id: 'k', kind: 'ink', page: 0, x: 9, y: 9, width: 22, height: 12, strokes: [[0, 0, 1, 1]], color: '#000', strokeWidth: 2, locked: true }
    const text = { ...createTextElement(0, { x: 0, y: 0 }, s().styles.text, 'one'), locked: true }
    s().addElements([{ ...mark('a'), locked: true } as Element, mark('b', 200), ink, text])
    s().select(['a', 'b'])
    styles.setMarkSize(40)
    expect(s().elements.slice(0, 2).map((e) => [e.x, e.width])).toEqual([
      [100, 14],
      [187, 40],
    ])
    s().select(['k'])
    styles.setInkWidth(10)
    expect(s().elements[2]).toMatchObject({ x: 9, width: 22, strokeWidth: 2 })
    s().select([text.id])
    styles.setTextStyle({ fontSize: 40 }, 'style:font-size')
    styles.setTextStyle({ color: '#1d4ed8' }, 'style:text-color')
    expect(s().elements[3]).toMatchObject({ fontSize: 12, width: text.width, color: '#1d4ed8' })
  })

  it('keeps style changes to different items in separate undo steps', () => {
    const a = createTextElement(0, { x: 0, y: 0 }, s().styles.text, 'one')
    const b = createTextElement(0, { x: 0, y: 50 }, s().styles.text, 'two')
    s().addElements([a, b])
    const before = s().past.length
    s().select([a.id])
    styles.setTextStyle({ fontSize: 20 }, 'style:font-size')
    styles.setTextStyle({ fontSize: 22 }, 'style:font-size')
    s().select([b.id])
    styles.setTextStyle({ fontSize: 30 }, 'style:font-size')
    expect(s().past.length).toBe(before + 2)
    s().undo()
    expect(s().elements.map((e) => (e as TextElement).fontSize)).toEqual([22, 12])
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

  it('places tall initials at a sensible height', () => {
    // A drawn "I": one vertical stroke.
    const assetId = s().addAsset({ mime: 'image/png', dataUrl: 'data:image/png;base64,', width: 155, height: 1600 })
    s().startPlacingAsset('initials', assetId)
    place.placeAsset(pageInfo(0), { x: 300, y: 400 }, 'initials')
    const el = s().elements[0]
    expect(el.height).toBeLessThanOrEqual(42)
    expect(el.width / el.height).toBeCloseTo(155 / 1600)
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
