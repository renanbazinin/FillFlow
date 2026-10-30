/**
 * Generates public/samples/sample-form.pdf — FillFlow's built-in sample document.
 *
 * A two-page "Membership application" for a fictional club:
 *  - page 1 has a real AcroForm with every field type FillFlow fills in place (text, multiline,
 *    comb, radio group, checkboxes, dropdown, multi-select list box, signature field),
 *  - page 2 is flat, printed content (lines, boxes, terms) — like a scanned paper form — to
 *    show off the free-form Text, Checkmark and Signature tools.
 *
 * Output is deterministic (fixed metadata dates, no random ids). Run: `npm run sample`.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PageSizes,
  StandardFonts,
  rgb,
  setCharacterSpacing,
} from 'pdf-lib'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'public', 'samples', 'sample-form.pdf')
const FIXED_DATE = new Date('2026-01-15T09:00:00Z')

const hex = (h) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255)

const C = {
  brand: hex('#1e40af'),
  brandSoft: hex('#c7d2fe'),
  brandMist: hex('#dbe4ff'),
  teal: hex('#14b8a6'),
  tealSoft: hex('#f0fdfa'),
  tealLine: hex('#99f6e4'),
  tealInk: hex('#115e59'),
  ink: hex('#0f172a'),
  text: hex('#334155'),
  label: hex('#475569'),
  muted: hex('#64748b'),
  subtle: hex('#94a3b8'),
  rule: hex('#e2e8f0'),
  fieldFill: hex('#f8fafc'),
  fieldBorder: hex('#cbd5e1'),
  control: hex('#94a3b8'),
  required: hex('#dc2626'),
  white: rgb(1, 1, 1),
}

const [PAGE_W, PAGE_H] = PageSizes.A4
const M = 48
const CW = PAGE_W - 2 * M
const GUTTER = 16
const COL = (CW - GUTTER) / 2

const ORG = 'Harborview Community Club'
const FOOTER = `${ORG}  ·  14 Quay Street, Harborview  ·  hello@harborview.example`

// ---------------------------------------------------------------------------
// A tiny drawing toolkit in *top-left* coordinates (y grows downward), like the app's view space.
// ---------------------------------------------------------------------------

function roundedRect(x, y, w, h, r) {
  if (!r) return `M${x},${y} H${x + w} V${y + h} H${x} Z`
  return (
    `M${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h - r} ` +
    `Q${x + w},${y + h} ${x + w - r},${y + h} H${x + r} Q${x},${y + h} ${x},${y + h - r} V${y + r} Q${x},${y} ${x + r},${y} Z`
  )
}

function canvas(page, fonts) {
  const H = page.getHeight()
  const c = {
    page,
    /** Draws a single line of text with its baseline at `baseline`; returns its advance width. */
    text(str, x, baseline, { size = 9.5, bold = false, color = C.text, tracking = 0, align = 'left' } = {}) {
      const font = bold ? fonts.bold : fonts.regular
      const width = font.widthOfTextAtSize(str, size) + tracking * str.length
      const left = align === 'right' ? x - width : align === 'center' ? x - width / 2 : x
      if (tracking) page.pushOperators(setCharacterSpacing(tracking))
      page.drawText(str, { x: left, y: H - baseline, size, font, color })
      if (tracking) page.pushOperators(setCharacterSpacing(0))
      return width
    },
    width(str, { size = 9.5, bold = false } = {}) {
      return (bold ? fonts.bold : fonts.regular).widthOfTextAtSize(str, size)
    },
    /** Word-wrapped paragraph; returns the baseline after the last line. */
    paragraph(str, x, baseline, maxWidth, { size = 9, leading = size * 1.5, ...opts } = {}) {
      const words = str.split(/\s+/)
      let line = ''
      let y = baseline
      for (const word of words) {
        const next = line ? `${line} ${word}` : word
        if (line && c.width(next, { size, bold: opts.bold }) > maxWidth) {
          c.text(line, x, y, { size, ...opts })
          y += leading
          line = word
        } else {
          line = next
        }
      }
      if (line) c.text(line, x, y, { size, ...opts })
      return y + leading
    },
    rect(x, top, w, h, { fill, stroke, strokeWidth = 0.75, radius = 0, dash } = {}) {
      page.drawSvgPath(roundedRect(x, top, w, h, radius), {
        x: 0,
        y: H,
        color: fill,
        borderColor: stroke,
        borderWidth: stroke ? strokeWidth : 0,
        borderDashArray: dash,
      })
    },
    line(x1, y1, x2, y2, { color = C.rule, width = 0.75, dash } = {}) {
      page.drawLine({ start: { x: x1, y: H - y1 }, end: { x: x2, y: H - y2 }, thickness: width, color, dashArray: dash })
    },
    circle(cx, cy, r, { fill, stroke, strokeWidth = 0.75 } = {}) {
      page.drawEllipse({ x: cx, y: H - cy, xScale: r, yScale: r, color: fill, borderColor: stroke, borderWidth: stroke ? strokeWidth : 0 })
    },
    path(d, opts) {
      page.drawSvgPath(d, { x: 0, y: H, ...opts })
    },
    /** PDF rect (bottom-left origin) of a top-left box. */
    pdfRect(x, top, w, h) {
      return { x, y: H - top - h, width: w, height: h }
    },
  }
  return c
}

