import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  PDFString,
  StandardFonts,
  degrees,
  type PDFObject,
} from 'pdf-lib'

/** Test-only builders for PDFs with awkward geometry, dirty content and encryption. */

export interface PageSpec {
  size: [number, number]
  rotate?: 0 | 90 | 180 | 270
  /** Crop box [x, y, width, height]. */
  crop?: [number, number, number, number]
  userUnit?: number
  /** Raw content-stream source drawn as the page's own (original) content. */
  content?: string
}

export interface BuildOptions {
  title?: string
  author?: string
  /** Adds a text field "name" and a checkbox "agree" on the first page. */
  form?: boolean
}

/** Builds a PDF whose page content is raw operators (font /F1 = Helvetica is available). */
export async function buildPdf(pages: PageSpec[], opts: BuildOptions = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  if (opts.title) doc.setTitle(opts.title)
  if (opts.author) doc.setAuthor(opts.author)
  const helv = await doc.embedFont(StandardFonts.Helvetica)
  for (const spec of pages) {
    const page = doc.addPage(spec.size)
    if (spec.crop) page.setCropBox(...spec.crop)
    if (spec.rotate) page.setRotation(degrees(spec.rotate))
    if (spec.userUnit) page.node.set(PDFName.of('UserUnit'), PDFNumber.of(spec.userUnit))
    const resources = doc.context.obj({ Font: { F1: helv.ref } })
    page.node.set(PDFName.of('Resources'), resources)
    const stream = doc.context.flateStream(spec.content ?? '')
    page.node.set(PDFName.of('Contents'), doc.context.register(stream))
  }
  if (opts.form) {
    const form = doc.getForm()
    const page = doc.getPage(0)
    const name = form.createTextField('name')
    name.addToPage(page, { x: 60, y: 600, width: 200, height: 24, font: helv })
    const agree = form.createCheckBox('agree')
    agree.addToPage(page, { x: 60, y: 560, width: 16, height: 16 })
  }
  return doc.save({ useObjectStreams: false })
}

// ---------------------------------------------------------------------------
// RC4-128 (Standard security handler, V2 / R3) — enough to produce files real viewers open.
// ---------------------------------------------------------------------------

const PAD = new Uint8Array([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08, 0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68,
  0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
])

type Md5 = (data: Uint8Array) => Uint8Array

async function loadMd5(): Promise<Md5> {
  // Resolved at runtime so the app's type-check doesn't need Node typings.
  const crypto = await import(/* @vite-ignore */ `node:${'crypto'}`)
  return (data) => new Uint8Array(crypto.createHash('md5').update(data).digest())
}

function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
  const s = new Uint8Array(256)
  for (let i = 0; i < 256; i++) s[i] = i
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 255
    ;[s[i], s[j]] = [s[j], s[i]]
  }
  const out = new Uint8Array(data.length)
  for (let k = 0, i = 0, j = 0; k < data.length; k++) {
    i = (i + 1) & 255
    j = (j + s[i]) & 255
    ;[s[i], s[j]] = [s[j], s[i]]
    out[k] = data[k] ^ s[(s[i] + s[j]) & 255]
  }
  return out
}

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

const padPassword = (pw: string) => concat(new TextEncoder().encode(pw), PAD).slice(0, 32)
const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')

/**
 * Encrypts a PDF (written without object streams) with RC4-128. An empty user password gives
 * the common "secured" file that opens without a prompt but can't be modified by pdf-lib.
 */
export async function encryptPdf(bytes: Uint8Array, passwords: { user?: string; owner: string }): Promise<Uint8Array> {
  const md5 = await loadMd5()
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const ctx = doc.context
  const P = -3904
  const id = md5(new TextEncoder().encode(`fillflow-${bytes.length}`))

  // O (algorithm 3)
  let h = md5(padPassword(passwords.owner))
  for (let i = 0; i < 50; i++) h = md5(h)
  const ownerKey = h.slice(0, 16)
  let O = rc4(ownerKey, padPassword(passwords.user ?? ''))
  for (let i = 1; i <= 19; i++) O = rc4(ownerKey.map((b) => b ^ i), O)

  // File key (algorithm 2)
  const p = new Uint8Array(4)
  new DataView(p.buffer).setInt32(0, P, true)
  h = md5(concat(padPassword(passwords.user ?? ''), O, p, id))
  for (let i = 0; i < 50; i++) h = md5(h.slice(0, 16))
  const key = h.slice(0, 16)

  // U (algorithm 5)
  let U = rc4(key, md5(concat(PAD, id)))
  for (let i = 1; i <= 19; i++) U = rc4(key.map((b) => b ^ i), U)
  U = concat(U, new Uint8Array(16))

  const objectKey = (ref: PDFRef) => {
    const n = ref.objectNumber
    const g = ref.generationNumber
    return md5(concat(key, new Uint8Array([n & 255, (n >> 8) & 255, (n >> 16) & 255, g & 255, (g >> 8) & 255]))).slice(0, 16)
  }

  const encryptValue = (obj: PDFObject, k: Uint8Array): PDFObject => {
    if (obj instanceof PDFString || obj instanceof PDFHexString) return PDFHexString.of(toHex(rc4(k, obj.asBytes())))
    if (obj instanceof PDFArray) {
      obj.asArray().forEach((v, i) => obj.set(i, encryptValue(v, k)))
      return obj
    }
    if (obj instanceof PDFDict) {
      for (const [name, v] of obj.entries()) obj.set(name, encryptValue(v, k))
      return obj
    }
    return obj
  }

  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    const k = objectKey(ref)
    if (obj instanceof PDFStream) {
      encryptValue(obj.dict, k)
      ctx.assign(ref, PDFRawStream.of(obj.dict, rc4(k, obj.getContents())))
    } else {
      ctx.assign(ref, encryptValue(obj, k))
    }
  }

  const encryptRef = ctx.register(
    ctx.obj({ Filter: 'Standard', V: 2, R: 3, Length: 128, P, O: PDFHexString.of(toHex(O)), U: PDFHexString.of(toHex(U)) }),
  )
  ctx.trailerInfo.Encrypt = encryptRef
  ctx.trailerInfo.ID = ctx.obj([PDFHexString.of(toHex(id)), PDFHexString.of(toHex(id))])
  return doc.save({ useObjectStreams: false, updateFieldAppearances: false })
}

/** Reads a tiny 1×1 red PNG / a 2×1 JPEG etc. from base64 for image tests. */
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
