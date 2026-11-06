import { useEffect, useRef } from 'react'
import {
  BringToFront,
  Copy,
  Ellipsis,
  Lock,
  LockOpen,
  PencilLine,
  SendToBack,
  SlidersHorizontal,
  TextAlignCenter,
  TextAlignEnd,
  TextAlignStart,
  Trash,
} from 'lucide-react'
import { IconButton } from '../../../components/ui/button'
import { Segmented, type SegmentedOption } from '../../../components/ui/controls'
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from '../../../components/ui/menu'
import { Tooltip } from '../../../components/ui/tooltip'
import { useDir, useT, type Direction, type Messages } from '../../../i18n'
import { HIGHLIGHT_COLOR, INK_COLORS, MAX_FONT_SIZE, MIN_FONT_SIZE } from '../../../model/elements'
import { cssFontFamily, FONT_IDS, FONTS, fontDef, loadFont } from '../../../model/fonts'
import type { Element, FontId, ImageElement, InkElement, MarkElement, MarkShape, ShapeElement, TextAlign, TextElement } from '../../../model/types'
import { useEditor } from '../../../store/editor'
import { cn, modKeyLabel } from '../../../lib/utils/misc'
import { MarkGlyph } from '../render/ElementContent'
import { deleteSelection, duplicateSelection, reorderSelection, toggleLockSelection } from '../state/commands'
import { editText } from '../state/textEdit'
import { preventFocusWhileEditing } from './focus'
import { ColorButton, OpacityButton, SizeField, SliderRow, ToolbarSeparator, TriggerButton } from './parts'
import { POPOVER_FIT, useAwayPopover, usePopoverSide } from './popoverSide'
import { useTapMenu } from './tapMenu'
import {
  setImageOpacity,
  setInkColor,
  setInkWidth,
  setMarkColor,
  setMarkShape,
  setMarkSize,
  setShapeFill,
  setShapeOpacity,
  setShapeStroke,
  setShapeStrokeWidth,
  setTextStyle,
  toggleBold,
} from './styleActions'

/**
 * Where text sits on the page, which reads left to right whatever the interface does: the icons
 * don't mirror, and left stays at the left. A right-to-left toolbar lays its options out from the
 * right, so they come right, center, left there (and the arrow keys go along them as they show).
 */
function alignOptions(t: Messages, dir: Direction): SegmentedOption<TextAlign>[] {
  const m = t.elements.toolbar
  const options: SegmentedOption<TextAlign>[] = [
    { value: 'left', label: <TextAlignStart />, ariaLabel: m.alignLeft },
    { value: 'center', label: <TextAlignCenter />, ariaLabel: m.alignCenter },
    { value: 'right', label: <TextAlignEnd />, ariaLabel: m.alignRight },
  ]
  return dir === 'rtl' ? options.reverse() : options
}

/** The fonts, each named in itself (a font's label follows the interface language). */
function fontOptions(t: Messages): SegmentedOption<FontId>[] {
  return FONT_IDS.map((id) => ({
    value: id,
    label: <span style={{ fontFamily: cssFontFamily(id) }}>{FONTS[id].label}</span>,
    ariaLabel: t.elements.toolbar.fontOption(FONTS[id].label),
  }))
}

function markOptions(t: Messages): SegmentedOption<MarkShape>[] {
  return (['check', 'cross', 'dot'] as const).map((shape) => ({
    value: shape,
    label: <MarkGlyph shape={shape} color="currentColor" className="block size-4" />,
    ariaLabel: t.elements.names[shape],
  }))
}

const FILL_COLORS = [...INK_COLORS, HIGHLIGHT_COLOR] as const

const round1 = (n: number) => Math.round(n * 10) / 10

// --- text --------------------------------------------------------------------

