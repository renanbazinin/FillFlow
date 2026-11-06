/**
 * The tools of the dock (model/tools.ts reads these): `label` names the tool, `hint` is the one line
 * of help in its tooltip and in the hint chip, `touchHint` the same on a touch screen.
 */
export const tools = {
  select: {
    label: 'Select',
    hint: 'Select, move and resize items',
    touchHint: 'Select, move and resize items',
  },
  hand: {
    label: 'Pan',
    hint: 'Drag to scroll the document (or hold Space)',
    touchHint: 'Drag to scroll the document (or hold Space)',
  },
  text: { label: 'Text', hint: 'Click anywhere to type', touchHint: 'Tap anywhere to type' },
  check: { label: 'Checkmark', hint: 'Click to add a ✓', touchHint: 'Tap to add a ✓' },
  cross: { label: 'Cross', hint: 'Click to add a ✗', touchHint: 'Tap to add a ✗' },
  dot: { label: 'Dot', hint: 'Click to add a •', touchHint: 'Tap to add a •' },
  date: { label: 'Date', hint: "Click to insert today's date", touchHint: "Tap to insert today's date" },
  signature: {
    label: 'Signature',
    hint: 'Draw, type or upload your signature',
    touchHint: 'Draw, type or upload your signature',
  },
  initials: { label: 'Initials', hint: 'Add your initials', touchHint: 'Add your initials' },
  image: { label: 'Image', hint: 'Insert a picture or stamp', touchHint: 'Insert a picture or stamp' },
  ink: { label: 'Draw', hint: 'Freehand pen', touchHint: 'Freehand pen' },
  highlight: { label: 'Highlight', hint: 'Drag over text to highlight it', touchHint: 'Drag over text to highlight it' },
  whiteout: { label: 'Whiteout', hint: 'Drag to cover content with white', touchHint: 'Drag to cover content with white' },
  rect: { label: 'Rectangle', hint: 'Drag to draw a box', touchHint: 'Drag to draw a box' },
  ellipse: { label: 'Ellipse', hint: 'Drag to circle something', touchHint: 'Drag to circle something' },
  line: {
    label: 'Line',
    hint: 'Drag to draw a line (Shift snaps to 45°)',
    touchHint: 'Drag to draw a line (Shift snaps to 45°)',
  },
}

export type ToolsMessages = typeof tools
