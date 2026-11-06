import {
  PDFArray,
  PDFBool,
  PDFContentStream,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNull,
  PDFNumber,
  PDFOperator,
  PDFOperatorNames,
  PDFRawStream,
  PDFRef,
  PDFString,
  beginMarkedContent,
  decodePDFRawStream,
  endMarkedContent,
  type PDFContext,
  type PDFDocument,
  type PDFObject,
  type PDFPage,
} from 'pdf-lib'

export interface GraphicsStateSpec {
  /** Fill alpha (ca). */
  fill?: number
  /** Stroke alpha (CA). */
  stroke?: number
  blend?: 'Multiply'
}

/** Registers each ExtGState once per document; pages reference the shared object. */
export class DocGraphicsStates {
  private readonly refs = new Map<string, PDFRef>()
  private readonly doc: PDFDocument

  constructor(doc: PDFDocument) {
    this.doc = doc
  }

  ref(spec: GraphicsStateSpec): { key: string; ref: PDFRef } {
    const key = `${spec.fill ?? 1}|${spec.stroke ?? 1}|${spec.blend ?? 'Normal'}`
    let ref = this.refs.get(key)
    if (!ref) {
      ref = this.doc.context.register(
        this.doc.context.obj({
          Type: 'ExtGState',
          ca: spec.fill ?? 1,
          CA: spec.stroke ?? 1,
          BM: spec.blend ?? 'Normal',
        }),
      )
      this.refs.set(key, ref)
    }
    return { key, ref }
  }
}

/** How assistive technology reads what one element draws, in a tagged PDF. */
export type ContentTag =
  /** Text, read as `text` (in logical order, whatever order its glyphs are drawn in). */
  | { role: 'Span'; text: string; lang?: string }
  /** A picture or a mark, read as `alt`. */
  | { role: 'Figure'; alt: string; lang?: string }
  /** Decoration, which it skips. */
  | { role: 'Artifact' }

/** Resource names for one page, created on demand and reused for repeated objects. */
export class PageResources {
  private readonly page: PDFPage
  private readonly states: DocGraphicsStates
  private readonly fonts = new Map<PDFRef, PDFName>()
  private readonly xobjects = new Map<PDFRef, PDFName>()
  private readonly gstates = new Map<string, PDFName>()
  /** The page's structure, once looked up (null: the document isn't tagged, or it can't be read). */
  private tags?: PageTags | null

  constructor(page: PDFPage, states: DocGraphicsStates) {
    this.page = page
    this.states = states
  }

  /**
   * `ops`, all that one element draws, made part of the page's logical structure when the
   * document is a tagged PDF, so screen readers read it instead of skipping it. Other documents
   * get `ops` as they are: tagging only what we add would hide the rest of the page.
   */
  tagged(tag: ContentTag, ops: PDFOperator[]): PDFOperator[] {
    if (!ops.length) return ops
    if (this.tags === undefined) this.tags = PageTags.open(this.page)
    return this.tags ? this.tags.wrap(tag, ops) : ops
  }

  font(ref: PDFRef): PDFName {
    let name = this.fonts.get(ref)
    if (!name) {
      name = this.page.node.newFontDictionary('FF', ref)
      this.fonts.set(ref, name)
    }
    return name
  }

  xObject(ref: PDFRef): PDFName {
    let name = this.xobjects.get(ref)
    if (!name) {
      name = this.page.node.newXObject('FX', ref)
      this.xobjects.set(ref, name)
    }
    return name
  }

  /** Name of an ExtGState, or null when the spec is the default state. */
  graphicsState(spec: GraphicsStateSpec): PDFName | null {
    if ((spec.fill ?? 1) >= 1 && (spec.stroke ?? 1) >= 1 && !spec.blend) return null
    const { key, ref } = this.states.ref(spec)
    let name = this.gstates.get(key)
    if (!name) {
      name = this.page.node.newExtGState('FG', ref)
      this.gstates.set(key, name)
    }
    return name
  }
}

