import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '../../../components/ui/tooltip'
import type { FontId, TextElement } from '../../../model/types'
import { TextControls } from './sections'

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

describe('the text toolbar', () => {
  it('shows the font a text is drawn in, even one this build does not know', () => {
    expect(shownFont('serif')).toEqual({ menu: 'Serif', selected: 'Serif' })
    // Saved by another build: drawn (and exported) in the default font.
    expect(shownFont('script' as FontId)).toEqual({ menu: 'Sans', selected: 'Sans' })
  })
})