// ---------------------------------------------------------------------------
// Building blocks.
// ---------------------------------------------------------------------------

/** Colored band with the club name, the page title and the club's emblem. Baselines are absolute. */
function header(c, { height, eyebrowAt, title, titleAt, titleSize, subtitle, subtitleAt, right }) {
  c.rect(0, 0, PAGE_W, height, { fill: C.brand })
  c.rect(0, height, PAGE_W, 3, { fill: C.teal })
  // Emblem: a rounded tile with the club's initial over a wave.
  const tile = 26
  const tx = PAGE_W - M - tile
  const ty = (height - tile) / 2
  c.rect(tx, ty, tile, tile, { fill: C.teal, radius: 7 })
  c.path(`M${tx + 6},${ty + 17.5} q3.5,-3 7,0 t7,0`, { borderColor: C.white, borderWidth: 1.6 })
  c.text('H', tx + tile / 2, ty + 13.5, { size: 11, bold: true, color: C.white, align: 'center' })

  c.text(ORG.toUpperCase(), M, eyebrowAt, { size: 7.5, bold: true, color: C.brandSoft, tracking: 1.4 })
  c.text(title, M, titleAt, { size: titleSize, bold: true, color: C.white })
  if (subtitle) c.text(subtitle, M, subtitleAt, { size: 9.5, color: C.brandMist })
  if (right) c.text(right, PAGE_W - M, subtitle ? subtitleAt : titleAt, { size: 8, color: C.brandSoft, align: 'right' })
}

function footer(c, pageNo, pageCount) {
  const y = PAGE_H - 34
  c.line(M, y - 12, PAGE_W - M, y - 12, { color: C.rule })
  c.text(FOOTER, M, y, { size: 7.5, color: C.muted })
  c.text(`Page ${pageNo} of ${pageCount}`, PAGE_W - M, y, { size: 7.5, color: C.muted, align: 'right' })
}

function section(c, n, title, baseline, note) {
  c.circle(M + 9, baseline - 4.6, 9, { fill: C.brand })
  c.text(String(n), M + 9, baseline - 1.2, { size: 9.5, bold: true, color: C.white, align: 'center' })
  c.text(title, M + 26, baseline, { size: 13, bold: true, color: C.ink })
  if (note) c.text(note, PAGE_W - M, baseline, { size: 8, color: C.muted, align: 'right' })
  c.line(M, baseline + 10, PAGE_W - M, baseline + 10, { color: C.rule })
}

function label(c, str, x, baseline, { required = false, hint } = {}) {
  let w = c.text(str, x, baseline, { size: 8.5, color: C.label })
  if (required) w += c.text(' *', x + w, baseline, { size: 8.5, bold: true, color: C.required })
  if (hint) c.text(hint, x + w + 5, baseline, { size: 7.5, color: C.subtle })
}

