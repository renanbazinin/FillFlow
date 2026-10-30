/**
 * Which annotations stay out of the page bitmap.
 *
 * Pages are rendered with `AnnotationMode.ENABLE_FORMS`, which already leaves most AcroForm widgets
 * to the forms layer. But widgets that pdf.js gives "their own canvas" are still painted straight
 * onto the page when no `annotationCanvasMap` is passed: check boxes and radio buttons (with BOTH
 * their on and off appearances stacked) and read-only text fields. We strip exactly those operator
 * ranges, so the bitmap contains no text / choice / check box / radio widget at all — FormFieldLayer
 * draws every one of them, read-only included. Signature widgets and push buttons stay painted
 * (the forms layer has nothing to replace their appearance with), as do all non-widget annotations
 * (comments, stamps, shapes, ink, links' appearances...).
 *
 * Kept free of pdf.js imports so it can be unit-tested against the legacy (Node) build.
 */

/** pdf.js `AnnotationType.WIDGET`. */
export const ANNOTATION_TYPE_WIDGET = 20

export interface AnnotationLike {
  id?: string
  annotationType?: number
  /** 'Tx' | 'Btn' | 'Ch' | 'Sig' for widgets. */
  fieldType?: string
  pushButton?: boolean
}

/** True for widgets the forms layer renders (so they must not appear in the bitmap). */
export function isFormLayerWidget(a: AnnotationLike): boolean {
  return a.annotationType === ANNOTATION_TYPE_WIDGET && a.fieldType !== 'Sig' && !a.pushButton
}

export function formLayerWidgetIds(annotations: readonly AnnotationLike[]): Set<string> {
  const ids = new Set<string>()
  for (const a of annotations) if (a.id && isFormLayerWidget(a)) ids.add(a.id)
  return ids
}

export interface OperatorListLike {
  fnArray: ArrayLike<number>
  argsArray: ArrayLike<unknown>
}

export type OperationsFilter = (index: number, list: OperatorListLike) => boolean

/**
 * A pdf.js `operationsFilter` that drops everything between `beginAnnotation` and `endAnnotation`
 * for the given annotation ids. Stateful: create one per render. Annotations never nest, and pdf.js
 * evaluates begin/end operators exactly once and in order, so a flag is enough.
 * Returns undefined when there is nothing to skip (no filter = fastest path).
 */
export function createAnnotationSkipFilter(
  skipIds: ReadonlySet<string>,
  ops: { beginAnnotation: number; endAnnotation: number },
): OperationsFilter | undefined {
  if (!skipIds.size) return undefined
  let skipping = false
  return (index, list) => {
    const fn = list.fnArray[index]
    if (fn === ops.beginAnnotation) {
      const args = list.argsArray[index]
      const id = Array.isArray(args) ? args[0] : undefined
      skipping = typeof id === 'string' && skipIds.has(id)
      return !skipping
    }
    if (skipping) {
      if (fn === ops.endAnnotation) skipping = false
      return false
    }
    return true
  }
}
