import { common } from './common'
import { editor } from './editor'
import { elements } from './elements'
import { exportDialog } from './export'
import { forms } from './forms'
import { home } from './home'
import { shell } from './shell'
import { signature } from './signature'
import { tools } from './tools'

/** The English interface: the source every other language mirrors, key for key. */
export const en = {
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
