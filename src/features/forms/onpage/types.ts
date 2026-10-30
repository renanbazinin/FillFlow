import type { QuarterTurn } from '../../../lib/pdf/formFields'
import type { FormField, FormWidget } from '../../../model/types'

export interface ControlProps {
  field: FormField
  widget: FormWidget
  /** CSS px per point. */
  scale: number
  /** Only the Select tool lets the user fill fields; otherwise controls are inert. */
  interactive: boolean
  /** Counterclockwise turn of the field's text as seen on screen (see visualTextRotation). */
  rotation: QuarterTurn
}
