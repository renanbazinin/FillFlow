import { memo, useCallback, useMemo, useRef, type KeyboardEvent, type MouseEvent } from 'react'
import { Lock, LockOpen, Trash } from 'lucide-react'
import { Button, IconButton } from '../../components/ui/button'
import { confirm } from '../../components/ui/confirm'
import { elementLabel } from '../../model/elements'
import type { Element } from '../../model/types'
import { useEditor } from '../../store/editor'
import { cn } from '../../lib/utils/misc'
import { ItemsEmptyState } from './items/ItemsEmptyState'
import { ItemThumb } from './items/ItemThumb'
import { groupByPage, rangeIds } from './items/groups'
import { closePanelOnSmallScreens } from './items/panel'
import { deleteElements, revealElement, setLocked } from './state/commands'
import { editText, finishActiveTextEdit } from './state/textEdit'
import { clearHovered, setHovered } from './state/ui'

/**
 * Right-panel "Items" tab: everything placed on the document, grouped by page in reading order.
 * Click selects and scrolls to an item (Shift/Ctrl/⌘ extend), hovering highlights it on the
 * page, double-clicking a text item edits it.
 */
export function ItemsPanel() {
  const elements = useEditor((s) => s.elements)
  const selection = useEditor((s) => s.selection)
  const groups = useMemo(() => groupByPage(elements), [elements])
  const selected = useMemo(() => new Set(selection), [selection])
  const anchor = useRef<string | null>(null)

  // Stable callbacks keep the memoized rows from re-rendering while items move.
  const pick = useCallback((el: Element, e: MouseEvent) => {
    finishActiveTextEdit()
    const s = useEditor.getState()
    if (e.shiftKey && anchor.current) {
      const order = groupByPage(s.elements).flatMap((g) => g.items.map((x) => x.id))
      s.select(rangeIds(order, anchor.current, el.id))
    } else if (e.metaKey || e.ctrlKey) s.select([el.id], 'toggle')
    else s.select([el.id])
    anchor.current = el.id
    if (!e.shiftKey && !e.metaKey && !e.ctrlKey) {
      revealElement(el)
      closePanelOnSmallScreens()
    }
  }, [])

  const edit = useCallback((el: Element) => {
    if (el.kind !== 'text') return
    revealElement(el, 'auto')
    editText(el.id)
  }, [])

  if (!elements.length) return <ItemsEmptyState />

  const onListKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      deleteFocusedItem(e)
      return
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return
    const rows = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[data-item-row]')]
    const i = rows.indexOf(document.activeElement as HTMLButtonElement)
    if (i < 0 && e.key !== 'Home' && e.key !== 'End') return
    e.preventDefault()
    e.stopPropagation()
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))
    rows[next]?.focus()
  }

  const clearAll = async () => {
    const s = useEditor.getState()
    const locked = s.elements.filter((e) => e.locked).length
    const removable = s.elements.length - locked
    if (!removable) return
    const ok = await confirm({
      title: 'Clear all items?',
      description:
        `This removes ${removable === 1 ? 'the item' : `all ${removable} items`} you added to this document.` +
        (locked ? ` ${locked === 1 ? 'One locked item stays' : `${locked} locked items stay`}.` : '') +
        ' You can undo this.',
      confirmLabel: 'Clear all',
      danger: true,
    })
    if (!ok) return
    finishActiveTextEdit()
    const st = useEditor.getState()
    st.removeElements(st.elements.filter((e) => !e.locked).map((e) => e.id))
  }

  const allLocked = elements.every((e) => e.locked)

  return (
    <div data-items-panel="" className="flex min-h-full flex-col">
      <div className="flex-1 pb-2" onKeyDown={onListKeyDown}>
        {groups.map((g) => (
          <section key={g.page} aria-label={`Page ${g.page + 1}`}>
            <h3 className="sticky top-0 z-10 flex items-center justify-between bg-surface/95 px-4 pb-1.5 pt-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-fg-subtle backdrop-blur-sm">
              <span>Page {g.page + 1}</span>
              <span className="font-medium tabular-nums">{g.items.length}</span>
            </h3>
            <ul className="grid gap-px px-2">
              {g.items.map((el) => (
                <ItemRow key={el.id} el={el} selected={selected.has(el.id)} onPick={pick} onEdit={edit} />
              ))}
            </ul>
          </section>
        ))}
      </div>
      <div className="sticky bottom-0 border-t border-line bg-surface p-2 pb-[max(env(safe-area-inset-bottom),0.5rem)]">
        <Button variant="danger-ghost" size="sm" className="w-full" onClick={() => void clearAll()} disabled={allLocked}>
          <Trash />
          Clear all items
        </Button>
      </div>
    </div>
  )
}