function fieldBox(c, x, top, w, h) {
  c.rect(x, top, w, h, { fill: C.fieldFill, stroke: C.fieldBorder, radius: 3 })
}

/**
 * Options for a transparent widget over a frame drawn on the page. An invisible border (width
 * `inset`, no color) gives the text the same inner padding in every viewer; pdf-lib grows the
 * widget by the border width, so the requested rect shrinks to keep the widget on the frame.
 */
function bare(rect, inset = 0) {
  return {
    x: rect.x + inset / 2,
    y: rect.y + inset / 2,
    width: rect.width - inset,
    height: rect.height - inset,
    textColor: C.ink,
    backgroundColor: undefined,
    borderColor: undefined,
    borderWidth: inset,
  }
}

/** Human-friendly field name (/TU), also on each widget (pdf.js reads it from the widget). */
function setTooltip(field, text) {
  const tu = PDFHexString.fromText(text)
  field.acroField.dict.set(PDFName.of('TU'), tu)
  for (const widget of field.acroField.getWidgets()) widget.dict.set(PDFName.of('TU'), tu)
}

function textField(form, c, name, { x, top, w, h = 24, tooltip, required, multiline, maxLength, comb, fontSize = 10.5 }) {
  const field = form.createTextField(name)
  if (maxLength) field.setMaxLength(maxLength)
  if (comb) field.enableCombing()
  if (multiline) field.enableMultiline()
  if (required) field.enableRequired()
  field.addToPage(c.page, bare(c.pdfRect(x, top, w, h), comb ? 0 : 4))
  field.setFontSize(fontSize)
  setTooltip(field, tooltip ?? name)
  return field
}

/**
 * pdf-lib names radio appearance states by option index ("0", "1", …) and adds an /Opt array.
 * Most real-world forms use the export value itself as the state name; do the same so every
 * reader sees "Individual" rather than "0".
 */
function useNamedRadioStates(group, names) {
  group.acroField.getWidgets().forEach((widget, i) => {
    const ap = widget.dict.lookup(PDFName.of('AP'), PDFDict)
    for (const kind of ['N', 'D']) {
      const states = ap.lookupMaybe(PDFName.of(kind), PDFDict)
      const on = states?.get(PDFName.of(String(i)))
      if (!states || !on) continue
      states.delete(PDFName.of(String(i)))
      states.set(PDFName.of(names[i]), on)
    }
  })
  group.acroField.dict.delete(PDFName.of('Opt'))
}

/** A /Sig field (pdf-lib can read but not create them). */
function signatureField(doc, form, c, name, { x, top, w, h, tooltip }) {
  const { x: llx, y: lly, width, height } = c.pdfRect(x, top, w, h)
  const dict = doc.context.obj({
    FT: 'Sig',
    T: PDFHexString.fromText(name),
    TU: PDFHexString.fromText(tooltip ?? name),
    Type: 'Annot',
    Subtype: 'Widget',
    Rect: [llx, lly, llx + width, lly + height],
    F: 4,
    P: c.page.ref,
  })
  const ref = doc.context.register(dict)
  c.page.node.addAnnot(ref)
  form.acroForm.addField(ref)
}

// ---------------------------------------------------------------------------
// Page 1 — the fillable form.
// ---------------------------------------------------------------------------

