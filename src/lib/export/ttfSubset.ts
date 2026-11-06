/**
 * Minimal TrueType (glyf) subsetter for PDF embedding.
 *
 * Why not fontkit's subsetter (what pdf-lib's `subset: true` uses)? It writes table offsets
 * that ignore the 4-byte padding it inserts after odd-length tables, so with fonts like Arimo
 * (7-byte `prep`) every glyph after the first few decodes as garbage and text silently
 * disappears in viewers.
 *
 * Output keeps exactly the tables a PDF CIDFontType2 program needs (head, hhea, maxp, loca,
 * glyf, hmtx, cvt, fpgm, prep) plus OS/2 and a version-3 post table. Glyphs are renumbered in
 * the order given (new id = index); composite glyph components are appended and remapped.
 */

interface TableRecord {
  offset: number
  length: number
}

export interface TrueTypeSubset {
  data: Uint8Array
  /** Original glyph id of every glyph in the subset (index = new glyph id). */
  glyphIds: number[]
}

/**
 * A glyph made for the subset: glyph `id` drawn moved by (dx, dy) font units (a composite glyph
 * referencing it, or a plain copy when it isn't moved), or no outline at all when `id` is null.
 * `advance` is its advance width.
 */
export interface PlacedGlyph {
  id: number | null
  dx: number
  dy: number
  advance: number
}

const ARG_1_AND_2_ARE_WORDS = 0x0001
const ARGS_ARE_XY_VALUES = 0x0002
const WE_HAVE_A_SCALE = 0x0008
const MORE_COMPONENTS = 0x0020
const WE_HAVE_AN_X_AND_Y_SCALE = 0x0040
const WE_HAVE_A_TWO_BY_TWO = 0x0080

function readTables(view: DataView): Map<string, TableRecord> {
  const tables = new Map<string, TableRecord>()
  const count = view.getUint16(4)
  for (let i = 0; i < count; i++) {
    const p = 12 + i * 16
    const tag = String.fromCharCode(view.getUint8(p), view.getUint8(p + 1), view.getUint8(p + 2), view.getUint8(p + 3))
    tables.set(tag, { offset: view.getUint32(p + 8), length: view.getUint32(p + 12) })
  }
  return tables
}

/**
 * @param font TrueType font file (glyf outlines).
 * @param glyphIds original glyph ids (or glyphs made for the subset) in the desired order; index 0
 *   should be 0 (.notdef).
 */