/**
 * Delete / Backspace on a row deletes that row's item (the whole selection when the row is part
 * of it), not whatever is selected elsewhere; the keyboard stays in the list.
 */
function deleteFocusedItem(e: KeyboardEvent<HTMLDivElement>) {
  if (e.altKey || e.ctrlKey || e.metaKey) return
  const item = (e.target as HTMLElement).closest<HTMLElement>('[data-item-id]')
  const id = item?.dataset.itemId
  if (!item || !id) return
  e.preventDefault()
  e.stopPropagation()
  const rows = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-item-id]')]
  const { selection } = useEditor.getState()
  deleteElements(selection.includes(id) ? selection : [id])
  const left = new Set(useEditor.getState().elements.map((el) => el.id))
  if (left.has(id)) return
  // Rows of the remaining items stay in the DOM, so the next one (else the previous) can take focus now.
  const i = rows.indexOf(item)
  const next = rows.slice(i + 1).find((r) => left.has(r.dataset.itemId!)) ?? rows.slice(0, i).reverse().find((r) => left.has(r.dataset.itemId!))
  next?.querySelector<HTMLElement>('[data-item-row]')?.focus()
}

const ItemRow = memo(function ItemRow({
  el,
  selected,
  onPick,
  onEdit,
}: {
  el: Element
  selected: boolean
  onPick: (el: Element, e: MouseEvent) => void
  onEdit: (el: Element) => void
}) {
  const label = elementLabel(el)
  return (
    <li
      data-item-id={el.id}
      className={cn(
        'group relative flex h-10 items-center rounded-lg transition-colors',
        selected ? 'bg-accent-soft' : 'hover:bg-surface-3',
      )}
      onPointerEnter={(e) => e.pointerType !== 'touch' && setHovered(el.id)}
      onPointerLeave={() => clearHovered(el.id)}
    >
      <button
        type="button"
        data-item-row=""
        aria-pressed={selected}
        title={el.kind === 'text' ? 'Click to select · double-click to edit' : undefined}
        onClick={(e) => onPick(el, e)}
        onDoubleClick={() => onEdit(el)}
        onFocus={() => setHovered(el.id)}
        onBlur={() => clearHovered(el.id)}
        className="flex h-full min-w-0 flex-1 items-center gap-2.5 rounded-lg pl-2 pr-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset"
      >
        <ItemThumb el={el} />
        <span dir="auto" className={cn('min-w-0 flex-1 truncate text-left text-[13px]', selected ? 'font-medium text-fg' : 'text-fg')}>
          {label}
        </span>
        {el.locked && <Lock aria-label="Locked" className="size-3.5 shrink-0 text-fg-subtle group-focus-within:hidden group-hover:hidden pointer-coarse:hidden" />}
      </button>
      <div className="hidden shrink-0 items-center gap-0.5 pr-1 group-focus-within:flex group-hover:flex pointer-coarse:flex">
        <IconButton
          size="icon-xs"
          label={el.locked ? 'Unlock' : 'Lock'}
          tooltipSide="left"
          icon={el.locked ? <Lock /> : <LockOpen />}
          active={el.locked ? true : undefined}
          onClick={() => setLocked([el.id], !el.locked)}
        />
        <IconButton
          size="icon-xs"
          label={el.locked ? 'Unlock to delete' : 'Delete'}
          tooltipSide="left"
          icon={<Trash />}
          disabled={el.locked}
          onClick={() => {
            finishActiveTextEdit()
            useEditor.getState().removeElements([el.id])
          }}
          className="hover:bg-danger-soft hover:text-danger"
        />
      </div>
    </li>
  )
})
