/**
 * Generates the small PDFs used by the end-to-end tests (e2e/fixtures/):
 *
 *  - rotated.pdf      4 pages with /Rotate 0, 90, 180, 270 and offset crop boxes; every label is
 *                     drawn upright *as displayed*, with target marks at known view positions.
 *  - long.pdf         60 numbered pages (virtualization, thumbnails, navigation).
 *  - mixed-sizes.pdf  A4 portrait, US Letter portrait, A4 landscape.
 *  - form-basic.pdf   a handful of AcroForm fields, including one meant for Hebrew input.
 *  - password.pdf     encrypted (RC4, 40-bit) with the user password `fillflow`, one field.
 *
 * Deterministic output. Run: `node scripts/generate-fixtures.mjs`.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRawStream,
  PDFStream,
  PDFString,
  PageSizes,
  StandardFonts,
  TextAlignment,
  degrees,
  rgb,
} from 'pdf-lib'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(ROOT, 'e2e', 'fixtures')
const FIXED_DATE = new Date('2026-01-15T09:00:00Z')

const INK = rgb(0.06, 0.09, 0.16)
const MUTED = rgb(0.39, 0.45, 0.55)
const LINE = rgb(0.8, 0.84, 0.88)
const ACCENT = rgb(0.12, 0.25, 0.69)

/**
 * Rotation / crop box of each page of rotated.pdf (MediaBox is US Letter). Exported so the
 * e2e specs and this generator agree; view-space sizes follow from it.
 */
export const ROTATED_PAGES = [
  { rotate: 0, crop: [36, 48, 576, 744] },
  { rotate: 90, crop: [24, 60, 560, 760] },
  { rotate: 180, crop: [50, 30, 590, 730] },
  { rotate: 270, crop: [40, 40, 540, 700] },
]

/** View-space points (y down, rotation applied) marked with a crosshair on every rotated page. */
export const ROTATED_TARGETS = [
  { name: 'A', x: 72, y: 180 },
  { name: 'B', x: 260, y: 420 },
]

async function newDoc(title) {
  const doc = await PDFDocument.create({ updateMetadata: false })
  doc.setTitle(title)
  doc.setCreator('FillFlow fixture generator')
  doc.setProducer('pdf-lib')
  doc.setCreationDate(FIXED_DATE)
  doc.setModificationDate(FIXED_DATE)
  return doc
}

/** Same math as src/lib/pdf/geometry.ts viewToPdfPoint (userUnit 1). */
function viewToPdf(rotate, [x0, y0, x1, y1], vx, vy) {
  switch (rotate) {
    case 90:
      return { x: x0 + vy, y: y0 + vx }
    case 180:
      return { x: x1 - vx, y: y0 + vy }
    case 270:
      return { x: x1 - vy, y: y1 - vx }
    default:
      return { x: x0 + vx, y: y1 - vy }
  }
}

function viewSize(rotate, [x0, y0, x1, y1]) {
  const w = x1 - x0
  const h = y1 - y0
  return rotate % 180 === 0 ? { width: w, height: h } : { width: h, height: w }
}

async function rotatedPdf() {
  const doc = await newDoc('Rotated pages')
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  for (const [i, { rotate, crop }] of ROTATED_PAGES.entries()) {
    const page = doc.addPage(PageSizes.Letter)
    page.setCropBox(crop[0], crop[1], crop[2] - crop[0], crop[3] - crop[1])
    page.setRotation(degrees(rotate))
    const { width, height } = viewSize(rotate, crop)
    const at = (vx, vy) => viewToPdf(rotate, crop, vx, vy)
    // Text upright in view space: rotate the glyphs with the page.
    const text = (str, vx, vy, size, f = font, color = INK) => page.drawText(str, { ...at(vx, vy), size, font: f, color, rotate: degrees(rotate) })
    const line = (ax, ay, bx, by, color = LINE, thickness = 1) => page.drawLine({ start: at(ax, ay), end: at(bx, by), thickness, color })

    // Frame just inside the visible area.
    line(12, 12, width - 12, 12)
    line(width - 12, 12, width - 12, height - 12)
    line(width - 12, height - 12, 12, height - 12)
    line(12, height - 12, 12, 12)

    text(`Page ${i + 1} of ${ROTATED_PAGES.length}`, 36, 60, 22, bold)
    text(`/Rotate ${rotate}  ·  CropBox [${crop.join(' ')}]  ·  view ${width} × ${height} pt`, 36, 84, 10, font, MUTED)
    text('This corner is the top-left of the page as displayed.', 36, 104, 10, font, MUTED)
    for (const t of ROTATED_TARGETS) {
      line(t.x - 8, t.y, t.x + 8, t.y, ACCENT, 0.8)
      line(t.x, t.y - 8, t.x, t.y + 8, ACCENT, 0.8)
      text(`${t.name} (${t.x}, ${t.y})`, t.x + 6, t.y - 6, 7, font, ACCENT)
    }
    // An arrow pointing "up" in view space, so a wrong rotation is obvious at a glance.
    line(width - 60, 150, width - 60, 70, INK, 2)
    line(width - 60, 70, width - 70, 84, INK, 2)
    line(width - 60, 70, width - 50, 84, INK, 2)
    text('up', width - 68, 166, 10, bold)
  }
  return doc.save()
}