const K = PDFName.of('K')
const PG = PDFName.of('Pg')
const PARENT_TREE = PDFName.of('ParentTree')
const PARENT_TREE_NEXT_KEY = PDFName.of('ParentTreeNextKey')
const STRUCT_PARENTS = PDFName.of('StructParents')
const STRUCT_TREE_ROOT = PDFName.of('StructTreeRoot')
const NUMS = PDFName.of('Nums')
const KIDS = PDFName.of('Kids')
const LIMITS = PDFName.of('Limits')

/**
 * The logical structure of one page of a tagged PDF (catalog /MarkInfo /Marked true and a
 * /StructTreeRoot), which tags the content we add to the page. Each text or figure becomes a
 * marked-content sequence with a fresh MCID and gets a structure element of its own, with its
 * text or description and its language, after the page's other elements in reading order;
 * decoration is marked as an artifact. When the structure can't be read, what we add stays
 * untagged and the document no longer claims to conform to PDF/UA.
 */
class PageTags {
  private readonly page: PDFPage
  /** The element new ones go under (the Document element), and its reference. */
  private readonly parent: PDFDict
  private readonly parentRef: PDFRef
  /** The page's entry in the parent tree: the structure element of each MCID. */
  private readonly mcids: PDFArray
  private next: number

  private constructor(page: PDFPage, parent: PDFDict, parentRef: PDFRef, mcids: PDFArray, next: number) {
    this.page = page
    this.parent = parent
    this.parentRef = parentRef
    this.mcids = mcids
    this.next = next
  }

  static open(page: PDFPage): PageTags | null {
    const { catalog, context } = page.doc
    const markInfo = catalog.lookup(PDFName.of('MarkInfo'))
    if (!(markInfo instanceof PDFDict) || markInfo.lookup(PDFName.of('Marked')) !== PDFBool.True || !catalog.has(STRUCT_TREE_ROOT)) return null
    try {
      const root = catalog.lookup(STRUCT_TREE_ROOT, PDFDict)
      const [parent, parentRef] = documentElement(context, root, catalog.get(STRUCT_TREE_ROOT))
      const highest = highestMcid(page)
      const found = root.lookup(PARENT_TREE)
      const tree = found instanceof PDFDict ? found : context.obj({ Nums: [] })
      if (tree !== found) root.set(PARENT_TREE, context.register(tree))
      const key = page.node.lookup(STRUCT_PARENTS)
      const entry = key instanceof PDFNumber ? numberTreeGet(tree, key.asNumber()) : undefined
      const mcids = entry instanceof PDFArray ? entry : addPageEntry(page, root, tree)
      return new PageTags(page, parent, parentRef, mcids, Math.max(mcids.size(), highest + 1))
    } catch (err) {
      console.warn('[export] could not tag the items added to a page of a tagged PDF', err)
      dropUaClaim(page.doc)
      return null
    }
  }

  wrap(tag: ContentTag, ops: PDFOperator[]): PDFOperator[] {
    if (tag.role === 'Artifact') return [beginMarkedContent('Artifact'), ...ops, endMarkedContent()]
    const { context } = this.page.doc
    const mcid = this.next++
    const lang = tag.lang ? { Lang: PDFString.of(tag.lang) } : {}
    // The text goes on the structure element only: as /ActualText of the marked content, PDFium,
    // poppler and xpdf would copy right-to-left text from it in reverse.
    const said = tag.role === 'Span' ? { ActualText: PDFHexString.fromText(tag.text) } : { Alt: PDFHexString.fromText(tag.alt) }
    const elem = context.register(
      context.obj({ Type: 'StructElem', S: tag.role, P: this.parentRef, Pg: this.page.ref, K: mcid, ...lang, ...said }),
    )
    while (this.mcids.size() < mcid) this.mcids.push(PDFNull)
    this.mcids.push(elem)
    this.insert(elem)
    // pdf-lib types operands without dictionaries, but writes them like any other object.
    const props = context.obj({ MCID: mcid, ...lang }) as unknown as PDFName
    return [PDFOperator.of(PDFOperatorNames.BeginMarkedContentSequence, [PDFName.of(tag.role), props]), ...ops, endMarkedContent()]
  }