export function subsetTrueType(font: Uint8Array, glyphIds: (number | PlacedGlyph)[]): TrueTypeSubset {
  const view = new DataView(font.buffer, font.byteOffset, font.byteLength)
  const tables = readTables(view)
  const need = (tag: string) => {
    const t = tables.get(tag)
    if (!t) throw new Error(`Font has no ${tag} table`)
    return t
  }
  const head = need('head')
  const maxp = need('maxp')
  const hhea = need('hhea')
  const hmtx = need('hmtx')
  const loca = need('loca')
  const glyf = need('glyf')

  const numGlyphs = view.getUint16(maxp.offset + 4)
  const longLoca = view.getInt16(head.offset + 50) === 1
  const numHMetrics = view.getUint16(hhea.offset + 34)

  const locaAt = (gid: number) =>
    longLoca ? view.getUint32(loca.offset + gid * 4) : view.getUint16(loca.offset + gid * 2) * 2
  const glyphData = (gid: number): Uint8Array => {
    if (gid < 0 || gid >= numGlyphs) return new Uint8Array(0)
    const start = locaAt(gid)
    const end = locaAt(gid + 1)
    if (end <= start) return new Uint8Array(0)
    return font.subarray(glyf.offset + start, glyf.offset + end)
  }
  const metrics = (gid: number): [number, number] => {
    if (gid < numHMetrics) return [view.getUint16(hmtx.offset + gid * 4), view.getInt16(hmtx.offset + gid * 4 + 2)]
    const advance = view.getUint16(hmtx.offset + (numHMetrics - 1) * 4)
    const lsb = view.getInt16(hmtx.offset + numHMetrics * 4 + (gid - numHMetrics) * 2)
    return [advance, lsb]
  }

  // Assign new ids, pulling in composite components as they are discovered.
  const wanted = glyphIds.length && glyphIds[0] === 0 ? glyphIds : [0, ...glyphIds.filter((g) => g !== 0)]
  const placed = new Map<number, PlacedGlyph>()
  const order = wanted.map((g, i) => {
    if (typeof g === 'number') return g
    placed.set(i, g)
    return g.id ?? 0
  })
  const newId = new Map<number, number>()
  order.forEach((g, i) => {
    if (!placed.has(i) && !newId.has(g)) newId.set(g, i)
  })
  const subsetId = (gid: number) => {
    let mapped = newId.get(gid)
    if (mapped === undefined) {
      mapped = order.length
      order.push(gid)
      newId.set(gid, mapped)
    }
    return mapped
  }
  const isComposite = (data: Uint8Array) => data.length >= 10 && ((data[0] << 8) | data[1]) & 0x8000
  const glyphs: Uint8Array[] = []
  let moved = false
  let movedComposite = false
  for (let i = 0; i < order.length; i++) {
    const at = placed.get(i)
    const src = at?.id === null ? new Uint8Array(0) : glyphData(order[i])
    if (at && (at.dx || at.dy) && src.length >= 10) {
      moved = true
      movedComposite ||= !!isComposite(src)
      glyphs.push(movedGlyph(src, subsetId(order[i]), at.dx, at.dy))
    } else if (isComposite(src)) {
      // Composite glyph: copy and remap component glyph indices.
      const data = src.slice()
      const dv = new DataView(data.buffer)
      let p = 10
      for (;;) {
        if (p + 4 > data.length) break
        const flags = dv.getUint16(p)
        const mapped = subsetId(dv.getUint16(p + 2))
        dv.setUint16(p + 2, mapped)
        p += 4 + (flags & ARG_1_AND_2_ARE_WORDS ? 4 : 2)
        if (flags & WE_HAVE_A_SCALE) p += 2
        else if (flags & WE_HAVE_AN_X_AND_Y_SCALE) p += 4
        else if (flags & WE_HAVE_A_TWO_BY_TWO) p += 8
        if (!(flags & MORE_COMPONENTS)) break
      }
      glyphs.push(data)
    } else {
      glyphs.push(src)
    }
  }

  const n = order.length
  // glyf + loca (long offsets, glyphs padded to 4 bytes)
  let glyfSize = 0
  for (const g of glyphs) glyfSize += pad4(g.length)
  const glyfOut = new Uint8Array(glyfSize)
  const locaOut = new DataView(new ArrayBuffer((n + 1) * 4))
  let offset = 0
  glyphs.forEach((g, i) => {
    locaOut.setUint32(i * 4, offset)
    glyfOut.set(g, offset)
    offset += pad4(g.length)
  })
  locaOut.setUint32(n * 4, offset)

  const hheaOut = font.slice(hhea.offset, hhea.offset + hhea.length)
  const hheaView = new DataView(hheaOut.buffer)
  hheaView.setUint16(34, n)

  const hmtxOut = new DataView(new ArrayBuffer(n * 4))
  order.forEach((g, i) => {
    let [advance, lsb] = metrics(g)
    const at = placed.get(i)
    if (at) {
      // A placed glyph's metrics are its own; the font's horizontal header has to cover them.
      advance = Math.min(0xffff, Math.max(0, Math.round(at.advance)))
      hheaView.setUint16(10, Math.max(hheaView.getUint16(10), advance))
      const box = glyphs[i].length >= 10 ? new DataView(glyphs[i].buffer, glyphs[i].byteOffset, 10) : null
      lsb = box?.getInt16(2) ?? 0
      if (box) {
        const xMax = box.getInt16(6)
        hheaView.setInt16(12, Math.min(hheaView.getInt16(12), lsb))
        hheaView.setInt16(14, Math.min(hheaView.getInt16(14), advance - xMax))
        hheaView.setInt16(16, Math.max(hheaView.getInt16(16), xMax))
      }
    }
    hmtxOut.setUint16(i * 4, advance)
    hmtxOut.setInt16(i * 4 + 2, lsb)
  })

  const headOut = font.slice(head.offset, head.offset + head.length)
  const headView = new DataView(headOut.buffer)
  headView.setUint32(8, 0) // checkSumAdjustment, fixed below
  headView.setInt16(50, 1) // indexToLocFormat: long

  const maxpOut = font.slice(maxp.offset, maxp.offset + maxp.length)
  const maxpView = new DataView(maxpOut.buffer)
  maxpView.setUint16(4, n)
  if (moved && maxp.length >= 32) {
    // Moved glyphs are composites one level above their component.
    const atLeast = (at: number, value: number) => maxpView.setUint16(at, Math.max(maxpView.getUint16(at), value))
    atLeast(10, maxpView.getUint16(6)) // maxCompositePoints ≥ maxPoints
    atLeast(12, maxpView.getUint16(8)) // maxCompositeContours ≥ maxContours
    atLeast(28, 1) // maxComponentElements
    atLeast(30, movedComposite ? maxpView.getUint16(30) + 1 : 1) // maxComponentDepth
  }

  const out: [string, Uint8Array][] = [
    ['head', headOut],
    ['hhea', hheaOut],
    ['maxp', maxpOut],
    ['loca', new Uint8Array(locaOut.buffer)],
    ['glyf', glyfOut],
    ['hmtx', new Uint8Array(hmtxOut.buffer)],
  ]
  for (const tag of ['cvt ', 'fpgm', 'prep', 'OS/2']) {
    const t = tables.get(tag)
    if (t) out.push([tag, font.slice(t.offset, t.offset + t.length)])
  }
  const post = tables.get('post')
  if (post && post.length >= 32) {
    const p = font.slice(post.offset, post.offset + 32)
    new DataView(p.buffer).setUint32(0, 0x00030000) // no glyph names
    out.push(['post', p])
  }

  const data = assemble(out)
  const adjustment = (0xb1b0afba - checksum(data)) >>> 0
  const headPos = tableOffset(data, 'head')
  new DataView(data.buffer).setUint32(headPos + 8, adjustment)
  return { data, glyphIds: order }
}

