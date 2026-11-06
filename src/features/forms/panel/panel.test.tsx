import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FormField } from '../../../model/types'

// The store's document-loading dependencies need a browser; rendering the panel doesn't.
vi.mock('../../../lib/pdf/pdfjs', () => ({
  looksLikePdf: () => true,
  openPdf: vi.fn(),
  readPageInfos: vi.fn(),
  PasswordRequiredError: class extends Error {},
}))
vi.mock('../../../lib/storage/db', () => ({
  loadDocumentBytes: vi.fn(),
  loadSession: vi.fn(),
  rememberDocument: vi.fn(),
}))
vi.mock('../../../model/fonts', async (orig) => ({ ...(await orig<object>()), loadFont: vi.fn(() => Promise.resolve()) }))
vi.mock('../../viewer/viewerApi', () => ({ viewer: { scrollToRect: vi.fn() } }))

const { TooltipProvider } = await import('../../../components/ui/tooltip')
const { setLocale } = await import('../../../i18n')
const { FieldInput } = await import('./FieldInput')
const { NoFieldsState, XfaNotice } = await import('./PanelStates')
const { ProgressHeader } = await import('./ProgressHeader')

const tags = (html: string, tag: string) => html.match(new RegExp(`<${tag}\\b[^>]*>`, 'g')) ?? []
const classOf = (tag: string | undefined) => /class="([^"]*)"/.exec(tag ?? '')?.[1].split(' ') ?? []
const attr = (tag: string | undefined, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag ?? '')?.[1]
/** The text of some markup, tags dropped. */
const text = (html: string) => html.replace(/<[^>]*>/g, '')

const field = (type: 'text' | 'dropdown', over: Partial<FormField> = {}): FormField => ({
  name: 'Country',
  type,
  widgets: [],
  readOnly: false,
  required: false,
  defaultValue: '',
  options: type === 'dropdown' ? [{ value: 'IL', label: 'Israel' }] : undefined,
  ...over,
})

describe('the form panel', () => {
  it('names its field filter', () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <ProgressHeader
          progress={{ total: 4, filled: 1, required: 2, requiredFilled: 0 }}
          filter="all"
          onFilter={() => {}}
          emptyCount={3}
          dirty={false}
          onNext={() => {}}
          onReset={() => {}}
        />
      </TooltipProvider>,
    )
    expect(tags(html, 'div').find((t) => t.includes('role="radiogroup"'))).toContain('aria-label="Show fields"')
  })

  it('shows no keyboard shortcuts on touch screens', () => {
    for (const html of [renderToStaticMarkup(<NoFieldsState />), renderToStaticMarkup(<XfaNotice />)]) {
      const keys = tags(html, 'kbd')
      expect(keys.length).toBeGreaterThan(0)
      for (const kbd of keys) expect(classOf(kbd)).toContain('pointer-coarse:hidden')
    }
  })

  it('styles a <select> as locked only when its field is read-only', () => {
    // Every <select> matches :read-only, so the locked look can't come from that.
    const select = (readOnly: boolean) => classOf(tags(renderToStaticMarkup(<FieldInput field={field('dropdown', { readOnly })} />), 'select')[0])
    expect(select(false)).toEqual(expect.arrayContaining(['border-control', 'bg-surface']))
    expect(select(false).filter((c) => c.startsWith('read-only:') || c === 'bg-surface-2')).toEqual([])
    expect(select(true)).toContain('bg-surface-2')
  })

  it('styles a text box as locked only when its field is read-only, still showing focus', () => {
    const box = (f: FormField) => {
      const html = renderToStaticMarkup(<FieldInput field={f} />)
      return classOf([...tags(html, 'input'), ...tags(html, 'textarea')][0])
    }
    for (const f of [field('text'), field('text', { multiline: true }), field('dropdown', { editable: true })]) {
      expect(box(f)).toContain('border-control')
      expect(box(f)).not.toContain('bg-surface-2')
      const locked = box({ ...f, readOnly: true })
      expect(locked).toContain('bg-surface-2')
      expect(locked).toEqual(expect.arrayContaining(['focus:ring-3', 'focus:outline-hidden']))
    }
  })
})

describe('the form panel in Hebrew', () => {
  afterEach(() => setLocale('en'))

  const header = (filled: number, requiredFilled: number) =>
    renderToStaticMarkup(
      <TooltipProvider>
        <ProgressHeader
          progress={{ total: 4, filled, required: 2, requiredFilled }}
          filter="all"
          onFilter={() => {}}
          emptyCount={4 - filled}
          dirty={false}
          onNext={() => {}}
          onReset={() => {}}
        />
      </TooltipProvider>,
    )

  it('counts what is filled, with one field in the singular', () => {
    setLocale('he')
    expect(text(header(3, 1))).toContain('3 מתוך 4 מולאו')
    expect(text(header(3, 1))).toContain('נותר שדה חובה אחד')
    expect(text(header(1, 0))).toMatch(/1 מתוך 4 מולא(?!ו)/)
    expect(text(header(1, 0))).toContain('נותרו 2 שדות חובה')
    expect(attr(tags(header(1, 0), 'div').find((t) => t.includes('role="progressbar"')), 'aria-valuetext')).toBe('שדות שמולאו: 1 מתוך 4')
  })

  it('starts an empty box on the interface’s side, and lets what people type read its own way', () => {
    const dir = (f: FormField) => attr(tags(renderToStaticMarkup(<FieldInput field={f} />), 'input')[0], 'dir')
    setLocale('he')
    expect(dir(field('text'))).toBe('rtl')
    expect(dir(field('text', { defaultValue: '054-1234567' }))).toBe('rtl')
    expect(dir(field('text', { defaultValue: 'Dana' }))).toBe('ltr')
    expect(dir(field('dropdown', { editable: true }))).toBe('rtl')
    setLocale('en')
    expect(dir(field('text'))).toBe('ltr')
    expect(dir(field('text', { defaultValue: 'דנה' }))).toBe('rtl')
  })

  it('keeps a drop-down’s box and arrow on the interface’s side', () => {
    setLocale('he')
    const html = renderToStaticMarkup(<FieldInput field={field('dropdown')} />)
    expect(attr(tags(html, 'select')[0], 'dir')).toBe('rtl')
    expect(classOf(tags(html, 'select')[0])).toEqual(expect.arrayContaining(['ps-3', 'pe-9']))
    expect(text(html)).toContain('בחרו…')
  })

  it('shows the PDF’s words as they are, in their own direction, and names a group of choices by them', () => {
    setLocale('he')
    const rect = { x: 0, y: 0, width: 10, height: 10 }
    const plan: FormField = {
      ...field('text'),
      name: 'Plan',
      type: 'radio',
      readOnly: true,
      widgets: [
        { id: 'a', page: 0, rect, exportValue: 'Basic' },
        { id: 'b', page: 0, rect, exportValue: '' },
      ],
    }
    const html = renderToStaticMarkup(<FieldInput field={plan} />)
    const label = tags(html, 'bdi')[0]
    expect(html).toContain('>Plan</bdi>')
    expect(attr(tags(html, 'div').find((t) => t.includes('role="radiogroup"')), 'aria-labelledby')).toBe(attr(label, 'id'))
    // Ours: a choice the PDF leaves blank, and what screen readers hear on a read-only field.
    expect(text(html)).toContain('(ריק)')
    expect(text(html)).toContain('(לקריאה בלבד)')
    expect(text(html)).toContain('Basic')
  })
})
