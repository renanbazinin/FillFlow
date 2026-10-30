import { useEffect } from 'react'
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
import { Menu, MenuContent, MenuItem, MenuLabel, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuTrigger, Popover, PopoverContent, PopoverTrigger } from '../../../components/ui/menu'
import { Tooltip } from '../../../components/ui/tooltip'
import { HIGHLIGHT_COLOR, INK_COLORS, MAX_FONT_SIZE, MIN_FONT_SIZE } from '../../../model/elements'
import { cssFontFamily, FONT_IDS, FONTS, loadFont } from '../../../model/fonts'
import type { Element, FontId, ImageElement, InkElement, MarkElement, MarkShape, ShapeElement, TextAlign, TextElement } from '../../../model/types'
import { useEditor } from '../../../store/editor'
import { modKeyLabel } from '../../../lib/utils/misc'
import { MarkGlyph } from '../render/ElementContent'
import { deleteSelection, duplicateSelection, reorderSelection, toggleLockSelection } from '../state/commands'
import { editText } from '../state/textEdit'
import { preventFocusWhileEditing } from './focus'
import { ColorButton, OpacityButton, SizeField, SliderRow, ToolbarSeparator, TriggerButton } from './parts'
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

const ALIGN_OPTIONS: SegmentedOption<TextAlign>[] = [
  { value: 'left', label: <TextAlignStart />, ariaLabel: 'Align left' },
  { value: 'center', label: <TextAlignCenter />, ariaLabel: 'Align center' },
  { value: 'right', label: <TextAlignEnd />, ariaLabel: 'Align right' },
]

const FONT_OPTIONS: SegmentedOption<FontId>[] = FONT_IDS.map((id) => ({
  value: id,
  label: <span style={{ fontFamily: cssFontFamily(id) }}>{FONTS[id].label}</span>,
  ariaLabel: `${FONTS[id].label} font`,
}))

const MARK_OPTIONS: SegmentedOption<MarkShape>[] = (['check', 'cross', 'dot'] as const).map((shape) => ({
  value: shape,
  label: <MarkGlyph shape={shape} color="currentColor" className="block size-4" />,
  ariaLabel: shape === 'check' ? 'Checkmark' : shape === 'cross' ? 'Cross' : 'Dot',
}))

const FILL_COLORS = [...INK_COLORS, HIGHLIGHT_COLOR] as const

const round1 = (n: number) => Math.round(n * 10) / 10

// --- text --------------------------------------------------------------------

