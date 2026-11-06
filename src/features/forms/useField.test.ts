import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FormField } from '../../model/types'

// The store's document-loading dependencies need a browser; routing undo doesn't.
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
const { isMac } = await import('../../lib/utils/misc')
const { guardNativeHistory, routeHistoryKeys, setFieldValue } = await import('./useField')

const s = () => useEditor.getState()
const field = (name: string): FormField => ({ name, type: 'text', widgets: [], readOnly: false, required: false, defaultValue: '' })

/** A document with two fields, filled one after the other: two steps of the editor's history. */
function fillNameThenEmail() {
  useEditor.setState({
    doc: { id: 'x', name: 'x.pdf', bytes: new Uint8Array(), pdf: {} as never, pages: [], formFields: [field('name'), field('email')] },
    formValues: {},
    past: [],
    future: [],
  })
  setFieldValue('name', 'Dana')
  setFieldValue('email', 'd@x.io')
}

/** A keydown in a field with ⌘ (Apple) or Ctrl (elsewhere) held, as React hands it over. */
function modKey(key: string, code: string, over: { shiftKey?: boolean; altKey?: boolean; isComposing?: boolean; mod?: boolean } = {}) {
  const mod = over.mod ?? true
  return {
    key,
    code,
    ctrlKey: mod && !isMac,
    metaKey: mod && isMac,
    altKey: over.altKey ?? false,
    shiftKey: over.shiftKey ?? false,
    nativeEvent: { isComposing: over.isComposing ?? false },
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  }
}

describe('undo and redo keys in a form field', () => {
  beforeEach(fillNameThenEmail)

  it('run the editor’s undo, not the browser’s, on a Hebrew layout too', () => {
    const e = modKey('ז', 'KeyZ')
    expect(routeHistoryKeys(e)).toBe(true)
    expect(e.preventDefault).toHaveBeenCalled()
    expect(e.stopPropagation).toHaveBeenCalled()
    expect(s().formValues).toEqual({ name: 'Dana' })
    expect(routeHistoryKeys(modKey('z', 'KeyZ'))).toBe(true)
    expect(s().formValues).toEqual({})
  })

  it('redo with Shift+Z, and with Ctrl+Y except on Apple platforms', () => {
    routeHistoryKeys(modKey('ז', 'KeyZ'))
    routeHistoryKeys(modKey('ז', 'KeyZ'))
    expect(routeHistoryKeys(modKey('ז', 'KeyZ', { shiftKey: true }))).toBe(true)
    expect(s().formValues).toEqual({ name: 'Dana' })
    expect(routeHistoryKeys(modKey('ט', 'KeyY'))).toBe(!isMac)
    expect(s().formValues).toEqual(isMac ? { name: 'Dana' } : { name: 'Dana', email: 'd@x.io' })
  })

  it('leave every other key alone', () => {
    const others = [
      modKey('z', 'KeyZ', { mod: false }),
      modKey('ż', 'KeyZ', { altKey: true }), // AltGr is Ctrl+Alt: a character, not undo
      modKey('z', 'KeyZ', { isComposing: true }),
      modKey('נ', 'KeyB'),
      modKey('Enter', 'Enter'),
    ]
    for (const e of others) {
      expect(routeHistoryKeys(e)).toBe(false)
      expect(e.preventDefault).not.toHaveBeenCalled()
    }
    expect(s().formValues).toEqual({ name: 'Dana', email: 'd@x.io' })
  })
})

/** Stands in for a DOM element: a form field's control (on the page or in the panel), or anything else. */
class FakeElement {
  readonly isField: boolean
  constructor(isField: boolean) {
    this.isField = isField
  }
  closest() {
    return this.isField ? this : null
  }
}
vi.stubGlobal('Element', FakeElement)
const inField = new FakeElement(true) as unknown as Element
const elsewhere = new FakeElement(false) as unknown as Element // a text item, the file name box, a button…

/** The `beforeinput` the browser sends before running its own undo or redo (aimed at what it would change). */
function nativeInput(inputType: string, target: Element, over: { cancelable?: boolean; defaultPrevented?: boolean } = {}) {
  return { inputType, target, cancelable: over.cancelable ?? true, defaultPrevented: over.defaultPrevented ?? false, preventDefault: vi.fn() }
}

describe('the guard against the browser’s own undo and redo', () => {
  beforeEach(fillNameThenEmail)

  it('keeps them from changing a field from outside it', () => {
    const undo = nativeInput('historyUndo', inField)
    guardNativeHistory(undo, elsewhere)
    expect(undo.preventDefault).toHaveBeenCalled()
    const redo = nativeInput('historyRedo', inField)
    guardNativeHistory(redo, null)
    expect(redo.preventDefault).toHaveBeenCalled()
    // Nor do they run the editor's history there: that is the focused box's business.
    expect(s().formValues).toEqual({ name: 'Dana', email: 'd@x.io' })
  })

  it('runs the editor’s undo and redo instead, from inside a field (its context menu)', () => {
    const undo = nativeInput('historyUndo', elsewhere) // whatever the browser would have changed
    guardNativeHistory(undo, inField)
    expect(undo.preventDefault).toHaveBeenCalled()
    expect(s().formValues).toEqual({ name: 'Dana' })
    guardNativeHistory(nativeInput('historyRedo', inField), inField)
    expect(s().formValues).toEqual({ name: 'Dana', email: 'd@x.io' })
  })

  it('leaves everything else to the browser, and acts once however many guards listen', () => {
    const others: [ReturnType<typeof nativeInput>, Element | null][] = [
      [nativeInput('historyUndo', elsewhere), elsewhere], // a text item undoing its own typing
      [nativeInput('insertText', inField), inField],
      [nativeInput('deleteContentBackward', inField), inField],
      [nativeInput('historyUndo', inField, { cancelable: false }), inField], // can't be stopped: never undo twice
      [nativeInput('historyUndo', inField, { defaultPrevented: true }), inField], // another guard handled it
    ]
    for (const [e, focused] of others) {
      guardNativeHistory(e, focused)
      expect(e.preventDefault).not.toHaveBeenCalled()
    }
    expect(s().formValues).toEqual({ name: 'Dana', email: 'd@x.io' })
  })
})
