import { createPortal } from 'react-dom'
import { useShallow } from 'zustand/react/shallow'
import { BringToFront, ClipboardCopy, ClipboardPaste, Copy, Lock, LockOpen, PencilLine, Scissors, SendToBack, Trash } from 'lucide-react'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '../../../components/ui/menu'
import { getSelectedElements, useEditor } from '../../../store/editor'
import { modKeyLabel } from '../../../lib/utils/misc'
import { copySelection, hasClipboardItems, pasteItems, writeClipboardMarker } from '../state/clipboard'
import { deleteSelection, duplicateSelection, reorderSelection, toggleLockSelection } from '../state/commands'
import { editText } from '../state/textEdit'
import { setContextMenu, type ContextMenuAt } from '../state/ui'

const close = () => setContextMenu(null)

/** No copy event here, so the marker goes to the system clipboard separately (see clipboard.ts). */
function copy(cut: boolean) {
  if (copySelection(cut)) writeClipboardMarker()
}

/** Right-click menu for the selection, anchored at the pointer. */
export function ElementContextMenu({ at }: { at: ContextMenuAt }) {
  const selected = useEditor(useShallow((s) => getSelectedElements(s)))
  if (!selected.length) return null
  const allLocked = selected.every((e) => e.locked)
  const text = selected.length === 1 && selected[0].kind === 'text' ? selected[0] : null
  return (
    <Menu open modal={false} onOpenChange={(open) => !open && close()}>
      {createPortal(
        <MenuTrigger asChild>
          <span aria-hidden className="pointer-events-none fixed size-px" style={{ left: at.x, top: at.y }} />
        </MenuTrigger>,
        document.body,
      )}
      <MenuContent align="start" side="bottom" sideOffset={2} className="min-w-56" onCloseAutoFocus={(e) => e.preventDefault()}>
        {text && (
          <>
            <MenuItem icon={<PencilLine />} shortcut="Enter" onSelect={() => editText(text.id)}>
              Edit text
            </MenuItem>
            <MenuSeparator />
          </>
        )}
        <MenuItem icon={<Scissors />} shortcut={`${modKeyLabel}+X`} disabled={allLocked} onSelect={() => copy(true)}>
          Cut
        </MenuItem>
        <MenuItem icon={<ClipboardCopy />} shortcut={`${modKeyLabel}+C`} onSelect={() => copy(false)}>
          Copy
        </MenuItem>
        <MenuItem icon={<ClipboardPaste />} shortcut={`${modKeyLabel}+V`} disabled={!hasClipboardItems()} onSelect={() => pasteItems()}>
          Paste
        </MenuItem>
        <MenuItem icon={<Copy />} shortcut={`${modKeyLabel}+D`} onSelect={duplicateSelection}>
          Duplicate
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon={<BringToFront />} shortcut={`${modKeyLabel}+]`} onSelect={() => reorderSelection('front')}>
          Bring to front
        </MenuItem>
        <MenuItem icon={<SendToBack />} shortcut={`${modKeyLabel}+[`} onSelect={() => reorderSelection('back')}>
          Send to back
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon={allLocked ? <LockOpen /> : <Lock />} shortcut={`${modKeyLabel}+Shift+L`} onSelect={toggleLockSelection}>
          {allLocked ? 'Unlock' : 'Lock'}
        </MenuItem>
        <MenuItem icon={<Trash />} shortcut="Del" danger disabled={allLocked} onSelect={deleteSelection}>
          Delete
        </MenuItem>
      </MenuContent>
    </Menu>
  )
}
