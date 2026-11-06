import '../testing/env'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
const {
  startNewText,
  editText,
  finishTextEdit,
  finishActiveTextEdit,
  registerTextarea,
  hasTextarea,
  setEditedText,
  takePendingCaret,
  undoTextEdit,
  redoTextEdit,
} = await import('./textEdit')
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

  it('keeps the point a new block was started at when its alignment is picked before typing, and remembers it', () => {
    const text = (id: string) => s().elements.find((e) => e.id === id) as TextElement
    const el = createTextElement(0, { x: 200, y: 10 }, s().styles.text)
    startNewText(el)
    styles.setTextStyle({ align: 'right' })
    // The empty block (its caret) ends where it was started, and it grows leftwards from there.
    expect(text(el.id).x + text(el.id).width).toBeCloseTo(200)
    setEditedText(el.id, 'Hello')
    expect(text(el.id).x + text(el.id).width).toBeCloseTo(200)
    finishActiveTextEdit()

    const centered = createTextElement(0, { x: 200, y: 60 }, s().styles.text)
    startNewText(centered)
    styles.setTextStyle({ align: 'center' })
    setEditedText(centered.id, 'שלום עולם')
    expect(text(centered.id).x + text(centered.id).width / 2).toBeCloseTo(200)
    finishActiveTextEdit()

    // The next new block starts with the alignment picked last, its anchor where it is started.
    styles.setTextStyle({ align: 'right' })
    const next = createTextElement(0, { x: 300, y: 110 }, s().styles.text)
    expect(next.align).toBe('right')
    startNewText(next)
    expect(text(next.id).x + text(next.id).width).toBeCloseTo(300)
    setEditedText(next.id, '12345')
    expect(text(next.id).x + text(next.id).width).toBeCloseTo(300)
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

describe('undo and redo while typing', () => {
  const text = (id: string) => s().elements.find((e) => e.id === id) as TextElement | undefined
  /** Types `steps` one change at a time, `gap` ms apart, from `from` ms on. */
  const type = (id: string, steps: string[], from: number, gap = 100) =>
    steps.forEach((t, i) => {
      vi.setSystemTime(from + i * gap)
      setEditedText(id, t)
    })
  const burst = (word: string, before = '') => [...word].map((_, i) => before + word.slice(0, i + 1))

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(0)
  })
  afterEach(() => {
    finishActiveTextEdit()
    vi.useRealTimers()
  })

  it('takes back a new block’s typing a burst at a time, keeps typing in it, and redoes', () => {
    const el = createTextElement(0, { x: 200, y: 10 }, s().styles.text)
    startNewText(el)
    type(el.id, burst('Hello'), 1000)
    // A pause starts the next burst.
    type(el.id, burst(' world', 'Hello'), 4000)
    expect(undoTextEdit(el.id)).toBe(true)
    expect(text(el.id)).toMatchObject({ text: 'Hello', x: 200 })
    expect(undoTextEdit(el.id)).toBe(true)
    expect(text(el.id)?.text).toBe('')
    // Nothing from before it was started: the box stays, empty, still being typed into.
    expect(undoTextEdit(el.id)).toBe(false)
    expect(s().editingId).toBe(el.id)
    expect(redoTextEdit(el.id)).toBe(true)
    expect(text(el.id)?.text).toBe('Hello')
    expect(redoTextEdit(el.id)).toBe(true)
    expect(text(el.id)?.text).toBe('Hello world')
    expect(redoTextEdit(el.id)).toBe(false)
    // Committed, it is still one undo step.
    finishActiveTextEdit()
    s().undo()
    expect(s().elements).toHaveLength(0)
  })

  it('makes a paste a step of its own, and typing again ends redo', () => {
    const el = createTextElement(0, { x: 200, y: 10 }, s().styles.text)
    startNewText(el)
    type(el.id, burst('Name: '), 0)
    vi.setSystemTime(700)
    setEditedText(el.id, 'Name: Dana Cohen', false)
    type(el.id, ['Name: Dana Cohen.'], 800)
    undoTextEdit(el.id)
    expect(text(el.id)?.text).toBe('Name: Dana Cohen')
    undoTextEdit(el.id)
    expect(text(el.id)?.text).toBe('Name: ')
    type(el.id, ['Name: D'], 900)
    expect(redoTextEdit(el.id)).toBe(false)
    undoTextEdit(el.id)
    expect(text(el.id)?.text).toBe('Name: ')
  })

  it('puts back how a new block stood before its typing: Hebrew that right-aligned it, lines that pushed it up', () => {
    const el = createTextElement(0, { x: 200, y: 10 }, s().styles.text)
    startNewText(el)
    type(el.id, burst('שלום'), 0)
    expect(text(el.id)).toMatchObject({ align: 'right' })
    undoTextEdit(el.id)
    expect(text(el.id)).toMatchObject({ text: '', align: 'left', x: 200 })
    redoTextEdit(el.id)
    expect(text(el.id)).toMatchObject({ text: 'שלום', align: 'right' })
    expect(text(el.id)!.x + text(el.id)!.width).toBeCloseTo(200)
    finishActiveTextEdit()

    const low = createTextElement(0, { x: 100, y: 780 }, s().styles.text)
    startNewText(low)
    const y = text(low.id)!.y
    type(low.id, ['a', 'a\nb', 'a\nb\nc'], 0)
    expect(text(low.id)!.y).toBeLessThan(y)
    undoTextEdit(low.id)
    expect(text(low.id)).toMatchObject({ text: '', y })
  })

  it('takes back an existing block’s typing step by step, never what came before the edit', () => {
    s().addElement(mark('m'))
    const el = { ...createTextElement(0, { x: 200, y: 100 }, s().styles.text, 'Hello'), id: 'hello' }
    s().addElement(el)
    editText(el.id)
    expect(undoTextEdit(el.id)).toBe(false)
    type(el.id, burst(' world', 'Hello'), 0)
    type(el.id, ['Hello world!'], 3000)
    expect(undoTextEdit(el.id)).toBe(true)
    expect(text(el.id)?.text).toBe('Hello world')
    expect(undoTextEdit(el.id)).toBe(true)
    expect(text(el.id)?.text).toBe('Hello')
    expect(undoTextEdit(el.id)).toBe(false)
    expect(s().elements.map((e) => e.id)).toEqual(['m', 'hello'])
    expect(s().editingId).toBe(el.id)
    expect(redoTextEdit(el.id)).toBe(true)
    expect(redoTextEdit(el.id)).toBe(true)
    expect(text(el.id)?.text).toBe('Hello world!')
    expect(redoTextEdit(el.id)).toBe(false)
    expect(s().editingId).toBe(el.id)
    // Afterwards, the editor's undo goes through the same steps.
    finishActiveTextEdit()
    s().undo()
    expect(text(el.id)?.text).toBe('Hello world')
    s().undo()
    expect(text(el.id)?.text).toBe('Hello')
  })

  it('makes what is typed into a block edited again a step of its own, however soon', () => {
    const el = { ...createTextElement(0, { x: 200, y: 100 }, s().styles.text, 'Hi'), id: 'hi' }
    s().addElement(el)
    editText(el.id)
    type(el.id, ['Hi!'], 0)
    finishActiveTextEdit()
    editText(el.id)
    type(el.id, ['Hi!?'], 300)
    expect(undoTextEdit(el.id)).toBe(true)
    expect(text(el.id)?.text).toBe('Hi!')
    expect(undoTextEdit(el.id)).toBe(false)
  })

  it('keeps a redo of a new block’s typing once it is left empty by undo', () => {
    s().addElement(mark('m'))
    const before = s().past.length
    const el = createTextElement(0, { x: 200, y: 10 }, s().styles.text)
    startNewText(el)
    type(el.id, burst('Hello'), 0)
    undoTextEdit(el.id)
    finishActiveTextEdit()
    expect(s().elements.map((e) => e.kind)).toEqual(['mark'])
    expect(s().past.length).toBe(before)
    s().redo()
    expect(text(el.id)).toMatchObject({ text: 'Hello', x: 200 })
    expect(s().selection).toEqual([el.id])
    s().undo()
    expect(text(el.id)).toBeUndefined()
    s().undo()
    expect(s().elements).toHaveLength(0)
  })

  it('puts the caret where the text changed', () => {
    const el = { ...createTextElement(0, { x: 200, y: 100 }, s().styles.text, 'Hello world'), id: 'caret' }
    s().addElement(el)
    const node = { get value() { return text('caret')?.text ?? '' }, focus: vi.fn(), setSelectionRange: vi.fn() }
    registerTextarea(el.id, node as never)
    try {
      editText(el.id)
      type(el.id, ['Hello, world', 'Hello, big world'], 0)
      undoTextEdit(el.id)
      expect(node.setSelectionRange).toHaveBeenLastCalledWith(5, 5)
      redoTextEdit(el.id)
      expect(node.setSelectionRange).toHaveBeenLastCalledWith(10, 10)
    } finally {
      registerTextarea(el.id, null)
    }
  })
})