function FontPicker({ value }: { value: FontId }) {
  useEffect(() => {
    // Labels are drawn in the fonts themselves.
    for (const id of FONT_IDS) void loadFont(id, false)
  }, [])
  return (
    <>
      <Segmented size="sm" className="max-sm:hidden" value={value} onValueChange={(fontId) => setTextStyle({ fontId })} options={FONT_OPTIONS} />
      <Menu>
        <Tooltip content="Font">
          <MenuTrigger asChild>
            <TriggerButton label={`Font: ${FONTS[value].label}`} className="px-2 text-[13px] font-medium text-fg sm:hidden">
              <span style={{ fontFamily: cssFontFamily(value) }}>{FONTS[value].label}</span>
            </TriggerButton>
          </MenuTrigger>
        </Tooltip>
        <MenuContent align="start" className="min-w-40" onCloseAutoFocus={preventFocusWhileEditing}>
          <MenuLabel>Font</MenuLabel>
          <MenuRadioGroup value={value} onValueChange={(v) => setTextStyle({ fontId: v as FontId })}>
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
  return (
    <Popover>
      <Tooltip content="Alignment & spacing">
        <PopoverTrigger asChild>
          <TriggerButton label="Alignment and spacing">
            <SlidersHorizontal className="size-4" />
          </TriggerButton>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent side="bottom" align="end" className="grid w-64 gap-4" onOpenAutoFocus={preventFocusWhileEditing} onCloseAutoFocus={preventFocusWhileEditing}>
        <div className="grid gap-2 sm:hidden">
          <span className="text-[13px] font-medium text-fg-muted">Alignment</span>
          <Segmented size="sm" className="w-full [&>*]:flex-1" value={text.align} onValueChange={(align) => setTextStyle({ align })} options={ALIGN_OPTIONS} />
        </div>
        <SliderRow
          label="Letter spacing"
          value={text.letterSpacing}
          display={`${round1(text.letterSpacing)} pt`}
          onChange={(v) => setTextStyle({ letterSpacing: v }, 'style:letter-spacing')}
          min={0}
          max={20}
          step={0.5}
        />
        <SliderRow
          label="Line height"
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
  const first = texts[0]
  const editingId = useEditor((s) => s.editingId)
  const bold = texts.every((t) => t.bold)
  return (
    <>
      <FontPicker value={first.fontId} />
      <SizeField label="Font size" value={first.fontSize} min={MIN_FONT_SIZE} max={MAX_FONT_SIZE} onChange={(v) => setTextStyle({ fontSize: v }, 'style:font-size')} />
      <IconButton
        size="icon-sm"
        label="Bold"
        shortcut={`${modKeyLabel}+B`}
        active={bold}
        icon={<span className="font-sans text-[15px] font-bold leading-none">B</span>}
        onClick={toggleBold}
      />
      <ColorButton label="Text color" variant="text" value={first.color} onChange={(c) => c && setTextStyle({ color: c }, 'style:text-color')} />
      <ToolbarSeparator className="max-sm:hidden" />
      <Segmented size="sm" className="max-sm:hidden" value={first.align} onValueChange={(align) => setTextStyle({ align })} options={ALIGN_OPTIONS} />
      <SpacingButton text={first} />
      {texts.length === 1 && editingId !== first.id && (
        <IconButton size="icon-sm" className="pointer-fine:hidden" label="Edit text" icon={<PencilLine />} onClick={() => editText(first.id)} />
      )}
    </>
  )
}

// --- marks -------------------------------------------------------------------

export function MarkControls({ marks }: { marks: MarkElement[] }) {
  const first = marks[0]
  return (
    <>
      <Segmented size="sm" value={first.shape} onValueChange={setMarkShape} options={MARK_OPTIONS} />
      <ColorButton label="Color" value={first.color} onChange={(c) => c && setMarkColor(c)} />
      <SizeField label="Size" value={round1(first.width)} min={6} max={96} onChange={setMarkSize} />
    </>
  )
}

// --- shapes ------------------------------------------------------------------

export function ShapeControls({ shapes }: { shapes: ShapeElement[] }) {
  const first = shapes[0]
  const allLines = shapes.every((s) => s.shape === 'line')
  const filled = shapes.find((s) => s.shape !== 'line')
  const stroked = shapes.find((s) => s.strokeColor !== null)
  return (
    <>
      <ColorButton
        label={allLines ? 'Line color' : 'Border'}
        variant="stroke"
        value={stroked?.strokeColor ?? null}
        allowNone={!allLines}
        onChange={setShapeStroke}
      />
      {filled && <ColorButton label="Fill" value={filled.fillColor} allowNone colors={FILL_COLORS} onChange={setShapeFill} />}
      {stroked && (
        <SizeField
          label={allLines ? 'Line width' : 'Border width'}
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
  const first = inks[0]
  return (
    <>
      <ColorButton label="Pen color" value={first.color} onChange={(c) => c && setInkColor(c)} />
      <SizeField label="Pen width" value={first.strokeWidth} min={0.5} max={24} step={0.5} onChange={setInkWidth} />
    </>
  )
}

export function ImageControls({ images }: { images: ImageElement[] }) {
  return <OpacityButton value={images[0].opacity} onChange={setImageOpacity} />
}

// --- always ------------------------------------------------------------------

export function CommonActions({ selected }: { selected: Element[] }) {
  const allLocked = selected.every((e) => e.locked)
  const lockLabel = allLocked ? 'Unlock' : 'Lock'
  return (
    <>
      <IconButton size="icon-sm" className="max-sm:hidden" label="Duplicate" shortcut={`${modKeyLabel}+D`} icon={<Copy />} onClick={duplicateSelection} />
      <IconButton
        size="icon-sm"
        className="max-sm:hidden"
        label={lockLabel}
        shortcut={`${modKeyLabel}+Shift+L`}
        icon={allLocked ? <Lock /> : <LockOpen />}
        active={allLocked}
        onClick={toggleLockSelection}
      />
      <Menu>
        <Tooltip content="More">
          <MenuTrigger asChild>
            <TriggerButton label="More actions">
              <Ellipsis className="size-4" />
            </TriggerButton>
          </MenuTrigger>
        </Tooltip>
        <MenuContent align="end" onCloseAutoFocus={preventFocusWhileEditing}>
          <MenuItem icon={<BringToFront />} shortcut={`${modKeyLabel}+]`} onSelect={() => reorderSelection('front')}>
            Bring to front
          </MenuItem>
          <MenuItem icon={<SendToBack />} shortcut={`${modKeyLabel}+[`} onSelect={() => reorderSelection('back')}>
            Send to back
          </MenuItem>
          <MenuSeparator className="sm:hidden" />
          <MenuItem className="sm:hidden" icon={<Copy />} onSelect={duplicateSelection}>
            Duplicate
          </MenuItem>
          <MenuItem className="sm:hidden" icon={allLocked ? <LockOpen /> : <Lock />} onSelect={toggleLockSelection}>
            {lockLabel}
          </MenuItem>
        </MenuContent>
      </Menu>
      <IconButton
        size="icon-sm"
        label={allLocked ? 'Locked items can’t be deleted' : 'Delete'}
        shortcut={allLocked ? undefined : 'Del'}
        icon={<Trash />}
        disabled={allLocked}
        onClick={deleteSelection}
        className="hover:bg-danger-soft hover:text-danger"
      />
    </>
  )
}
