import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ShapeElement } from '../../../model/types'
import { ElementContent } from './ElementContent'

/** The attributes of a shape as drawn on screen, at 2 CSS px per point. */
function drawn(patch: Partial<ShapeElement>): Record<string, string> {
  const el: ShapeElement = {
    id: 's',
    kind: 'shape',
    page: 0,
    x: 10,
    y: 20,
    width: 100,
    height: 40,
    shape: 'rect',
    strokeColor: null,
    fillColor: '#2563eb',
    strokeWidth: 0,
    opacity: 1,
    ...patch,
  }
  const tag = /<(?:rect|ellipse|line) ([^>]*)>/.exec(renderToStaticMarkup(<ElementContent el={el} scale={2} />))
  if (!tag) throw new Error('No shape drawn')
  return Object.fromEntries([...tag[1].matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]))
}

describe('shapes on screen', () => {
  it('inset the fill for a border only, as the export does', () => {
    // No border, whatever width is left from one: the fill covers the whole box.
    expect(drawn({ strokeWidth: 6 })).toMatchObject({ x: '0', y: '0', width: '200', height: '80', stroke: 'none', 'stroke-width': '0' })
    expect(drawn({ shape: 'ellipse', strokeWidth: 6 })).toMatchObject({ rx: '100', ry: '40', stroke: 'none', 'stroke-width': '0' })
    // A color without a width is no border either.
    expect(drawn({ strokeColor: '#c81e1e', strokeWidth: 0 })).toMatchObject({ x: '0', width: '200', stroke: 'none', 'stroke-width': '0' })
    // A border stays inside the box: the shape is inset by half its width.
    expect(drawn({ strokeColor: '#c81e1e', strokeWidth: 6 })).toMatchObject({ x: '6', y: '6', width: '188', height: '68', stroke: '#c81e1e', 'stroke-width': '12' })
    expect(drawn({ shape: 'ellipse', strokeColor: '#c81e1e', strokeWidth: 6 })).toMatchObject({ rx: '94', ry: '34', 'stroke-width': '12' })
    // Lines are never inset, and need a color to show.
    expect(drawn({ shape: 'line', strokeColor: '#c81e1e', strokeWidth: 6 })).toMatchObject({ x1: '0', y1: '0', x2: '200', y2: '80', 'stroke-width': '12' })
    expect(drawn({ shape: 'line', strokeWidth: 6 })).toMatchObject({ stroke: 'none', 'stroke-width': '0' })
  })
})