/** A composite glyph drawing glyph `component` of the subset (outline `src`) moved by (dx, dy). */
function movedGlyph(src: Uint8Array, component: number, dx: number, dy: number): Uint8Array {
  const from = new DataView(src.buffer, src.byteOffset, 10)
  const data = new Uint8Array(18)
  const dv = new DataView(data.buffer)
  dv.setInt16(0, -1) // numberOfContours: composite
  dv.setInt16(2, from.getInt16(2) + dx)
  dv.setInt16(4, from.getInt16(4) + dy)
  dv.setInt16(6, from.getInt16(6) + dx)
  dv.setInt16(8, from.getInt16(8) + dy)
  dv.setUint16(10, ARG_1_AND_2_ARE_WORDS | ARGS_ARE_XY_VALUES)
  dv.setUint16(12, component)
  dv.setInt16(14, dx)
  dv.setInt16(16, dy)
  return data
}

function pad4(n: number): number {
  return (n + 3) & ~3
}

function checksum(bytes: Uint8Array): number {
  let sum = 0
  const full = bytes.length & ~3
  for (let i = 0; i < full; i += 4) sum = (sum + ((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3])) >>> 0
  if (full < bytes.length) {
    let last = 0
    for (let i = full; i < full + 4; i++) last = (last << 8) | (i < bytes.length ? bytes[i] : 0)
    sum = (sum + (last >>> 0)) >>> 0
  }
  return sum
}

function assemble(entries: [string, Uint8Array][]): Uint8Array {
  entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  const count = entries.length
  const headerSize = 12 + count * 16
  let size = headerSize
  for (const [, t] of entries) size += pad4(t.length)
  const data = new Uint8Array(size)
  const view = new DataView(data.buffer)
  const pow = 2 ** Math.floor(Math.log2(count))
  view.setUint32(0, 0x00010000)
  view.setUint16(4, count)
  view.setUint16(6, pow * 16)
  view.setUint16(8, Math.log2(pow))
  view.setUint16(10, count * 16 - pow * 16)
  let offset = headerSize
  entries.forEach(([tag, table], i) => {
    const p = 12 + i * 16
    for (let k = 0; k < 4; k++) view.setUint8(p + k, tag.charCodeAt(k))
    view.setUint32(p + 4, checksum(table))
    view.setUint32(p + 8, offset)
    view.setUint32(p + 12, table.length)
    data.set(table, offset)
    offset += pad4(table.length)
  })
  return data
}

function tableOffset(data: Uint8Array, tag: string): number {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const count = view.getUint16(4)
  for (let i = 0; i < count; i++) {
    const p = 12 + i * 16
    if (String.fromCharCode(data[p], data[p + 1], data[p + 2], data[p + 3]) === tag) return view.getUint32(p + 8)
  }
  throw new Error(`missing ${tag}`)
}