describe('text that grows', () => {
  const text = (id: string) => s().elements.find((e) => e.id === id) as TextElement

  it('stays on its page as it is typed, whichever side it grows from', () => {
    // Typed at the right end of the 600pt page: once it reaches the edge, it grows leftwards.
    const email = createTextElement(0, { x: 536, y: 100 }, s().styles.text)
    startNewText(email)
    setEditedText(email.id, 'israel.cohen@example.com')
    expect(text(email.id)).toMatchObject({ align: 'left', x: 600 - 144, width: 144 })
    finishActiveTextEdit()

    // Hebrew started near the left edge grows leftwards up to it, then rightwards.
    const name = createTextElement(0, { x: 40, y: 200 }, s().styles.text)
    startNewText(name)
    setEditedText(name.id, 'חברת דוגמה בע״מ')
    expect(text(name.id)).toMatchObject({ align: 'right', x: 0, width: 90 })
    setEditedText(name.id, 'חברת דוגמה בע״מ, סניף ראשי')
    expect(text(name.id)).toMatchObject({ x: 0 })
    finishActiveTextEdit()
    s().undo()
    expect(s().elements.find((e) => e.id === name.id)).toBeUndefined()

    // Lines added at the bottom of the page push it up.
    const low = createTextElement(0, { x: 100, y: 780 }, s().styles.text)
    startNewText(low)
    setEditedText(low.id, 'Bottom line 1\nBottom line 2\nBottom line 3')
    expect(text(low.id).y + text(low.id).height).toBeCloseTo(800)
    finishActiveTextEdit()
  })

  it('stays on its page when restyled, or measured again once its font loads', () => {
    const el = createTextElement(0, { x: 500, y: 300 }, s().styles.text, 'Size grows')
    s().addElement(el)
    styles.setTextStyle({ fontSize: 40 }, 'style:font-size')
    expect(text(el.id)).toMatchObject({ x: 600 - 200, width: 200 })
    styles.setTextStyle({ letterSpacing: 10 })
    expect(text(el.id).x + text(el.id).width).toBeCloseTo(600)

    // Measured with a narrower fallback font before its own font loaded.
    s().addElement({ ...createTextElement(0, { x: 570, y: 400 }, DEFAULT_STYLES.text, 'abcdef'), id: 'early', width: 20 })
    s().relayoutText()
    expect(text('early')).toMatchObject({ x: 564, width: 36 })
  })

  it('keeps one too wide for the page on the side it grows from', () => {
    const left = createTextElement(0, { x: 10, y: 100 }, s().styles.text, 'x')
    const right = { ...createTextElement(0, { x: 10, y: 200 }, s().styles.text, 'x'), align: 'right' as const }
    s().addElements([left, right])
    s().updateElements({ [left.id]: { text: 'x'.repeat(150) }, [right.id]: { text: 'x'.repeat(150) } })
    expect(text(left.id)).toMatchObject({ x: 0, width: 900 })
    expect(text(right.id)).toMatchObject({ x: 600 - 900, width: 900 })
  })

  it('lets one that already stuck out stay as it is, but never go further', () => {
    // Saved by an older version: 14pt past the right edge.
    const old = { ...createTextElement(0, { x: 560, y: 500 }, s().styles.text, 'stuck out'), id: 'old' }
    s().addElement(old)
    s().updateElement('old', { color: '#1d4ed8' })
    expect(text('old')).toMatchObject({ x: 560, width: 54 })
    s().updateElement('old', { text: 'stuck out!' })
    expect(text('old')).toMatchObject({ x: 554, width: 60 })
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

  it('puts the text of copied text items on the system clipboard, in reading order', () => {
    const surname = { ...createTextElement(0, { x: 400, y: 100 }, s().styles.text, 'כהן'), id: 'surname' }
    const name = { ...createTextElement(0, { x: 300, y: 101 }, s().styles.text, 'ישראל'), id: 'name' }
    const address = { ...createTextElement(0, { x: 100, y: 200 }, s().styles.text, 'רחוב הרצל 12\nתל אביב-יפו'), id: 'address' }
    s().addElements([address, name, mark('m'), surname])
    s().select(['address', 'name', 'm', 'surname'])
    copySelection()
    // A row of right-to-left text is read from the right.
    const text = clipboardMarker()!
    expect(text).toBe('כהן\nישראל\nרחוב הרצל 12\nתל אביב-יפו')
    // Pasted back here, it's still the items (also with the line breaks Windows writes)…
    expect(systemClipboardIsNewer(text, false)).toBe(false)
    expect(systemClipboardIsNewer(text.replace(/\n/g, '\r\n'), false)).toBe(false)
    expect(systemClipboardIsNewer('כהן', false)).toBe(true)
    // …and anywhere else, it's text.
    expect(isClipboardMarker(text)).toBe(false)

    // Nothing copied has text: the clipboard gets the items' marker.
    s().select(['m'])
    copySelection()
    expect(isClipboardMarker(clipboardMarker()!)).toBe(true)
  })

  describe('the text of several copied boxes', () => {
    const box = (id: string, x: number, y: number, text: string, page = 0): TextElement => ({
      ...createTextElement(page, { x, y }, s().styles.text, text),
      id,
    })
    /** Every order of `items`. */
    const orders = <T>(items: T[]): T[][] =>
      items.length < 2 ? [items] : items.flatMap((first, i) => orders(items.filter((_, j) => j !== i)).map((rest) => [first, ...rest]))
    /** What copying `selected` puts on the system clipboard, with `items` placed in this order. */
    const copied = (items: Element[], selected = items) => {
      s().removeElements(s().elements.map((e) => e.id))
      s().addElements(items)
      s().select(selected.map((e) => e.id))
      copySelection()
      return clipboardMarker()
    }

    it('reads a right-to-left row from the right, numbers included, whatever order the boxes are in', () => {
      // Form 101 rows, right to left: street | number | city, and ID | surname | first name.
      const address = [box('street', 420, 300, 'רחוב הרצל'), box('number', 330, 302, '12'), box('city', 150, 299, 'תל אביב-יפו')]
      for (const order of orders(address)) expect(copied(order)).toBe('רחוב הרצל\n12\nתל אביב-יפו')
      const names = [box('id', 450, 200, '123456782'), box('surname', 330, 201, 'כהן'), box('name', 200, 199, 'ישראל')]
      for (const order of orders(names)) expect(copied(order)).toBe('123456782\nכהן\nישראל')
      // Rows top to bottom, pages in order.
      const note = box('note', 100, 50, 'הערה', 1)
      const all = '123456782\nכהן\nישראל\nרחוב הרצל\n12\nתל אביב-יפו\nהערה'
      expect(copied([note, ...address, ...names])).toBe(all)
      expect(copied([address[1], names[0], note, address[2], names[2], address[0], names[1]])).toBe(all)
    })

    it('reads a row without right-to-left text the way most of the text on its page reads', () => {
      const contact = [box('phone', 400, 300, '03-1234567'), box('mobile', 250, 300, '054-1234567'), box('email', 50, 300, 'israel@example.com')]
      // In a Hebrew form, from the right…
      const hebrew = [box('surname', 400, 100, 'כהן'), box('name', 250, 100, 'ישראל')]
      expect(copied([...hebrew, ...contact], contact)).toBe('03-1234567\n054-1234567\nisrael@example.com')
      // …and in an English one, from the left.
      const english = [box('first', 50, 100, 'Jane'), box('last', 250, 100, 'Doe')]
      expect(copied([...english, ...contact], contact)).toBe('israel@example.com\n054-1234567\n03-1234567')
    })

    it('puts a two-line box on the row of the boxes beside its first line', () => {
      const street = box('street', 400, 301, 'רחוב הרצל 12\nדירה 4')
      const city = box('city', 200, 300, 'תל אביב-יפו')
      for (const order of orders([street, city])) expect(copied(order)).toBe('רחוב הרצל 12\nדירה 4\nתל אביב-יפו')
    })
  })

  it('writes the copied text from the context menu too', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    try {
      s().addElement(createTextElement(0, { x: 100, y: 100 }, s().styles.text, 'Jane Doe'))
      copySelection()
      writeClipboardMarker()
      expect(writeText).toHaveBeenCalledWith('Jane Doe')
      await vi.waitFor(() => expect(systemClipboardIsNewer('Jane', false)).toBe(true))
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

  it('breaks pasted lines too long for the page between words, so all of it is on the page', () => {
    s().setCurrentPage(0)
    const words = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ')
    expect(pastePlainText(words)).toBe(true)
    const t = s().elements[0] as TextElement
    expect(t.text.split('\n').length).toBeGreaterThan(1)
    expect(t.text.replace(/\n/g, ' ')).toBe(words)
    // Within the page, less a margin each side.
    expect(t.width).toBeLessThanOrEqual(600 - 72)
    expect(t.x).toBeGreaterThanOrEqual(0)
    expect(t.x + t.width).toBeLessThanOrEqual(600)
    expect(toast).not.toHaveBeenCalled()

    // Taller than the page: the top is on the page, and the user hears what happens to the rest.
    expect(pastePlainText(Array.from({ length: 80 }, (_, i) => `line ${i}`).join('\n'))).toBe(true)
    expect(s().elements[1]).toMatchObject({ y: 0 })
    expect(toast).toHaveBeenCalledWith('The pasted text doesn’t fit on the page', expect.anything())
  })

  it('pastes Hebrew right-aligned unless another alignment was picked for new text', () => {
    s().setCurrentPage(0)
    styles.setTextStyle({ align: 'center' })
    pastePlainText('ישראל כהן\nרחוב הרצל 12')
    expect((s().elements[0] as TextElement).align).toBe('center')
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