  /** Adds `elem` to the parent's children after the last one on this page (else at the end). */
  private insert(elem: PDFRef): void {
    const found = this.parent.lookup(K)
    const only = this.parent.get(K)
    const kids = found instanceof PDFArray ? found : this.page.doc.context.obj(only ? [only] : [])
    if (kids !== found) this.parent.set(K, kids)
    let at = kids.size()
    for (let i = kids.size() - 1; i >= 0; i--) {
      const kid = kids.lookup(i)
      if (kid instanceof PDFDict && kid.get(PG) === this.page.ref) {
        at = i + 1
        break
      }
    }
    kids.insert(at, elem)
  }
}

/** Gives a page without structure yet the parent tree's next key, with an empty entry. */
function addPageEntry(page: PDFPage, root: PDFDict, tree: PDFDict): PDFArray {
  const { context } = page.doc
  const next = root.lookup(PARENT_TREE_NEXT_KEY)
  const key = Math.max(next instanceof PDFNumber ? next.asNumber() : 0, numberTreeMaxKey(tree) + 1)
  const mcids = context.obj([])
  numberTreeAppend(context, tree, key, context.register(mcids))
  page.node.set(STRUCT_PARENTS, PDFNumber.of(key))
  root.set(PARENT_TREE_NEXT_KEY, PDFNumber.of(key + 1))
  return mcids
}

/** Where new elements go: the Document element holding the whole tree, else the root itself. */
function documentElement(context: PDFContext, root: PDFDict, rootRef: PDFObject | undefined): [PDFDict, PDFRef] {
  const kids = root.lookup(K)
  const only = kids instanceof PDFArray ? (kids.size() === 1 ? kids.get(0) : undefined) : root.get(K)
  const elem = only instanceof PDFRef ? context.lookup(only) : undefined
  if (only instanceof PDFRef && elem instanceof PDFDict && standardType(root, elem) === 'Document') return [elem, only]
  if (rootRef instanceof PDFRef) return [root, rootRef]
  throw new Error('The structure tree root is not an indirect object')
}

/** The standard structure type of an element, through the tree's role map ("Workbook" → "Document"). */
function standardType(root: PDFDict, elem: PDFDict): string | undefined {
  const roles = root.lookup(PDFName.of('RoleMap'))
  let type = elem.lookup(PDFName.of('S'))
  for (let i = 0; i < 8 && type instanceof PDFName && roles instanceof PDFDict && roles.has(type); i++) type = roles.lookup(type)
  return type instanceof PDFName ? type.decodeText() : undefined
}

/** The highest MCID in the page's content (−1 for none), named property lists included. */
function highestMcid(page: PDFPage): number {
  const { context } = page.doc
  let max = -1
  const contents = page.node.Contents()
  const streams = contents instanceof PDFArray ? contents.asArray().map((ref) => context.lookup(ref)) : [contents]
  for (const stream of streams) {
    const bytes = stream instanceof PDFRawStream ? decodePDFRawStream(stream).decode() : stream instanceof PDFContentStream ? stream.getUnencodedContents() : null
    if (!bytes) continue
    for (const [, id] of new TextDecoder('latin1').decode(bytes).matchAll(/\/MCID\s+(\d+)/g)) max = Math.max(max, Number(id))
  }
  const properties = page.node.Resources()?.lookup(PDFName.of('Properties'))
  if (properties instanceof PDFDict) {
    for (const value of properties.values()) {
      const id = context.lookup(value)
      const mcid = id instanceof PDFDict ? id.lookup(PDFName.of('MCID')) : undefined
      if (mcid instanceof PDFNumber) max = Math.max(max, mcid.asNumber())
    }
  }
  return max
}