function drawPage1(doc, form, page, fonts) {
  const c = canvas(page, fonts)
  header(c, {
    height: 100,
    eyebrowAt: 34,
    title: 'Membership application',
    titleAt: 63,
    titleSize: 24,
    subtitle: 'Welcome aboard! This takes about five minutes. Fields marked * are required.',
    subtitleAt: 84,
    right: 'Form HC-1  ·  2026 season',
  })

  const right = M + COL + GUTTER

  // 1 — Personal details
  section(c, 1, 'Personal details', 136)
  let y = 168
  label(c, 'Full name', M, y, { required: true })
  label(c, 'Date of birth', right, y, { hint: 'DD/MM/YYYY' })
  fieldBox(c, M, y + 6, COL, 24)
  fieldBox(c, right, y + 6, COL, 24)
  textField(form, c, 'Full name', { x: M, top: y + 6, w: COL, required: true })
  textField(form, c, 'Date of birth', { x: right, top: y + 6, w: COL, tooltip: 'Date of birth (DD/MM/YYYY)' })

  y += 46
  label(c, 'Email', M, y, { required: true })
  label(c, 'Phone', right, y)
  fieldBox(c, M, y + 6, COL, 24)
  fieldBox(c, right, y + 6, COL, 24)
  textField(form, c, 'Email', { x: M, top: y + 6, w: COL, required: true, tooltip: 'Email address' })
  textField(form, c, 'Phone', { x: right, top: y + 6, w: COL, tooltip: 'Phone number' })

  y += 46
  label(c, 'Home address', M, y)
  fieldBox(c, M, y + 6, CW, 38)
  textField(form, c, 'Address', { x: M, top: y + 6, w: CW, h: 38, multiline: true, fontSize: 10, tooltip: 'Home address' })

  y += 62
  const cell = 21
  label(c, 'ID number', M, y, { hint: '9 digits, one per box' })
  fieldBox(c, M, y + 6, cell * 9, 24)
  for (let i = 1; i < 9; i++) c.line(M + i * cell, y + 6, M + i * cell, y + 30, { color: C.fieldBorder, width: 0.6 })
  textField(form, c, 'ID number', { x: M, top: y + 6, w: cell * 9, maxLength: 9, comb: true, fontSize: 12, tooltip: 'ID number (9 digits)' })
  c.paragraph(
    'We use your ID number only to confirm your age for discounted memberships.',
    M + cell * 9 + 16,
    y + 15,
    CW - cell * 9 - 16,
    { size: 8, leading: 11, color: C.muted },
  )

  // 2 — Membership
  section(c, 2, 'Membership', y + 64, 'Membership runs for 12 months')
  y += 90
  label(c, 'Membership type', M, y)
  const plans = [
    ['Individual', '$40 / year'],
    ['Family', '$95 / year, up to 5 people'],
    ['Student', '$20 / year, ID required'],
  ]
  const plan = form.createRadioGroup('Membership type')
  const planW = CW / 3
  plans.forEach(([name, price], i) => {
    const px = M + i * planW
    plan.addOptionToPage(name, page, {
      ...c.pdfRect(px, y + 9, 13, 13),
      textColor: C.brand,
      backgroundColor: C.white,
      borderColor: C.control,
      borderWidth: 1,
    })
    c.text(name, px + 20, y + 19.5, { size: 9.5, bold: true, color: C.ink })
    c.text(price, px + 20, y + 31, { size: 7.5, color: C.muted })
  })
  useNamedRadioStates(plan, plans.map(([name]) => name))
  setTooltip(plan, 'Membership type')

  y += 52
  label(c, 'I’m interested in', M, y, { hint: 'tick all that apply' })
  const interests = [
    ['Events', 'Community events'],
    ['Volunteering', 'Volunteering'],
    ['Workshops', 'Workshops & classes'],
    ['Newsletter', 'Monthly newsletter'],
  ]
  const interestW = CW / 4
  interests.forEach(([key, text], i) => {
    const ix = M + i * interestW
    const box = form.createCheckBox(`Interests.${key}`)
    box.addToPage(page, { ...c.pdfRect(ix, y + 9, 12, 12), textColor: C.brand, backgroundColor: C.white, borderColor: C.control, borderWidth: 1 })
    setTooltip(box, `Interested in: ${text}`)
    c.text(text, ix + 18, y + 18.5, { size: 9.5, color: C.ink })
  })

  y += 42
  label(c, 'Country', M, y)
  label(c, 'How did you hear about us?', right, y, { hint: 'choose any' })
  fieldBox(c, M, y + 6, COL, 24)
  c.path(`M${M + COL - 17},${y + 16} l4,4 l4,-4`, { borderColor: C.muted, borderWidth: 1.2 })
  const country = form.createDropdown('Country')
  country.addOptions([
    'Australia',
    'Canada',
    'France',
    'Germany',
    'Ireland',
    'Israel',
    'Netherlands',
    'New Zealand',
    'United Kingdom',
    'United States',
    'Other',
  ])
  country.addToPage(page, bare(c.pdfRect(M, y + 6, COL - 24, 24), 4))
  country.setFontSize(10.5)
  setTooltip(country, 'Country')
  c.text('Where you live now', M, y + 42, { size: 7.5, color: C.subtle })

  fieldBox(c, right, y + 6, COL, 64)
  const referral = form.createOptionList('Referral')
  referral.addOptions(['A friend or family member', 'Social media', 'Search engine', 'Local newspaper', 'A club event'])
  referral.enableMultiselect()
  referral.addToPage(page, bare(c.pdfRect(right + 4, y + 9, COL - 8, 58)))
  referral.setFontSize(9)
  setTooltip(referral, 'How did you hear about us?')

  y += 88
  label(c, 'Additional comments', M, y, { hint: 'optional' })
  fieldBox(c, M, y + 6, CW, 36)
  textField(form, c, 'Comments', { x: M, top: y + 6, w: CW, h: 36, multiline: true, fontSize: 10, tooltip: 'Additional comments' })

  // 3 — Signature
  section(c, 3, 'Signature', y + 76)
  y += 102
  c.text('I confirm the information above is correct and I agree to the club’s terms on page 2.', M, y, { size: 8.5, color: C.text })
  y += 20
  const sigW = CW - COL / 2 - GUTTER - 40
  const dateX = M + sigW + GUTTER
  label(c, 'Signature', M, y)
  label(c, 'Date', dateX, y)
  fieldBox(c, M, y + 6, sigW, 38)
  c.text('×', M + 10, y + 34, { size: 11, color: C.subtle })
  c.line(M + 22, y + 35, M + sigW - 12, y + 35, { color: C.fieldBorder, width: 0.6 })
  signatureField(doc, form, c, 'Signature', { x: M, top: y + 6, w: sigW, h: 38, tooltip: 'Signature' })
  fieldBox(c, dateX, y + 6, PAGE_W - M - dateX, 24)
  textField(form, c, 'Date', { x: dateX, top: y + 6, w: PAGE_W - M - dateX, tooltip: 'Date' })

  footer(c, 1, 2)
}

