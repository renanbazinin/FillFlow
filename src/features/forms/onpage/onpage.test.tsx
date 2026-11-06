import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FormField } from '../../../model/types'

// The store's document-loading dependencies need a browser; rendering the controls doesn't.
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

const { setLocale } = await import('../../../i18n')
const { SignatureControl } = await import('./SignatureControl')
const { RadioControl } = await import('./ToggleControls')

const rect = { x: 72, y: 100, width: 200, height: 40 }
const signature: FormField = {
  name: 'sig',
  label: 'Signature',
  type: 'signature',
  widgets: [{ id: 's1', page: 0, rect }],
  readOnly: false,
  required: false,
  defaultValue: '',
}
const plan: FormField = {
  name: 'Plan',
  type: 'radio',
  widgets: [
    { id: 'r1', page: 0, rect, exportValue: 'Basic' },
    { id: 'r2', page: 0, rect: { ...rect, x: 300 }, exportValue: 'Pro' },
  ],
  readOnly: false,
  required: false,
  defaultValue: '',
}

const sign = () => renderToStaticMarkup(<SignatureControl field={signature} widget={signature.widgets[0]} scale={1.5} interactive rotation={0} />)
const option = (i: number) => renderToStaticMarkup(<RadioControl field={plan} widget={plan.widgets[i]} scale={1.5} interactive rotation={0} />)
const attr = (html: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(html)?.[1]

describe('the fields on the pages, in Hebrew', () => {
  afterEach(() => setLocale('en'))

  it('word a signature field in Hebrew, read right to left, in the very same box', () => {
    const english = sign()
    expect(english).toContain('<span dir="ltr">Sign here</span>')
    expect(attr(english, 'aria-label')).toBe('Signature: sign here')
    setLocale('he')
    const hebrew = sign()
    expect(hebrew).toContain('<span dir="rtl">חתמו כאן</span>')
    // The field's label is the PDF's: isolated in the sentence.
    expect(attr(hebrew, 'aria-label')).toBe('⁨Signature⁩: חתמו כאן')
    expect(attr(hebrew, 'style')).toBe(attr(english, 'style'))
    expect(attr(hebrew, 'class')).toBe(attr(english, 'class'))
  })

  it('name a radio button by its field and its option', () => {
    expect(attr(option(1), 'aria-label')).toBe('Plan: Pro')
    setLocale('he')
    expect(attr(option(1), 'aria-label')).toBe('⁨Plan⁩: ⁨Pro⁩')
  })
})