async function longPdf() {
  const doc = await newDoc('Sixty pages')
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const total = 60
  for (let n = 1; n <= total; n++) {
    const page = doc.addPage(PageSizes.Letter)
    const { width, height } = page.getSize()
    const big = String(n)
    page.drawText(big, { x: (width - bold.widthOfTextAtSize(big, 160)) / 2, y: height / 2 - 50, size: 160, font: bold, color: LINE })
    const label = `Page ${n} of ${total}`
    page.drawText(label, { x: (width - font.widthOfTextAtSize(label, 12)) / 2, y: 40, size: 12, font, color: MUTED })
    page.drawText(`Long document fixture · section ${Math.ceil(n / 10)}`, { x: 54, y: height - 60, size: 14, font: bold, color: INK })
  }
  return doc.save()
}

async function mixedSizesPdf() {
  const doc = await newDoc('Mixed page sizes')
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const [a4w, a4h] = PageSizes.A4
  const pages = [
    { name: 'A4 portrait', size: [a4w, a4h] },
    { name: 'US Letter portrait', size: PageSizes.Letter },
    { name: 'A4 landscape', size: [a4h, a4w] },
  ]
  for (const [i, { name, size }] of pages.entries()) {
    const page = doc.addPage(size)
    const [w, h] = size
    page.drawRectangle({ x: 18, y: 18, width: w - 36, height: h - 36, borderColor: LINE, borderWidth: 1 })
    page.drawText(`Page ${i + 1}: ${name}`, { x: 54, y: h - 72, size: 22, font: bold, color: INK })
    page.drawText(`${Math.round(w * 100) / 100} × ${Math.round(h * 100) / 100} pt`, { x: 54, y: h - 96, size: 11, font, color: MUTED })
  }
  return doc.save()
}

async function formBasicPdf() {
  const doc = await newDoc('Basic form')
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const page = doc.addPage(PageSizes.Letter)
  const { height } = page.getSize()
  const form = doc.getForm()
  const tooltip = (field, text) => {
    const tu = PDFHexString.fromText(text)
    field.acroField.dict.set(PDFName.of('TU'), tu)
    for (const w of field.acroField.getWidgets()) w.dict.set(PDFName.of('TU'), tu)
  }
  const label = (str, y) => page.drawText(str, { x: 72, y, size: 11, font, color: MUTED })
  const box = { textColor: INK, backgroundColor: rgb(0.97, 0.98, 0.99), borderColor: LINE, borderWidth: 1 }

  page.drawText('Basic form', { x: 72, y: height - 80, size: 24, font: bold, color: INK })

  label('Name', height - 130)
  const name = form.createTextField('Name')
  name.addToPage(page, { x: 72, y: height - 166, width: 300, height: 26, ...box })
  name.setFontSize(12)
  tooltip(name, 'Name')

  // For typing Hebrew (right-aligned): its value needs a Unicode font on export.
  label('Name in Hebrew (right-aligned)', height - 196)
  const hebrewName = form.createTextField('Hebrew name')
  hebrewName.addToPage(page, { x: 72, y: height - 232, width: 300, height: 26, ...box })
  hebrewName.setFontSize(12)
  hebrewName.setAlignment(TextAlignment.Right)
  tooltip(hebrewName, 'Name in Hebrew')

  label('Favorite color', height - 262)
  const color = form.createDropdown('Color')
  color.addOptions(['Red', 'Green', 'Blue'])
  color.addToPage(page, { x: 72, y: height - 298, width: 200, height: 26, ...box })
  color.setFontSize(12)
  tooltip(color, 'Favorite color')

  const subscribe = form.createCheckBox('Subscribe')
  subscribe.addToPage(page, { x: 72, y: height - 334, width: 14, height: 14, ...box, textColor: ACCENT })
  tooltip(subscribe, 'Subscribe to the newsletter')
  page.drawText('Subscribe to the newsletter', { x: 94, y: height - 331, size: 11, font, color: INK })

  label('Notes', height - 364)
  const notes = form.createTextField('Notes')
  notes.enableMultiline()
  notes.addToPage(page, { x: 72, y: height - 440, width: 420, height: 66, ...box })
  notes.setFontSize(11)
  tooltip(notes, 'Notes')

  return doc.save()
}

// ---------------------------------------------------------------------------
// password.pdf — pdf-lib can't encrypt, so this applies the PDF Standard security handler
// (revision 2: RC4 with a 40-bit key, PDF 32000-1 §7.6.3) to every string and stream.
// ---------------------------------------------------------------------------

