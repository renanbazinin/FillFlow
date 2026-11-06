import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { TooltipProvider } from '../../../components/ui/tooltip'
import { setLocale } from '../../../i18n'
import type { FontId, MarkElement, TextElement } from '../../../model/types'
import { CommonActions, MarkControls, TextControls } from './sections'

const text = (fontId: FontId): TextElement => ({
  id: 't',
  kind: 'text',
  page: 0,
  x: 10,
  y: 20,
  width: 60,
  height: 14,
  text: 'Hello',
  fontId,
  fontSize: 12,
  bold: false,
  color: '#111827',
  align: 'left',
  lineHeight: 1.2,
  letterSpacing: 0,
})

/** The font the text toolbar shows for a text: on its menu button, and as the selected option. */
function shownFont(fontId: FontId): { menu?: string; selected?: string } {
  const html = renderToStaticMarkup(
    <TooltipProvider>
      <TextControls texts={[text(fontId)]} />
    </TooltipProvider>,
  )
  const checked = [...html.matchAll(/<[^>]*aria-checked="true"[^>]*>/g)].map((m) => /aria-label="(\w+) font"/.exec(m[0])?.[1])
  return { menu: /aria-label="Font: (\w+)"/.exec(html)?.[1], selected: checked.find(Boolean) }
}

const render = (node: ReactNode) => renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>)

/** The opening tags in `html` that have `attr` (e.g. `role="radiogroup"`). */
const tags = (html: string, attr: string) => [...html.matchAll(/<[^>]+>/g)].map((m) => m[0]).filter((tag) => tag.includes(attr))

const name = (tag: string) => /aria-label="([^"]*)"/.exec(tag)?.[1]

describe('the text toolbar', () => {
  it('shows the font a text is drawn in, even one this build does not know', () => {
    expect(shownFont('serif')).toEqual({ menu: 'Serif', selected: 'Serif' })
    // Saved by another build: drawn (and exported) in the default font.
    expect(shownFont('script' as FontId)).toEqual({ menu: 'Sans', selected: 'Sans' })
  })

  it('names its groups of options', () => {
    expect(tags(render(<TextControls texts={[text('sans')]} />), 'role="radiogroup"').map(name)).toEqual(['Font', 'Text alignment'])
    const mark: MarkElement = { id: 'm', kind: 'mark', page: 0, x: 0, y: 0, width: 14, height: 14, shape: 'check', color: '#111827' }
    expect(tags(render(<MarkControls marks={[mark]} />), 'role="radiogroup"').map(name)).toEqual(['Mark shape'])
  })

  it('offers Edit text whatever the pointer, so the keyboard can reach it', () => {
    const [edit] = tags(render(<CommonActions selected={[text('sans')]} />), 'aria-label="Edit text"')
    expect(edit).toMatch(/^<button/)
    expect(edit).not.toContain('hidden')
    expect(tags(render(<CommonActions selected={[text('sans'), { ...text('sans'), id: 'u' }]} />), 'aria-label="Edit text"')).toEqual([])
  })
})

/** The names of the options in `html`, in document order (the order the toolbar reads them in). */
const options = (html: string) => tags(html, 'role="radio"').map(name)

describe('the text toolbar in a right-to-left interface', () => {
  afterEach(() => setLocale('en'))

  it('keeps left at the left: its alignment options run from the right', () => {
    expect(options(render(<TextControls texts={[text('sans')]} />)).slice(-3)).toEqual(['Align left', 'Align center', 'Align right'])
    setLocale('he')
    const html = render(<TextControls texts={[text('sans')]} />)
    expect(tags(html, 'role="radiogroup"').map(name)).toEqual(['גופן', 'יישור טקסט'])
    // Laid out right to left, so the first is at the right: right, center, left on screen.
    expect(options(html).slice(-3)).toEqual(['יישור לימין', 'יישור למרכז', 'יישור לשמאל'])
    expect(options(html).slice(0, 3)).toEqual(['גופן סנס', 'גופן סריף', 'גופן מונו'])
    expect(html).toContain('aria-label="גופן: סנס"')
  })

  it('names its actions in Hebrew', () => {
    setLocale('he')
    const html = render(<CommonActions selected={[{ ...text('sans'), locked: true }]} />)
    expect(tags(html, '<button').map(name)).toEqual(['עריכת טקסט', 'שכפול', 'ביטול נעילה', 'פעולות נוספות', 'אי אפשר למחוק פריטים נעולים'])
  })
})
