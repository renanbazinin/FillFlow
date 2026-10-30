import { useEditor, type LoadedDocument } from '../../store/editor'

/**
 * Which opened documents needed a password. Their page 1 must not be stored as an unencrypted
 * preview in the recents list, where anyone using this browser would see it.
 *
 * The store is watched from the moment this module loads (at app start: it is part of the
 * editor's static imports), because the password prompt happens before the editor mounts.
 */
const needed = new WeakSet<LoadedDocument>()
/** Opened before we were watching (e.g. if the editor gets lazy-loaded): we can't know. */
const unknown = new WeakSet<LoadedDocument>()
let passwordAsked = false

const initial = useEditor.getState().doc
if (initial) unknown.add(initial)

const unsubscribe = useEditor.subscribe((s, prev) => {
  if (s.doc !== prev.doc) {
    if (s.doc && passwordAsked) needed.add(s.doc)
    passwordAsked = false
  }
  if (s.load !== prev.load) {
    if (s.load.status === 'password') passwordAsked = true
    // A cancelled prompt or a failed open: whatever opens next starts from scratch.
    else if (s.load.status === 'error' || (s.load.status === 'idle' && s.doc === prev.doc)) passwordAsked = false
  }
})
import.meta.hot?.dispose(unsubscribe)

/** Whether `doc` had to be unlocked with a password (unknown documents: whether it's encrypted). */
export async function neededPassword(doc: LoadedDocument): Promise<boolean> {
  if (needed.has(doc)) return true
  if (!unknown.has(doc)) return false
  const { info } = await doc.pdf.getMetadata()
  return Boolean((info as { EncryptFilterName?: string | null }).EncryptFilterName)
}
