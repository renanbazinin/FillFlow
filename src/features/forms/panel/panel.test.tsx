import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
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
const { FieldInput } = await import('./FieldInput')
const { NoFieldsState, XfaNotice } = await import('./PanelStates')
const { ProgressHeader } = await import('./ProgressHeader')

const tags = (html: string, tag: string) => html.match(new RegExp(`<${tag}\\b[^>]*>`, 'g')) ?? []
const classOf = (tag: string | undefined) => /class="([^"]*)"/.exec(tag ?? '')?.[1].split(' ') ?? []

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