/** Value of `key` in a number tree (the parent tree), looked up. */
function numberTreeGet(node: PDFDict, key: number, depth = 0): PDFObject | undefined {
  if (depth > 32) return undefined
  const nums = node.lookup(NUMS)
  if (nums instanceof PDFArray) {
    for (let i = 0; i + 1 < nums.size(); i += 2) {
      const k = nums.lookup(i)
      if (k instanceof PDFNumber && k.asNumber() === key) return nums.lookup(i + 1)
    }
  }
  const kids = node.lookup(KIDS)
  if (!(kids instanceof PDFArray)) return undefined
  for (let i = 0; i < kids.size(); i++) {
    const kid = kids.lookup(i)
    if (!(kid instanceof PDFDict)) continue
    const limits = kid.lookup(LIMITS)
    const [low, high] = limits instanceof PDFArray ? [limits.lookup(0), limits.lookup(1)] : []
    if (low instanceof PDFNumber && high instanceof PDFNumber && (key < low.asNumber() || key > high.asNumber())) continue
    const value = numberTreeGet(kid, key, depth + 1)
    if (value !== undefined) return value
  }
  return undefined
}

/** The highest key of a number tree (−1 when empty). */
function numberTreeMaxKey(node: PDFDict, depth = 0): number {
  if (depth > 32) throw new Error('Number tree too deep')
  let max = -1
  const nums = node.lookup(NUMS)
  if (nums instanceof PDFArray) {
    for (let i = 0; i < nums.size(); i += 2) {
      const k = nums.lookup(i)
      if (k instanceof PDFNumber) max = Math.max(max, k.asNumber())
    }
  }
  const kids = node.lookup(KIDS)
  if (kids instanceof PDFArray) {
    for (let i = 0; i < kids.size(); i++) {
      const kid = kids.lookup(i)
      if (kid instanceof PDFDict) max = Math.max(max, numberTreeMaxKey(kid, depth + 1))
    }
  }
  return max
}

/** Adds `key` (higher than every key in the tree) at the end of a number tree. */
function numberTreeAppend(context: PDFContext, node: PDFDict, key: number, value: PDFObject, depth = 0): void {
  if (depth > 32) throw new Error('Number tree too deep')
  const kids = node.lookup(KIDS)
  const last = kids instanceof PDFArray && kids.size() ? kids.lookup(kids.size() - 1) : undefined
  if (last instanceof PDFDict) {
    numberTreeAppend(context, last, key, value, depth + 1)
    const limits = last.lookup(LIMITS)
    if (limits instanceof PDFArray && limits.size() === 2) limits.set(1, PDFNumber.of(key))
    return
  }
  const found = node.lookup(NUMS)
  const nums = found instanceof PDFArray ? found : context.obj([])
  if (nums !== found) node.set(NUMS, nums)
  nums.push(PDFNumber.of(key))
  nums.push(value)
}

/** Takes back the document's claim to conform to PDF/UA (in its XMP metadata), which no longer holds. */
function dropUaClaim(doc: PDFDocument): void {
  try {
    const ref = doc.catalog.get(PDFName.of('Metadata'))
    const stream = ref instanceof PDFRef ? doc.context.lookup(ref) : undefined
    if (!(ref instanceof PDFRef) || !(stream instanceof PDFRawStream)) return
    const xmp = new TextDecoder().decode(decodePDFRawStream(stream).decode())
    const without = xmp.replace(/\s*<pdfuaid:(\w+)>[^<]*<\/pdfuaid:\1>/g, '').replace(/\s+pdfuaid:\w+\s*=\s*("[^"]*"|'[^']*')/g, '')
    if (without !== xmp) doc.context.assign(ref, doc.context.stream(new TextEncoder().encode(without), { Type: 'Metadata', Subtype: 'XML' }))
  } catch (err) {
    console.warn('[export] could not update the XMP metadata', err)
  }
}
