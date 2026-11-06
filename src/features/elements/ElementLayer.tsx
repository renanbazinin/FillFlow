import { memo, useEffect, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { TOOL_BY_ID } from '../../model/tools'
import type { PageInfo } from '../../model/types'
import { elementsOnPage, useEditor, type EditorState } from '../../store/editor'
import { ContextToolbar } from './toolbar/ContextToolbar'
import { ElementContextMenu } from './toolbar/ElementContextMenu'
import { CreationLayer } from './create/CreationLayer'
import { TextEditor } from './edit/TextEditor'
import { useSelectInteractions } from './interaction/useSelectInteractions'
import { ElementView } from './render/ElementView'
import { DropGhost, Guides, Marquee } from './render/Guides'
import { SelectionOverlay } from './render/SelectionOverlay'
import { ensureFontsFor } from './state/fonts'
import { useElementsUi } from './state/ui'

const NONE: string[] = []

function selectedOnPage(s: EditorState, page: number): string[] {
  if (!s.selection.length) return NONE
  const ids = new Set(s.selection)
  return s.elements.filter((e) => e.page === page && ids.has(e.id)).map((e) => e.id)
}

/** The page whose layer hosts the context toolbar: the page of the first selected item. */
function anchorPage(s: EditorState): number {
  const id = s.selection[0]
  if (!id) return -1
  return s.elements.find((e) => e.id === id)?.page ?? -1
}

/**
 * Everything the user placed on one page, plus the editing chrome for it. Sits above the form
 * layer; it doesn't create a stacking context itself (children carry z-20+), so highlights can
 * multiply with the PDF canvas. What was placed (and the text being typed) is cut at the page
 * edges, as the download cuts it; the chrome around it isn't. In Select/Pan the root lets presses
 * through to form fields; creation tools put a capture surface on top.
 */
export const ElementLayer = memo(function ElementLayer({ page, scale }: { page: PageInfo; scale: number }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const tool = useEditor((s) => s.tool)
  const elements = useEditor(useShallow((s) => elementsOnPage(s.elements, page.index)))
  const selectedIds = useEditor(useShallow((s) => selectedOnPage(s, page.index)))
  const editingId = useEditor((s) => s.editingId)
  const isAnchor = useEditor((s) => anchorPage(s) === page.index)
  const dragSourceId = useElementsUi((s) => s.dropPreview?.element.id ?? null)
  const contextMenu = useElementsUi((s) => (s.contextMenu?.page === page.index ? s.contextMenu : null))
  const overlay = useSelectInteractions(page, rootRef)

  useEffect(() => {
    ensureFontsFor(elements)
  }, [elements])

  const creating = TOOL_BY_ID[tool].placement !== 'none'
  const interactive = tool === 'select'
  const editing = editingId ? elements.find((e) => e.id === editingId) : undefined

  return (
    <div
      ref={rootRef}
      data-element-layer={page.index}
      className="pointer-events-none absolute inset-0 select-none [-webkit-touch-callout:none]"
    >
      {/* Cut at the page edges. `overflow: clip` (unlike `hidden`) makes no scroll container, and
          without a z-index this box is no stacking context: highlights still blend with the canvas. */}
      <div className="absolute inset-0 overflow-clip">
        {elements.map((el) => (
          <ElementView
            key={el.id}
            el={el}
            scale={scale}
            interactive={interactive}
            editing={el.id === editingId}
            dimmed={el.id === dragSourceId}
          />
        ))}
      </div>
      {tool !== 'hand' && !creating && (
        <SelectionOverlay
          elements={elements}
          selectedIds={selectedIds}
          scale={scale}
          editingId={editingId}
          showHandles={interactive && !overlay.moving}
          quiet={overlay.moving}
          readout={overlay.readout}
        />
      )}
      <Guides guides={overlay.guides} scale={scale} />
      <Marquee rect={overlay.marquee} scale={scale} />
      <DropGhost page={page.index} scale={scale} />
      {editing?.kind === 'text' && <TextEditor el={editing} scale={scale} page={page} />}
      {creating && <CreationLayer page={page} scale={scale} tool={tool} />}
      {isAnchor && <ContextToolbar page={page} scale={scale} rootRef={rootRef} />}
      {contextMenu && <ElementContextMenu key={`${contextMenu.x}:${contextMenu.y}`} at={contextMenu} />}
    </div>
  )
})
