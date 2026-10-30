import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Element, FormField, MarkElement } from '../model/types'

// The store's document-loading dependencies need a browser; the history logic doesn't.
vi.mock('../lib/pdf/pdfjs', () => ({
  looksLikePdf: () => true,
  openPdf: vi.fn(),
  readPageInfos: vi.fn(),
  PasswordRequiredError: class extends Error {},
}))
vi.mock('../lib/storage/db', () => ({
  loadDocumentBytes: vi.fn(),
  loadSession: vi.fn(),
  rememberDocument: vi.fn(),
}))
vi.mock('../model/fonts', () => ({ loadFont: vi.fn(() => Promise.resolve()) }))

const { useEditor } = await import('./editor')

const mark = (id: string, x = 10): MarkElement => ({
  id,
  kind: 'mark',
  page: 0,
  x,
  y: 10,
  width: 14,
  height: 14,
  shape: 'check',
  color: '#111827',
})

const s = () => useEditor.getState()

beforeEach(() => {
  s().closeDocument()
})

describe('editor store history', () => {
  it('adds, undoes and redoes elements', () => {
    s().addElement(mark('a'))
    s().addElement(mark('b'))
    expect(s().elements.map((e) => e.id)).toEqual(['a', 'b'])
    expect(s().selection).toEqual(['b'])
    s().undo()
    expect(s().elements.map((e) => e.id)).toEqual(['a'])
    // Undo restores the selection from before the change.
    expect(s().selection).toEqual(['a'])
    s().redo()
    expect(s().elements.map((e) => e.id)).toEqual(['a', 'b'])
  })

  it('collapses a gesture into one undo step and can cancel it', () => {
    s().addElement(mark('a', 0))
    const before = s().past.length
    s().beginGesture()
    for (let x = 1; x <= 20; x++) s().updateElement('a', { x })
    s().endGesture()
    expect(s().past.length).toBe(before + 1)
    expect((s().elements[0] as MarkElement).x).toBe(20)
    s().undo()
    expect((s().elements[0] as MarkElement).x).toBe(0)

    s().beginGesture()
    s().updateElement('a', { x: 99 })
    s().cancelGesture()
    expect((s().elements[0] as MarkElement).x).toBe(0)
  })

  it('does not record an empty gesture', () => {
    s().addElement(mark('a'))
    const before = s().past.length
    s().beginGesture()
    s().endGesture()
    expect(s().past.length).toBe(before)
  })

  it('coalesces updates with the same key', () => {
    s().addElement(mark('a', 0))
    const before = s().past.length
    s().updateElement('a', { x: 1 }, { coalesce: 'nudge' })
    s().updateElement('a', { x: 2 }, { coalesce: 'nudge' })
    s().updateElement('a', { x: 3 }, { coalesce: 'nudge' })
    expect(s().past.length).toBe(before + 1)
    s().updateElement('a', { y: 50 }, { coalesce: 'other' })
    expect(s().past.length).toBe(before + 2)
  })

  it('clears redo on a new change and prunes selection on undo', () => {
    s().addElement(mark('a'))
    s().undo()
    expect(s().future.length).toBe(1)
    s().addElement(mark('b'))
    expect(s().future.length).toBe(0)
    s().select(['b'])
    s().undo()
    expect(s().selection).toEqual([])
  })

  it('never removes locked elements', () => {
    s().addElement({ ...mark('a'), locked: true } as Element)
    s().addElement(mark('b'))
    s().removeElements(['a', 'b'])
    expect(s().elements.map((e) => e.id)).toEqual(['a'])
  })

  it('duplicates with an offset and selects the copies', () => {
    s().addElement(mark('a', 10))
    const ids = s().duplicateElements(['a'], 12)
    expect(ids).toHaveLength(1)
    expect(s().selection).toEqual(ids)
    const copy = s().elements.find((e) => e.id === ids[0]) as MarkElement
    expect(copy.x).toBe(22)
    expect(copy.id).not.toBe('a')
  })

  it('reorders to front and back', () => {
    s().addElements([mark('a'), mark('b'), mark('c')])
    s().reorderElements(['a'], 'front')
    expect(s().elements.map((e) => e.id)).toEqual(['b', 'c', 'a'])
    s().reorderElements(['a'], 'back')
    expect(s().elements.map((e) => e.id)).toEqual(['a', 'b', 'c'])
  })

  it('tracks form values with undo and resets them with clearAll', () => {
    const field: FormField = {
      name: 'name',
      type: 'text',
      widgets: [],
      readOnly: false,
      required: false,
      defaultValue: 'orig',
    }
    useEditor.setState({ doc: { id: 'x', name: 'x.pdf', bytes: new Uint8Array(), pdf: {} as never, pages: [], formFields: [field] } })
    s().setFormValue('name', 'A', { coalesce: 'field:name' })
    s().setFormValue('name', 'AB', { coalesce: 'field:name' })
    expect(s().formValues.name).toBe('AB')
    s().undo()
    expect(s().formValues.name).toBeUndefined()
    s().redo()
    s().addElement(mark('m'))
    s().clearAll()
    expect(s().elements).toEqual([])
    expect(s().formValues).toEqual({ name: 'orig' })
    useEditor.setState({ doc: null })
  })

  it('bumps revision on content changes only', () => {
    const r0 = s().revision
    s().select([])
    s().setScale(2)
    expect(s().revision).toBe(r0)
    s().addElement(mark('a'))
    expect(s().revision).toBe(r0 + 1)
  })
})