// ---------------------------------------------------------------------------
// Page 2 — flat, printed content (no fields).
// ---------------------------------------------------------------------------

function fillLine(c, text, x, baseline, end) {
  const w = c.text(text, x, baseline, { size: 9.5, color: C.label })
  c.line(x + w + 8, baseline + 3, end, baseline + 3, { color: C.subtle, width: 0.7 })
}

function yesNo(c, question, baseline) {
  c.text(question, M, baseline, { size: 9.5, color: C.ink })
  const x = PAGE_W - M - 112
  for (const [i, word] of ['Yes', 'No'].entries()) {
    const bx = x + i * 60
    c.rect(bx, baseline - 9.5, 11, 11, { fill: C.white, stroke: C.muted, strokeWidth: 0.9, radius: 1.5 })
    c.text(word, bx + 17, baseline, { size: 9.5, color: C.text })
  }
}

function drawPage2(page, fonts) {
  const c = canvas(page, fonts)
  header(c, {
    height: 76,
    eyebrowAt: 33,
    title: 'Membership application (continued)',
    titleAt: 57,
    titleSize: 17,
  })

  // A friendly nudge for first-time FillFlow users.
  const tipTop = 92
  c.rect(M, tipTop, CW, 44, { fill: C.tealSoft, stroke: C.tealLine, radius: 6 })
  c.text('Tip', M + 14, tipTop + 18, { size: 9, bold: true, color: C.tealInk })
  c.paragraph(
    'This page has no form fields, just like a scanned paper form. Click to type on the lines, tick the boxes with a checkmark, and add your signature at the bottom.',
    M + 38,
    tipTop + 18,
    CW - 52,
    { size: 8.5, leading: 12, color: C.tealInk },
  )

  // 4 — Emergency contact
  section(c, 4, 'Emergency contact', 172)
  fillLine(c, 'Full name', M, 206, PAGE_W - M)
  fillLine(c, 'Phone', M, 240, M + COL)
  fillLine(c, 'Relationship', M + COL + GUTTER, 240, PAGE_W - M)

  // 5 — Health & consent
  section(c, 5, 'Health & consent', 290)
  yesNo(c, 'Do you have any allergies or medical conditions we should know about?', 322)
  fillLine(c, 'If yes, please describe', M, 352, PAGE_W - M)
  yesNo(c, 'May we take photos of you at club events for our newsletter?', 384)
  yesNo(c, 'Would you like to hear about volunteering opportunities?', 412)

  // 6 — Terms
  section(c, 6, 'Terms & conditions', 462)
  let y = c.paragraph(
    'Membership runs for twelve months from the date your application is approved. Fees are non-refundable once your membership card has been issued. Members agree to follow the club’s code of conduct, to treat volunteers, staff and fellow members with respect, and to tell us when their contact details change.',
    M,
    490,
    CW,
    { size: 9, leading: 14, color: C.text },
  )
  y = c.paragraph(
    'We keep your details only to run your membership. We never sell or share them, and you can ask us to delete them at any time.',
    M,
    y + 4,
    CW,
    { size: 9, leading: 14, color: C.text },
  )

  const signTop = y + 34
  fillLine(c, 'Signature', M, signTop, M + CW * 0.62)
  fillLine(c, 'Date', M + CW * 0.62 + 24, signTop, PAGE_W - M)

  // Office use
  const boxTop = signTop + 40
  c.rect(M, boxTop, CW, 74, { fill: C.fieldFill, stroke: C.fieldBorder, radius: 6, dash: [3, 2.5] })
  c.text('FOR OFFICE USE ONLY', M + 14, boxTop + 20, { size: 7, bold: true, color: C.muted, tracking: 1 })
  const third = (CW - 28 - 2 * 18) / 3
  ;['Member no.', 'Approved by', 'Date'].forEach((t, i) => {
    const x = M + 14 + i * (third + 18)
    const w = c.text(t, x, boxTop + 50, { size: 8.5, color: C.muted })
    c.line(x + w + 6, boxTop + 53, x + third, boxTop + 53, { color: C.subtle, width: 0.6 })
  })

  footer(c, 2, 2)
}

