import type { Messages } from '../messages'
import { common } from './common'
import { editor } from './editor'
import { elements } from './elements'
import { exportDialog } from './export'
import { forms } from './forms'
import { home } from './home'
import { shell } from './shell'
import { signature } from './signature'
import { tools } from './tools'

/** The Hebrew interface (עברית). */
export const he: Messages = {
  common,
  shell,
  tools,
  home,
  editor,
  elements,
  forms,
  signature,
  export: exportDialog,
}
