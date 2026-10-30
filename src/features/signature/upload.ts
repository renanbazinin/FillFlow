import { imageFileToCanvas } from './decode'
import { useSignatureDraft } from './draft'
import { computeBackgroundMap, estimateWhitePoint, fitWithin, hasTransparency, MAX_WHITE_POINT } from './imageUtils'
import type { SignatureRole } from './library'
import { context2d, createCanvas } from './render'

/** Working resolution of uploaded photos (the crop of a phone photo still has plenty of detail). */
const WORKING_MAX = 2400
/** Resolution of the live preview (re-processed on every slider move). */
const PREVIEW_MAX = 720

/** Slider ↔ white point: higher sensitivity removes more (a lower white point). */
export const SENSITIVITY_MIN_WHITE = 140
export const SENSITIVITY_MAX_WHITE = 250
export const whitePointToSensitivity = (w: number) =>
  Math.round(((SENSITIVITY_MAX_WHITE - w) / (SENSITIVITY_MAX_WHITE - SENSITIVITY_MIN_WHITE)) * 100)
export const sensitivityToWhitePoint = (s: number) =>
  Math.round(SENSITIVITY_MAX_WHITE - (s / 100) * (SENSITIVITY_MAX_WHITE - SENSITIVITY_MIN_WHITE))

/** Decodes an image for the Upload tab and analyses its background. */
export async function loadUploadFile(role: SignatureRole, file: Blob, fileName = 'image'): Promise<void> {
  const source = await imageFileToCanvas(file, WORKING_MAX)
  const size = fitWithin(source.width, source.height, PREVIEW_MAX)
  const preview = createCanvas(size.width, size.height)
  const ctx = context2d(preview, true)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, size.width, size.height)
  const img = ctx.getImageData(0, 0, size.width, size.height)
  const map = computeBackgroundMap(img)
  // Already cut out (transparent PNG): keep it as is by default.
  const cutOut = hasTransparency(img)
  const autoWhitePoint = cutOut ? MAX_WHITE_POINT : estimateWhitePoint(img, map)
  useSignatureDraft.getState().setUpload(role, {
    fileName,
    source,
    preview,
    map,
    autoWhitePoint,
    removeBg: !cutOut,
    whitePoint: autoWhitePoint,
  })
}
