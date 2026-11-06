import { createPortal } from 'react-dom'
import { Direction } from 'radix-ui'
import { useShallow } from 'zustand/react/shallow'
import { BringToFront, ClipboardCopy, ClipboardPaste, Copy, Lock, LockOpen, PencilLine, Scissors, SendToBack, Trash } from 'lucide-react'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '../../../components/ui/menu'
import { useDir, useT } from '../../../i18n'
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

/**
 * Right-click menu for the selection, anchored at the pointer. It is interface: it reads the
 * interface's way, and right to left it opens toward the left of the pointer (`align="start"`).
 */
export function ElementContextMenu({ at }: { at: ContextMenuAt }) {
  const selected = useEditor(useShallow((s) => getSelectedElements(s)))
  const t = useT()
  const dir = useDir()
  if (!selected.length) return null
  const a = t.elements.actions
  const allLocked = selected.every((e) => e.locked)
  const text = selected.length === 1 && selected[0].kind === 'text' ? selected[0] : null
  return (
    // The interface's direction, whatever the pages it is rendered from (kept left to right) say.
    <Direction.Provider dir={dir}>
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
                {a.editText}
              </MenuItem>
              <MenuSeparator />
            </>
          )}
          <MenuItem icon={<Scissors />} shortcut={`${modKeyLabel}+X`} disabled={allLocked} onSelect={() => copy(true)}>
            {a.cut}
          </MenuItem>
          <MenuItem icon={<ClipboardCopy />} shortcut={`${modKeyLabel}+C`} onSelect={() => copy(false)}>
            {a.copy}
          </MenuItem>
          <MenuItem icon={<ClipboardPaste />} shortcut={`${modKeyLabel}+V`} disabled={!hasClipboardItems()} onSelect={() => pasteItems()}>
            {a.paste}
          </MenuItem>
          <MenuItem icon={<Copy />} shortcut={`${modKeyLabel}+D`} onSelect={duplicateSelection}>
            {a.duplicate}
          </MenuItem>
          <MenuSeparator />
          <MenuItem icon={<BringToFront />} shortcut={`${modKeyLabel}+]`} onSelect={() => reorderSelection('front')}>
            {a.bringToFront}
          </MenuItem>
          <MenuItem icon={<SendToBack />} shortcut={`${modKeyLabel}+[`} onSelect={() => reorderSelection('back')}>
            {a.sendToBack}
          </MenuItem>
          <MenuSeparator />
          <MenuItem icon={allLocked ? <LockOpen /> : <Lock />} shortcut={`${modKeyLabel}+Shift+L`} onSelect={toggleLockSelection}>
            {allLocked ? a.unlock : a.lock}
          </MenuItem>
          <MenuItem icon={<Trash />} shortcut="Del" danger disabled={allLocked} onSelect={deleteSelection}>
            {a.delete}
          </MenuItem>
        </MenuContent>
      </Menu>
    </Direction.Provider>
  )
}