export const FIXTURE_PASSWORD = 'fillflow'

const PASSWORD_PAD = Buffer.from('28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A', 'hex')

function rc4(key, data) {
  const s = Uint8Array.from({ length: 256 }, (_, i) => i)
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 255
    ;[s[i], s[j]] = [s[j], s[i]]
  }
  const out = new Uint8Array(data.length)
  for (let n = 0, i = 0, j = 0; n < data.length; n++) {
    i = (i + 1) & 255
    j = (j + s[i]) & 255
    ;[s[i], s[j]] = [s[j], s[i]]
    out[n] = data[n] ^ s[(s[i] + s[j]) & 255]
  }
  return out
}

const md5 = (...parts) => parts.reduce((h, part) => h.update(part), createHash('md5')).digest()
const padded = (password) => Buffer.concat([Buffer.from(password, 'latin1'), PASSWORD_PAD]).subarray(0, 32)
const hex = (bytes) => Buffer.from(bytes).toString('hex')

/** Encrypts strings and streams in place, recursing through direct dictionaries and arrays. */
function encryptValue(value, key) {
  if (value instanceof PDFString || value instanceof PDFHexString) return PDFHexString.of(hex(rc4(key, value.asBytes())))
  if (value instanceof PDFDict) {
    for (const [name, item] of value.entries()) value.set(name, encryptValue(item, key))
    return value
  }
  if (value instanceof PDFArray) {
    for (let i = 0; i < value.size(); i++) value.set(i, encryptValue(value.get(i), key))
    return value
  }
  if (value instanceof PDFStream) return PDFRawStream.of(encryptValue(value.dict, key), rc4(key, value.getContents()))
  return value
}

async function encryptDocument(doc, userPassword, ownerPassword) {
  const permissions = -4 // everything allowed
  const p = Buffer.alloc(4)
  p.writeInt32LE(permissions)
  const id = md5(Buffer.from('fillflow-fixture:password.pdf'))
  const o = rc4(md5(padded(ownerPassword)).subarray(0, 5), padded(userPassword))
  const key = md5(padded(userPassword), o, p, id).subarray(0, 5)
  const u = rc4(key, PASSWORD_PAD)

  const ctx = doc.context
  for (const [ref, object] of ctx.enumerateIndirectObjects()) {
    const n = ref.objectNumber
    const g = ref.generationNumber
    const objectKey = md5(key, Buffer.from([n & 255, (n >> 8) & 255, (n >> 16) & 255, g & 255, (g >> 8) & 255])).subarray(0, 10)
    ctx.assign(ref, encryptValue(object, objectKey))
  }
  ctx.trailerInfo.Encrypt = ctx.register(
    ctx.obj({ Filter: 'Standard', V: 1, R: 2, Length: 40, O: PDFHexString.of(hex(o)), U: PDFHexString.of(hex(u)), P: permissions }),
  )
  ctx.trailerInfo.ID = ctx.obj([PDFHexString.of(hex(id)), PDFHexString.of(hex(id))])
  // Nothing may be generated after encryption: no object streams, no new appearances.
  return doc.save({ useObjectStreams: false, updateFieldAppearances: false })
}

async function passwordPdf() {
  const doc = await newDoc('Password-protected')
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const page = doc.addPage(PageSizes.Letter)
  const { height } = page.getSize()
  page.drawText('Confidential', { x: 72, y: height - 90, size: 26, font: bold, color: INK })
  page.drawText(`Opens with the password "${FIXTURE_PASSWORD}".`, { x: 72, y: height - 116, size: 12, font, color: MUTED })
  page.drawText('Name', { x: 72, y: height - 160, size: 11, font, color: MUTED })
  const form = doc.getForm()
  const name = form.createTextField('Name')
  name.addToPage(page, { x: 72, y: height - 196, width: 300, height: 26, textColor: INK, backgroundColor: rgb(0.97, 0.98, 0.99), borderColor: LINE, borderWidth: 1 })
  name.setFontSize(12)
  form.updateFieldAppearances(font)
  return encryptDocument(doc, FIXTURE_PASSWORD, `owner-${FIXTURE_PASSWORD}`)
}

const FIXTURES = {
  'rotated.pdf': rotatedPdf,
  'long.pdf': longPdf,
  'mixed-sizes.pdf': mixedSizesPdf,
  'form-basic.pdf': formBasicPdf,
  'password.pdf': passwordPdf,
}

// Run when executed directly (`node scripts/…`), not when imported.
const isMain = !!process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()
if (isMain) {
  mkdirSync(OUT_DIR, { recursive: true })
  for (const [file, build] of Object.entries(FIXTURES)) {
    const bytes = await build()
    writeFileSync(join(OUT_DIR, file), bytes)
    console.log(`Wrote ${relative(ROOT, join(OUT_DIR, file))} (${(bytes.length / 1024).toFixed(1)} KB)`)
  }
}