function FontPicker({ value }: { value: FontId }) {
  const t = useT()
  const m = t.elements.toolbar
  useEffect(() => {
    // Labels are drawn in the fonts themselves.
    for (const id of FONT_IDS) void loadFont(id, false)
  }, [])
  // The font the text is drawn in: an id this build doesn't know gets the default one.
  const font = fontDef(value)
  const menu = useTapMenu()
  const side = usePopoverSide()
  return (
    <>
      <Segmented size="sm" label={m.font} className="max-sm:hidden" value={font.id} onValueChange={(fontId) => setTextStyle({ fontId })} options={fontOptions(t)} />
      <Menu {...menu.root}>
        <Tooltip content={m.font}>
          <MenuTrigger asChild {...menu.trigger}>
            <TriggerButton label={m.fontButton(font.label)} className="px-2 text-[13px] font-medium text-fg sm:hidden">
              <span style={{ fontFamily: cssFontFamily(font.id) }}>{font.label}</span>
            </TriggerButton>
          </MenuTrigger>
        </Tooltip>
        <MenuContent side={side} align="start" className="min-w-40" onCloseAutoFocus={preventFocusWhileEditing}>
          <MenuLabel>{m.font}</MenuLabel>
          <MenuRadioGroup value={font.id} onValueChange={(v) => setTextStyle({ fontId: v as FontId })}>
            {FONT_IDS.map((id) => (
              <MenuRadioItem key={id} value={id}>
                <span style={{ fontFamily: cssFontFamily(id) }}>{FONTS[id].label}</span>
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuContent>
      </Menu>
    </>
  )
}

function SpacingButton({ text }: { text: TextElement }) {
  const t = useT()
  const dir = useDir()
  const m = t.elements.toolbar
  const trigger = useRef<HTMLButtonElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const away = useAwayPopover(trigger, content)
  return (
    <Popover {...away.root}>
      <PopoverAnchor virtualRef={away.virtualRef} />
      <Tooltip content={m.spacingTip}>
        <PopoverTrigger asChild>
          <TriggerButton ref={trigger} label={m.spacing}>
            <SlidersHorizontal className="size-4" />
          </TriggerButton>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent
        ref={content}
        side={away.side}
        align="end"
        aria-label={m.spacing}
        className={cn('grid w-64 gap-4', POPOVER_FIT)}
        onOpenAutoFocus={preventFocusWhileEditing}
        onCloseAutoFocus={preventFocusWhileEditing}
      >
        <div className="grid gap-2 sm:hidden">
          <span className="text-[13px] font-medium text-fg-muted">{m.alignment}</span>
          <Segmented
            size="sm"
            label={m.textAlignment}
            className="w-full [&>*]:flex-1"
            value={text.align}
            onValueChange={(align) => setTextStyle({ align })}
            options={alignOptions(t, dir)}
          />
        </div>
        <SliderRow
          label={m.letterSpacing}
          value={text.letterSpacing}
          display={t.elements.points(round1(text.letterSpacing))}
          onChange={(v) => setTextStyle({ letterSpacing: v }, 'style:letter-spacing')}
          min={0}
          max={20}
          step={0.5}
        />
        <SliderRow
          label={m.lineHeight}
          value={text.lineHeight}
          display={`${text.lineHeight.toFixed(2)}×`}
          onChange={(v) => setTextStyle({ lineHeight: Math.round(v * 100) / 100 }, 'style:line-height')}
          min={0.8}
          max={3}
          step={0.05}
        />
      </PopoverContent>
    </Popover>
  )
}

export function TextControls({ texts }: { texts: TextElement[] }) {
  const t = useT()
  const dir = useDir()
  const m = t.elements.toolbar
  const first = texts[0]
  const bold = texts.every((x) => x.bold)
  return (
    <>
      <FontPicker value={first.fontId} />
      <SizeField
        label={m.fontSize}
        value={first.fontSize}
        min={MIN_FONT_SIZE}
        max={MAX_FONT_SIZE}
        locked={texts.every((x) => x.locked)}
        onChange={(v) => setTextStyle({ fontSize: v }, 'style:font-size')}
      />
      <IconButton
        size="icon-sm"
        label={m.bold}
        shortcut={`${modKeyLabel}+B`}
        active={bold}
        icon={<span className="font-sans text-[15px] font-bold leading-none">B</span>}
        onClick={toggleBold}
      />
      <ColorButton label={m.textColor} variant="text" value={first.color} onChange={(c) => c && setTextStyle({ color: c }, 'style:text-color')} />
      <ToolbarSeparator className="max-sm:hidden" />
      <Segmented
        size="sm"
        label={m.textAlignment}
        className="max-sm:hidden"
        value={first.align}
        onValueChange={(align) => setTextStyle({ align })}
        options={alignOptions(t, dir)}
      />
      <SpacingButton text={first} />
    </>
  )
}

// --- marks -------------------------------------------------------------------

export function MarkControls({ marks }: { marks: MarkElement[] }) {
  const t = useT()
  const m = t.elements.toolbar
  const first = marks[0]
  return (
    <>
      <Segmented size="sm" label={m.markShape} value={first.shape} onValueChange={setMarkShape} options={markOptions(t)} />
      <ColorButton label={m.markColor} value={first.color} onChange={(c) => c && setMarkColor(c)} />
      <SizeField label={m.markSize} value={round1(first.width)} min={6} max={96} locked={marks.every((x) => x.locked)} onChange={setMarkSize} />
    </>
  )
}

// --- shapes ------------------------------------------------------------------

export function ShapeControls({ shapes }: { shapes: ShapeElement[] }) {
  const t = useT()
  const m = t.elements.toolbar
  const first = shapes[0]
  const allLines = shapes.every((s) => s.shape === 'line')
  const filled = shapes.find((s) => s.shape !== 'line')
  const stroked = shapes.find((s) => s.strokeColor !== null)
  return (
    <>
      <ColorButton
        label={allLines ? m.lineColor : m.border}
        variant="stroke"
        value={stroked?.strokeColor ?? null}
        allowNone={!allLines}
        onChange={setShapeStroke}
      />
      {filled && <ColorButton label={m.fill} value={filled.fillColor} allowNone colors={FILL_COLORS} onChange={setShapeFill} />}
      {stroked && (
        <SizeField
          label={allLines ? m.lineWidth : m.borderWidth}
          value={stroked.strokeWidth}
          min={0.5}
          max={24}
          step={0.5}
          onChange={setShapeStrokeWidth}
        />
      )}
      <OpacityButton value={first.opacity} onChange={setShapeOpacity} />
    </>
  )
}

export function InkControls({ inks }: { inks: InkElement[] }) {
  const t = useT()
  const m = t.elements.toolbar
  const first = inks[0]
  return (
    <>
      <ColorButton label={m.penColor} value={first.color} onChange={(c) => c && setInkColor(c)} />
      <SizeField label={m.penWidth} value={first.strokeWidth} min={0.5} max={24} step={0.5} locked={inks.every((k) => k.locked)} onChange={setInkWidth} />
    </>
  )
}

export function ImageControls({ images }: { images: ImageElement[] }) {
  return <OpacityButton value={images[0].opacity} onChange={setImageOpacity} />
}

// --- always ------------------------------------------------------------------

/** The actions, kept in view when the style controls scroll (narrow screens): Edit text comes first. */
export function CommonActions({ selected }: { selected: Element[] }) {
  const t = useT()
  const a = t.elements.actions
  const editingId = useEditor((s) => s.editingId)
  const menu = useTapMenu()
  const side = usePopoverSide()
  const allLocked = selected.every((e) => e.locked)
  const lockLabel = allLocked ? a.unlock : a.lock
  const text = selected.length === 1 && selected[0].kind === 'text' && selected[0].id !== editingId ? selected[0] : null
  return (
    <>
      {text && <IconButton size="icon-sm" label={a.editText} shortcut="Enter" icon={<PencilLine />} onClick={() => editText(text.id)} />}
      <IconButton size="icon-sm" className="max-sm:hidden" label={a.duplicate} shortcut={`${modKeyLabel}+D`} icon={<Copy />} onClick={duplicateSelection} />
      <IconButton
        size="icon-sm"
        className="max-sm:hidden"
        label={lockLabel}
        shortcut={`${modKeyLabel}+Shift+L`}
        icon={allLocked ? <Lock /> : <LockOpen />}
        active={allLocked}
        onClick={toggleLockSelection}
      />
      <Menu {...menu.root}>
        <Tooltip content={a.more}>
          <MenuTrigger asChild {...menu.trigger}>
            <TriggerButton label={a.moreActions}>
              <Ellipsis className="size-4" />
            </TriggerButton>
          </MenuTrigger>
        </Tooltip>
        <MenuContent side={side} align="end" onCloseAutoFocus={preventFocusWhileEditing}>
          <MenuItem icon={<BringToFront />} shortcut={`${modKeyLabel}+]`} onSelect={() => reorderSelection('front')}>
            {a.bringToFront}
          </MenuItem>
          <MenuItem icon={<SendToBack />} shortcut={`${modKeyLabel}+[`} onSelect={() => reorderSelection('back')}>
            {a.sendToBack}
          </MenuItem>
          <MenuSeparator className="sm:hidden" />
          <MenuItem className="sm:hidden" icon={<Copy />} onSelect={duplicateSelection}>
            {a.duplicate}
          </MenuItem>
          <MenuItem className="sm:hidden" icon={allLocked ? <LockOpen /> : <Lock />} onSelect={toggleLockSelection}>
            {lockLabel}
          </MenuItem>
        </MenuContent>
      </Menu>
      <IconButton
        size="icon-sm"
        label={allLocked ? a.lockedCantDelete : a.delete}
        shortcut={allLocked ? undefined : 'Del'}
        icon={<Trash />}
        disabled={allLocked}
        onClick={deleteSelection}
        className="hover:bg-danger-soft hover:text-danger"
      />
    </>
  )
}