// ---------------------------------------------------------------------------

export async function buildSamplePdf() {
  const doc = await PDFDocument.create({ updateMetadata: false })
  doc.setTitle('Membership application', { showInWindowTitleBar: true })
  doc.setAuthor(ORG)
  doc.setSubject('Sample form for FillFlow')
  doc.setKeywords(['sample', 'form', 'membership', 'FillFlow'])
  doc.setCreator('FillFlow sample generator')
  doc.setProducer('pdf-lib')
  doc.setLanguage('en-US')
  doc.setCreationDate(FIXED_DATE)
  doc.setModificationDate(FIXED_DATE)

  const fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  }
  const form = doc.getForm()
  const page1 = doc.addPage([PAGE_W, PAGE_H])
  const page2 = doc.addPage([PAGE_W, PAGE_H])
  drawPage1(doc, form, page1, fonts)
  drawPage2(page2, fonts)

  // Field appearances are drawn with the same Helvetica as the page text.
  form.updateFieldAppearances(fonts.regular)
  return doc.save()
}

// Run when executed directly (`node scripts/…`), not when imported.
const isMain = !!process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()
if (isMain) {
  const bytes = await buildSamplePdf()
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, bytes)
  console.log(`Wrote ${relative(ROOT, OUT)} (${(bytes.length / 1024).toFixed(1)} KB)`)
}
