/**
 * Core document model.
 *
 * COORDINATES — every position in this file is in *page view space*:
 *   - units are PDF points (1/72 in) at zoom 1,
 *   - the page's /Rotate is already applied (what the user sees),
 *   - origin is the top-left corner of the visible (crop) box, y grows downward.
 * On screen, multiply by `scale` (CSS px per point). On export, `lib/pdf/geometry.ts`
 * converts view space into PDF user space.
 */

export interface Point {
  x: number
  y: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export type PageRotation = 0 | 90 | 180 | 270

/** Geometry of one PDF page. */
export interface PageInfo {
  /** 0-based page index. */
  index: number
  /** View-space size in points (rotation applied). */
  width: number
  height: number
  /** Effective page rotation, clockwise. */
  rotation: PageRotation
  /** pdf.js `page.view`: the visible (crop) box in PDF user space as [x0, y0, x1, y1]. */
  view: [number, number, number, number]
  /** PDF /UserUnit (almost always 1). */
  userUnit: number
}

// ---------------------------------------------------------------------------
// Elements: things the user places on top of the PDF.
// ---------------------------------------------------------------------------

export type FontId = 'sans' | 'serif' | 'mono'
export type TextAlign = 'left' | 'center' | 'right'
export type MarkShape = 'check' | 'cross' | 'dot'
export type ShapeType = 'rect' | 'ellipse' | 'line'
export type ImageRole = 'signature' | 'initials' | 'image'

interface ElementBase {
  id: string
  /** 0-based page index. */
  page: number
  /** Bounding box in view space (points). */
  x: number
  y: number
  width: number
  height: number
  /** Locked elements can't be moved/resized/deleted until unlocked. */
  locked?: boolean
}

/**
 * A block of text. Lines break only at explicit newlines (no soft wrap), and the
 * box is always sized to the text: width = widest line, height = lines * lineHeight * fontSize.
 * Use `lib/text/layout.ts` to (re)compute width/height after any text/style change.
 */
export interface TextElement extends ElementBase {
  kind: 'text'
  text: string
  fontId: FontId
  bold: boolean
  /** Font size in points. */
  fontSize: number
  /** CSS hex color, `#rrggbb`. */
  color: string
  align: TextAlign
  /** Line height as a multiple of fontSize (default 1.2). */
  lineHeight: number
  /** Extra space after every character in points (for boxed/comb fields). Default 0. */
  letterSpacing: number
}

/** A vector mark (✓ ✗ •) drawn from `MARK_PATHS` in `model/elements.ts`. Always square. */
export interface MarkElement extends ElementBase {
  kind: 'mark'
  shape: MarkShape
  color: string
}

/** A raster image: drawn signature, typed signature, initials or an uploaded picture. */
export interface ImageElement extends ElementBase {
  kind: 'image'
  role: ImageRole
  /** Key into `EditorState.assets`. */
  assetId: string
  /** 0..1 */
  opacity: number
}

/**
 * Rendering convention (screen and export MUST both follow it):
 *  - rect / ellipse: the stroke is centered on a path inset by half its width from the element
 *    box, so the whole stroke stays inside the box; fill covers that inset path. A stroke wider
 *    than half the box's smaller side is drawn at min(strokeWidth, width/2, height/2), so the
 *    shape shows solid inside its box.
 *  - line: from (x, y) to (x + width, y + height), or from (x, y + height) to (x + width, y)
 *    when `flip`; not inset; round line caps. width/height may be 0 for straight lines.
 *  - A "highlight" (fillColor === HIGHLIGHT_COLOR and strokeColor === null) is painted with a
 *    multiply blend (CSS mix-blend-mode: multiply / PDF BlendMode.Multiply) so text shows through.
 */
export interface ShapeElement extends ElementBase {
  kind: 'shape'
  shape: ShapeType
  /** null = no stroke. */
  strokeColor: string | null
  /** null = no fill. Ignored for lines. */
  fillColor: string | null
  /** Stroke width in points. */
  strokeWidth: number
  /** 0..1, applied to the whole shape (highlight preset uses 0.35). */
  opacity: number
  /** Lines only: false = top-left → bottom-right of the box, true = bottom-left → top-right. */
  flip?: boolean
}

/**
 * Freehand pen drawing. Rendering convention (screen and export): each stroke is drawn as
 * straight segments through its points (simplify/smooth points when the stroke is created,
 * not at render time), with round caps and round joins; a single-point stroke is a dot.
 */
export interface InkElement extends ElementBase {
  kind: 'ink'
  /**
   * Each stroke is a flat [x0, y0, x1, y1, ...] list of coordinates normalized to 0..1
   * relative to the element box, so resizing the box scales the drawing.
   */
  strokes: number[][]
  color: string
  /** Stroke width in points (does not scale with the box). */
  strokeWidth: number
}

export type Element = TextElement | MarkElement | ImageElement | ShapeElement | InkElement
export type ElementKind = Element['kind']

/** Distributive Partial so `updateElement(id, { text })` type-checks for any element kind. */
export type ElementPatch = Partial<Omit<TextElement, 'kind' | 'id'>> &
  Partial<Omit<MarkElement, 'kind' | 'id'>> &
  Partial<Omit<ImageElement, 'kind' | 'id'>> &
  Partial<Omit<ShapeElement, 'kind' | 'id'>> &
  Partial<Omit<InkElement, 'kind' | 'id'>>

/** Binary payload for image elements. Stored once and referenced by id (keeps undo history cheap). */
export interface Asset {
  id: string
  mime: 'image/png' | 'image/jpeg'
  /** `data:` URL of the image. */
  dataUrl: string
  /** Intrinsic pixel size. */
  width: number
  height: number
}

// ---------------------------------------------------------------------------
// AcroForm fields that already exist inside the PDF.
// ---------------------------------------------------------------------------

export type FormFieldType = 'text' | 'checkbox' | 'radio' | 'dropdown' | 'listbox' | 'signature' | 'button'

export interface FormWidget {
  /** pdf.js annotation id (unique per widget). */
  id: string
  page: number
  /** Widget rectangle in view space. */
  rect: Rect
  /** Checkbox / radio: the export value that this widget represents when "on". */
  exportValue?: string
  /**
   * Radio buttons that repeat another button's export value but are a separate choice: the
   * PDF's export value, shown to the user. `exportValue` then holds a key that is unique in the
   * group ("Yes#2"), so the form value says which button is on.
   */
  label?: string
}

export interface FormFieldOption {
  value: string
  label: string
}

export interface FormField {
  /** Fully-qualified field name (unique key). */
  name: string
  type: FormFieldType
  /** One or more visual widgets. Radio groups have one widget per option. */
  widgets: FormWidget[]
  /** Human-friendly name (/TU) when the PDF provides one. */
  label?: string
  readOnly: boolean
  required: boolean
  /** The value stored in the PDF when it was opened. */
  defaultValue: FormValue
  // Text fields
  multiline?: boolean
  maxLength?: number
  comb?: boolean
  password?: boolean
  textAlign?: TextAlign
  /** Font size from the field's default appearance; 0 = auto. */
  fontSize?: number
  // Choice fields
  options?: FormFieldOption[]
  /** Combo box that also accepts free text. */
  editable?: boolean
  multiSelect?: boolean
}

/** text/dropdown/radio → string, checkbox → boolean, listbox → string[] */
export type FormValue = string | boolean | string[]
export type FormValues = Record<string, FormValue>

// ---------------------------------------------------------------------------
// Tools and style defaults.
// ---------------------------------------------------------------------------

export type ToolId =
  | 'select'
  | 'hand'
  | 'text'
  | 'date'
  | 'check'
  | 'cross'
  | 'dot'
  | 'signature'
  | 'initials'
  | 'image'
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'highlight'
  | 'whiteout'
  | 'ink'

export type DateFormat = 'dd/MM/yyyy' | 'MM/dd/yyyy' | 'yyyy-MM-dd' | 'd MMM yyyy' | 'MMMM d, yyyy' | 'dd.MM.yyyy'

/** Styles applied to newly created elements; the context toolbar also updates these. */
export interface StyleDefaults {
  text: { fontId: FontId; fontSize: number; color: string; bold: boolean }
  mark: { color: string; size: number }
  shape: { strokeColor: string; fillColor: string | null; strokeWidth: number }
  ink: { color: string; strokeWidth: number }
  dateFormat: DateFormat
}

/** What gets persisted per document (keyed by the SHA-256 of the original file). */
export interface DocumentSession {
  version: 1
  docId: string
  fileName: string
  elements: Element[]
  formValues: FormValues
  assets: Record<string, Asset>
  updatedAt: number
}
