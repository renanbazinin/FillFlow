import type { PDFDocument, PDFName, PDFPage, PDFRef } from 'pdf-lib'

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

/** Resource names for one page, created on demand and reused for repeated objects. */
export class PageResources {
  private readonly page: PDFPage
  private readonly states: DocGraphicsStates
  private readonly fonts = new Map<PDFRef, PDFName>()
  private readonly xobjects = new Map<PDFRef, PDFName>()
  private readonly gstates = new Map<string, PDFName>()

  constructor(page: PDFPage, states: DocGraphicsStates) {
    this.page = page
    this.states = states
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
