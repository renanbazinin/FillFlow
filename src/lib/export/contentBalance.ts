import {
  PDFArray,
  PDFContentStream,
  PDFOperator,
  PDFOperatorNames,
  PDFRawStream,
  PDFRef,
  decodePDFRawStream,
  type PDFDocument,
  type PDFPage,
} from 'pdf-lib'

/**
 * Original page content sometimes leaves the graphics state dirty: an unclosed `q` (with a
 * `cm` inside it), an unterminated text object, or a stray `Q` that would pop the q/Q pair
 * pdf-lib wraps existing content in. This module scans the original content streams, removes
 * stray `Q`s (viewers ignore them) and closes whatever is left open, so our overlay always
 * starts from the page's default state.
 */

export interface ContentScan {
  /** Net `q` nesting left open at the end (never negative). */
  depth: number
  /** Inside a BT…ET text object at the end. */
  inText: boolean
  /** True when a `Q` appeared with no matching `q`. */
  underflow: boolean
}

const WS = new Uint8Array(256)
for (const c of [0, 9, 10, 12, 13, 32]) WS[c] = 1
const DELIM = new Uint8Array(256)
for (const c of '()<>[]{}/%') DELIM[c.charCodeAt(0)] = 1

const C = {
  percent: 37,
  lparen: 40,
  rparen: 41,
  lt: 60,
  gt: 62,
  slash: 47,
  backslash: 92,
  lf: 10,
  cr: 13,
  E: 69,
  I: 73,
}

/**
 * Scans one decoded content stream, continuing from `state` (streams of a page concatenate).
 * The offsets of `Q`s with no matching `q` are added to `stray` when given.
 */
export function scanContentStream(
  bytes: Uint8Array,
  state: ContentScan = { depth: 0, inText: false, underflow: false },
  stray?: number[],
): ContentScan {
  let { depth, inText, underflow } = state
  const n = bytes.length
  let i = 0
  while (i < n) {
    const c = bytes[i]
    if (WS[c]) {
      i++
    } else if (c === C.percent) {
      while (i < n && bytes[i] !== C.lf && bytes[i] !== C.cr) i++
    } else if (c === C.lparen) {
      // Literal string with balanced parentheses and backslash escapes.
      let nest = 1
      i++
      while (i < n && nest > 0) {
        const s = bytes[i]
        if (s === C.backslash) i += 2
        else {
          if (s === C.lparen) nest++
          else if (s === C.rparen) nest--
          i++
        }
      }
    } else if (c === C.lt) {
      if (bytes[i + 1] === C.lt) i += 2
      else {
        while (i < n && bytes[i] !== C.gt) i++
        i++
      }
    } else if (c === C.slash) {
      i++
      while (i < n && !WS[bytes[i]] && !DELIM[bytes[i]]) i++
    } else if (DELIM[c]) {
      i++
    } else {
      const start = i
      while (i < n && !WS[bytes[i]] && !DELIM[bytes[i]]) i++
      const len = i - start
      if (len === 1 && c === 113 /* q */) depth++
      else if (len === 1 && c === 81 /* Q */) {
        if (depth > 0) depth--
        else {
          underflow = true
          stray?.push(start)
        }
      } else if (len === 2) {
        const c2 = bytes[start + 1]
        if (c === 66 /* B */ && c2 === 84 /* T */) inText = true
        else if (c === C.E && c2 === 84 /* T */) inText = false
        else if (c === C.I && c2 === 68 /* D */) i = skipInlineImage(bytes, i)
      }
    }
  }
  return { depth, inText, underflow }
}

/** Skips inline image data after an `ID` operator; returns the index after the closing `EI`. */
function skipInlineImage(bytes: Uint8Array, afterId: number): number {
  const n = bytes.length
  // A single white-space byte separates ID from the data.
  let i = afterId + 1
  while (i < n - 1) {
    if (bytes[i] === C.E && bytes[i + 1] === C.I && WS[bytes[i - 1]] && (i + 2 >= n || WS[bytes[i + 2]] || DELIM[bytes[i + 2]])) {
      return i + 2
    }
    i++
  }
  return n
}

function streamBytes(obj: unknown): Uint8Array | null {
  try {
    if (obj instanceof PDFRawStream) return decodePDFRawStream(obj).decode()
    if (obj instanceof PDFContentStream) return obj.getUnencodedContents()
  } catch (err) {
    console.warn('[export] could not decode a content stream', err)
  }
  return null
}

/**
 * Makes sure the page's ORIGINAL content can't leak graphics state into content appended
 * after it. Normalizes the page (pdf-lib then wraps the original streams in q…Q), removes `Q`s
 * that have no matching `q` (they would pop the wrapper's `q`) and, when the original streams
 * leave `q`s or a text object open, inserts a stream that closes them right before pdf-lib's
 * closing `Q`. Returns the scan result (null when there was nothing to scan).
 */
export function protectOriginalContent(pdfDoc: PDFDocument, page: PDFPage): ContentScan | null {
  const { context } = pdfDoc
  const node = page.node
  const pushRef = context.getPushGraphicsStateContentStream()
  const popRef = context.getPopGraphicsStateContentStream()
  node.normalize()
  const contents = node.Contents()
  if (!(contents instanceof PDFArray)) return null

  const refs = contents.asArray()
  const start = refs.findIndex((r) => r === pushRef)
  let end = -1
  for (let k = refs.length - 1; k > start; k--) {
    if (refs[k] === popRef) {
      end = k
      break
    }
  }
  if (start < 0 || end < 0) return null

  let scan: ContentScan = { depth: 0, inText: false, underflow: false }
  for (let k = start + 1; k < end; k++) {
    const ref = refs[k]
    const bytes = streamBytes(ref instanceof PDFRef ? context.lookup(ref) : ref)
    if (!bytes) continue
    const stray: number[] = []
    scan = scanContentStream(bytes, scan, stray)
    if (stray.length) {
      // Viewers ignore an unmatched Q, so blanking it out keeps the page as it was shown. The
      // stream may be shared with other pages: this page gets its own copy.
      const fixed = bytes.slice()
      for (const at of stray) fixed[at] = 0x20
      contents.set(k, context.register(context.flateStream(fixed)))
    }
  }
  if (scan.depth > 0 || scan.inText) {
    const ops: PDFOperator[] = []
    if (scan.inText) ops.push(PDFOperator.of(PDFOperatorNames.EndText))
    for (let k = 0; k < scan.depth; k++) ops.push(PDFOperator.of(PDFOperatorNames.PopGraphicsState))
    const fixRef = context.register(context.contentStream(ops))
    contents.insert(end, fixRef)
  }
  return scan
}
