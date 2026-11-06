import { renderToStaticMarkup } from 'react-dom/server'
import { DropdownMenu, ToggleGroup } from 'radix-ui'
import { toast } from 'sonner'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { STAYING_TOASTER } from './toasts'
import { HIGHLIGHT_COLOR, INK_COLORS } from '../../model/elements'
import { Button, IconButton } from './button'
import { ColorSwatches, Input, NumberStepper, Segmented, Slider, Switch } from './controls'
import { MenuCheckboxItem, MenuItem, MenuRadioGroup, MenuRadioItem, Popover, PopoverTrigger } from './menu'
import { OPEN_OVERLAY, onModalOpen } from './modal'
import { Tooltip, TooltipProvider } from './tooltip'

const tags = (html: string, tag: string) => html.match(new RegExp(`<${tag}\\b[^>]*>`, 'g')) ?? []
const classOf = (tag: string | undefined) =>
  /class="([^"]*)"/.exec(tag ?? '')?.[1].replaceAll('&amp;', '&').replaceAll('&#x27;', "'").split(' ') ?? []
const attr = (tag: string | undefined, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag ?? '')?.[1]

/** A menu's rows, rendered open (in place: a portal renders nothing on the server). */
function menuRows(): string[] {
  const html = renderToStaticMarkup(
    <DropdownMenu.Root open modal={false}>
      <DropdownMenu.Content forceMount>
        <MenuItem shortcut="Ctrl+O">Open another PDF…</MenuItem>
        <MenuCheckboxItem checked>Snap to grid</MenuCheckboxItem>
        <MenuRadioGroup value="light">
          <MenuRadioItem value="light">Light</MenuRadioItem>
        </MenuRadioGroup>
      </DropdownMenu.Content>
    </DropdownMenu.Root>,
  )
  return tags(html, 'div').filter((t) => /role="menuitem/.test(t))
}

const swatches = (props: Partial<Parameters<typeof ColorSwatches>[0]> = {}) =>
  renderToStaticMarkup(<ColorSwatches value="#111827" onChange={() => {}} colors={INK_COLORS} {...props} />)

describe('touch screens', () => {
  it('make every button at least a 40px target, whatever size it is given', () => {
    const html = renderToStaticMarkup(
      <>
        <Button size="xs">Auto</Button>
        <Button size="sm">Clear all</Button>
        <IconButton size="icon-xs" label="Lock" icon={null} tooltip={false} />
        <IconButton size="icon-sm" label="Bold" icon={null} tooltip={false} className="size-6" />
        <IconButton label="Undo" icon={null} tooltip={false} />
      </>,
    )
    const buttons = tags(html, 'button')
    expect(buttons).toHaveLength(5)
    for (const b of buttons) expect(classOf(b)).toContain('min-tap-size')
  })

  it('make menu rows 44px tall, with no keyboard shortcut shown', () => {
    const rows = menuRows()
    expect(rows).toHaveLength(3)
    for (const row of rows) expect(classOf(row)).toContain('pointer-coarse:h-11')
    const html = renderToStaticMarkup(
      <DropdownMenu.Root open modal={false}>
        <DropdownMenu.Content forceMount>
          <MenuItem shortcut="Ctrl+O">Open another PDF…</MenuItem>
        </DropdownMenu.Content>
      </DropdownMenu.Root>,
    )
    const shortcut = tags(html, 'span').find((t) => html.includes(`${t}Ctrl+O</span>`))
    expect(classOf(shortcut)).toContain('pointer-coarse:hidden')
  })

  it('make segmented options, stepper buttons and the slider band 40px', () => {
    const segmented = renderToStaticMarkup(
      <Segmented size="sm" label="Pen width" value="fine" onValueChange={() => {}} options={[{ value: 'fine', label: 'F' }, { value: 'bold', label: 'B' }]} />,
    )
    for (const option of tags(segmented, 'button')) expect(classOf(option)).toEqual(expect.arrayContaining(['pointer-coarse:h-10', 'pointer-coarse:min-w-10']))
    const stepper = renderToStaticMarkup(<NumberStepper label="Font size" value={12} onChange={() => {}} min={6} max={72} />)
    for (const b of tags(stepper, 'button')) expect(classOf(b)).toContain('pointer-coarse:w-10')
    // Inside the border: the buttons get all 40px.
    expect(classOf(tags(stepper, 'div')[0])).toEqual(expect.arrayContaining(['pointer-coarse:h-10', 'pointer-coarse:box-content']))
    const slider = renderToStaticMarkup(<Slider label="Opacity" value={50} onValueChange={() => {}} min={0} max={100} />)
    expect(classOf(tags(slider, 'span')[0])).toContain('pointer-coarse:h-10')
  })

  it('give each color swatch a 40px target, with gaps that keep the targets apart', () => {
    const html = swatches({ allowNone: true })
    const row = tags(html, 'div')[0]
    expect(classOf(row)).toContain('pointer-coarse:gap-4')
    const targets = [...tags(html, 'button'), ...tags(html, 'label')]
    expect(targets).toHaveLength(INK_COLORS.length + 2)
    // A 24px swatch with a 1px border: 22px inside it, 9px more all round.
    for (const t of targets) expect(classOf(t)).toEqual(expect.arrayContaining(['size-6', 'relative', 'pointer-coarse:before:absolute', 'pointer-coarse:before:-inset-[9px]']))
  })
})

describe('names', () => {
  it('read palette colors out in words, and a custom color by its code', () => {
    const html = swatches({ value: '#1D4ED8', colors: [...INK_COLORS, HIGHLIGHT_COLOR, '#123456'], label: 'Text color' })
    expect(attr(tags(html, 'div')[0], 'aria-label')).toBe('Text color')
    const radios = tags(html, 'button')
    expect(radios.map((r) => attr(r, 'aria-label'))).toEqual(['Black', 'Blue', 'Red', 'Green', 'Purple', 'White', 'Yellow', '#123456'])
    expect(radios.map((r) => attr(r, 'aria-checked'))).toEqual(['false', 'true', 'false', 'false', 'false', 'false', 'false', 'false'])
  })

  it('name a slider on its thumb, the element with the slider role', () => {
    const html = renderToStaticMarkup(<Slider label="Letter spacing" value={0} onValueChange={() => {}} min={-1} max={5} />)
    const thumb = tags(html, 'span').find((t) => t.includes('role="slider"'))
    expect(attr(thumb, 'aria-label')).toBe('Letter spacing')
    expect(tags(html, 'span').filter((t) => t.includes('aria-label='))).toHaveLength(1)
  })

  it('name a segmented control’s group', () => {
    const html = renderToStaticMarkup(<Segmented label="Font" value="sans" onValueChange={() => {}} options={[{ value: 'sans', label: 'Sans' }]} />)
    const group = tags(html, 'div')[0]
    expect(attr(group, 'role')).toBe('radiogroup')
    expect(attr(group, 'aria-label')).toBe('Font')
  })
})

describe('forced colors (Windows Contrast themes)', () => {
  it('draw pressed, chosen and highlighted states in the system highlight colors', () => {
    // index.css draws whatever is aria-pressed or data-state=on in them, across the app (e2e/ui-kit.spec.ts).
    const pressed = tags(renderToStaticMarkup(<IconButton label="Pages" icon={null} tooltip={false} active />), 'button')[0]
    expect(attr(pressed, 'aria-pressed')).toBe('true')
    const segmented = renderToStaticMarkup(<Segmented label="Font" value="sans" onValueChange={() => {}} options={[{ value: 'sans', label: 'Sans' }]} />)
    expect(attr(tags(segmented, 'button')[0], 'data-state')).toBe('on')
    for (const row of menuRows()) expect(classOf(row)).toEqual(expect.arrayContaining(['forced-colors:data-[highlighted]:system-highlight', 'forced-colors:[&_svg]:text-current']))
  })

  it('keep a switch drawn: an edge, and its checked state in the highlight colors', () => {
    const html = renderToStaticMarkup(<Switch checked onCheckedChange={() => {}} label="Flatten form fields" />)
    const track = tags(html, 'button')[0]
    expect(classOf(track)).toEqual(expect.arrayContaining(['border', 'border-control', 'forced-colors:data-[state=checked]:bg-[Highlight]']))
    expect(classOf(tags(html, 'span')[0])).toEqual(expect.arrayContaining(['forced-colors:bg-[CanvasText]', 'forced-colors:data-[state=checked]:bg-[HighlightText]']))
  })

  it('keep swatches in their colors, the chosen one ringed in the highlight color', () => {
    for (const t of [...tags(swatches({ allowNone: true }), 'button')]) {
      expect(classOf(t)).toEqual(expect.arrayContaining(['forced-color-adjust-none', 'forced-colors:border-[CanvasText]', 'forced-colors:ring-[Highlight]']))
    }
  })
})

// The theme tokens themselves are checked in the browser (e2e/ui-kit.spec.ts).
describe('contrast', () => {
  it('gives text fields a control border', () => {
    expect(classOf(tags(renderToStaticMarkup(<Input />), 'input')[0])).toEqual(expect.arrayContaining(['border-control', 'hover:border-fg-subtle']))
  })

  it('edges a swatch that would blend into the popover', () => {
    const html = swatches({ colors: [...INK_COLORS, HIGHLIGHT_COLOR], allowNone: true })
    const swatch = (name: string) => classOf(tags(html, 'button').find((t) => attr(t, 'aria-label') === name))
    for (const light of ['White', 'Yellow', 'No color']) expect(swatch(light)).toContain('border-control')
    for (const dark of ['Black', 'Blue']) expect(swatch(dark)).toContain('dark:border-control')
  })
})

it('leaves the state of what a tooltip wraps alone', () => {
  // A toggle group's chosen option stays "on", an open popover's trigger "open" (their styles key on it).
  const html = renderToStaticMarkup(
    <TooltipProvider>
      <ToggleGroup.Root type="single" value="dark">
        <Tooltip content="Dark theme">
          <ToggleGroup.Item value="dark" aria-label="Dark theme" />
        </Tooltip>
        <Tooltip content="Light theme">
          <ToggleGroup.Item value="light" aria-label="Light theme" />
        </Tooltip>
      </ToggleGroup.Root>
      <Popover open>
        <Tooltip content="Text color">
          <PopoverTrigger aria-label="Text color" />
        </Tooltip>
      </Popover>
    </TooltipProvider>,
  )
  expect(tags(html, 'button').map((b) => [attr(b, 'aria-label'), attr(b, 'data-state')])).toEqual([
    ['Dark theme', 'on'],
    ['Light theme', 'off'],
    ['Text color', 'open'],
  ])
})

it('counts open menus as overlays, as well as dialogs and alert dialogs', () => {
  const parts = OPEN_OVERLAY.split(',').map((s) => s.trim())
  expect(parts).toEqual(['[role="dialog"][data-state="open"]', '[role="alertdialog"][data-state="open"]', '[role="menu"][data-state="open"]'])
})

describe('a modal opening', () => {
  afterEach(() => {
    toast.dismiss()
    vi.unstubAllGlobals()
  })

  it('clears the passing toasts out of its way, but not errors nor the messages that stay until acted on', () => {
    // Nothing has focus (no opener to remember); sonner tells its toasters a frame later.
    vi.stubGlobal('document', { activeElement: null })
    vi.stubGlobal('HTMLElement', class {})
    vi.stubGlobal('requestAnimationFrame', () => 0)
    vi.stubGlobal('cancelAnimationFrame', () => {})
    const passing = [toast('Copied'), toast.success('Removed from this device')]
    const error = toast.error('Couldn’t remove the document')
    const staying = [
      toast.error('This document was changed in another tab', { toasterId: STAYING_TOASTER, duration: Infinity }),
      toast.info('Your progress can’t be saved on this device', { toasterId: STAYING_TOASTER, duration: Infinity }),
      toast('This PDF couldn’t be stored on this device', { toasterId: STAYING_TOASTER, duration: Infinity }),
    ]
    onModalOpen(new Event('focus'))
    const left = toast.getToasts().map((t) => t.id)
    expect(left).toEqual(expect.arrayContaining([error, ...staying]))
    for (const id of passing) expect(left).not.toContain(id)
  })
})
