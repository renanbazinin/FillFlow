import { Fragment, type ReactNode } from 'react'

/**
 * Fills the {name} slots of a message with elements (links, emphasis), so each language keeps its
 * own word order around them: richText(t.shell.home.builtWith, { pdfjs: <a…>PDF.js</a>, … }).
 * A slot the message doesn't fill stays as written.
 */
export function richText(message: string, slots: Record<string, ReactNode>): ReactNode {
  return message.split(/(\{\w+\})/).map((part, i) => {
    const name = /^\{(\w+)\}$/.exec(part)?.[1]
    return <Fragment key={i}>{name !== undefined && name in slots ? slots[name] : part}</Fragment>
  })
}
