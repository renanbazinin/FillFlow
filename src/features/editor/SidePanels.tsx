import { memo, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import { PanelLeftClose, PanelRightClose } from 'lucide-react'
import { Tabs } from 'radix-ui'
import { IconButton } from '../../components/ui/button'
import { Sheet } from '../../components/ui/dialog'
import { useT } from '../../i18n'
import { getFormDocumentInfo } from '../../lib/pdf/formFields'
import { cn } from '../../lib/utils/misc'
import { useEditor } from '../../store/editor'
import { ItemsPanel as ItemsPanelView } from '../elements/ItemsPanel'
import { FormPanel as FormPanelView } from '../forms/FormPanel'
import { Thumbnails as ThumbnailsView } from '../viewer/Thumbnails'
import { fillableFieldCount } from './docInfo'
import { LEFT_PANEL_INLINE, RIGHT_PANEL_INLINE, useMediaQuery } from './useMediaQuery'

// Panel contents take no (or stable) props: keep them from re-rendering with the panel chrome.
const FormPanel = memo(FormPanelView)
const ItemsPanel = memo(ItemsPanelView)
const Thumbnails = memo(ThumbnailsView)

const closePagesSheet = () => window.setTimeout(() => useEditor.getState().setLeftPanelOpen(false), 80)

export const LEFT_PANEL_WIDTH = 216
export const RIGHT_PANEL_WIDTH = 340

/** The panel-side icons show the side the panel sits at: mirrored in a right-to-left interface. */
const MIRRORED = 'rtl:-scale-x-100'

/**
 * A docked side panel that collapses by animating its width; the content keeps its width and
 * is anchored to the outer edge, so it slides out instead of reflowing. The pages panel ('left')
 * sits at the start and the form and items panel ('right') at the end: right to left, they swap
 * sides, borders and anchoring with them.
 */
function DockedPanel({
  side,
  open,
  width,
  label,
  children,
}: {
  side: 'left' | 'right'
  open: boolean
  width: number
  label: string
  children: ReactNode
}) {
  const ref = useRef<HTMLElement>(null)
  // Closing makes the panel inert, which would drop focus inside it (e.g. on its own close
  // button) to <body>: hand it to the panel's toggle in the top bar instead.
  useLayoutEffect(() => {
    if (!open && ref.current?.contains(document.activeElement)) {
      document.querySelector<HTMLElement>(`[data-panel-toggle="${side}"]`)?.focus({ preventScroll: true })
    }
  }, [open, side])
  return (
    <aside
      ref={ref}
      aria-label={label}
      inert={!open}
      style={{ width: open ? width : 0 }}
      className={cn(
        'relative z-10 shrink-0 overflow-hidden bg-surface transition-[width,border-color] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]',
        side === 'left' ? 'border-e' : 'border-s',
        open ? 'border-line' : 'border-transparent',
      )}
    >
      <div className={cn('absolute inset-y-0 flex flex-col', side === 'left' ? 'start-0' : 'end-0')} style={{ width }}>
        {children}
      </div>
    </aside>
  )
}

function PanelHeader({
  children,
  onClose,
  closeLabel,
  closeIcon,
  sheet = false,
}: {
  children: ReactNode
  onClose: () => void
  closeLabel: string
  closeIcon: ReactNode
  /** Inside a modal sheet (which takes initial focus itself): no tooltip on the close button. */
  sheet?: boolean
}) {
  const closeButton = (
    <IconButton label={closeLabel} icon={closeIcon} size="icon-sm" onClick={onClose} tooltip={!sheet} className="order-last pointer-coarse:size-10" />
  )
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line ps-3 pe-2">
      {/* In a sheet the close button comes first in Tab order (it still shows at the end): Shift+Tab
          from a tab moves past the whole tab list, and with nothing before the list, focus would leave
          the sheet and be pulled back. The focus trap only wraps around from its first Tab stop. */}
      {sheet && closeButton}
      <div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>
      {!sheet && closeButton}
    </div>
  )
}

/** Below the docking breakpoint the panel is a modal sheet; close it when the layout switches. */
function useCloseWhenUndocked(docked: boolean, close: () => void) {
  useEffect(() => {
    if (!docked) close()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on breakpoint changes
  }, [docked])
}

// --- Left: pages -------------------------------------------------------------

export function PagesPanel() {
  const open = useEditor((s) => s.leftPanelOpen)
  const pageCount = useEditor((s) => s.doc?.pages.length ?? 0)
  const docked = useMediaQuery(LEFT_PANEL_INLINE)
  const t = useT()
  const close = () => useEditor.getState().setLeftPanelOpen(false)
  useCloseWhenUndocked(docked, close)

  const body = (
    <>
      <PanelHeader onClose={close} closeLabel={t.editor.panels.hidePages} closeIcon={<PanelLeftClose className={MIRRORED} />}>
        <h2 className="text-[13px] font-semibold text-fg">{t.editor.panels.pages}</h2>
        <span className="text-[12px] tabular-nums text-fg-subtle">{pageCount}</span>
      </PanelHeader>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-thin">
        {/* Collapsed, the panel stays mounted: no thumbnail rendering or scrolling then. */}
        <Thumbnails active={open} />
      </div>
    </>
  )

  if (docked) {
    return (
      <DockedPanel side="left" open={open} width={LEFT_PANEL_WIDTH} label={t.editor.panels.pages}>
        {body}
      </DockedPanel>
    )
  }
  return (
    <Sheet
      side="start"
      open={open}
      onOpenChange={(o) => useEditor.getState().setLeftPanelOpen(o)}
      title={t.editor.panels.pages}
      className="w-[min(80vw,280px)]"
    >
      <div className="flex h-full min-h-0 flex-col pt-[env(safe-area-inset-top)]">
        <PanelHeader onClose={close} closeLabel={t.editor.panels.closePages} closeIcon={<PanelLeftClose className={MIRRORED} />} sheet>
          <h2 className="text-[13px] font-semibold text-fg">{t.editor.panels.pages}</h2>
          <span className="text-[12px] tabular-nums text-fg-subtle">{t.common.pages(pageCount)}</span>
        </PanelHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-safe scrollbar-thin">
          {/* On small screens, jumping to a page should also reveal it. */}
          <Thumbnails onNavigate={closePagesSheet} />
        </div>
      </div>
    </Sheet>
  )
}

// --- Right: form & items -----------------------------------------------------

type InspectorTab = 'form' | 'items'

export function InspectorPanel() {
  const open = useEditor((s) => s.rightPanelOpen)
  const tab = useEditor((s) => s.rightPanelTab)
  const doc = useEditor((s) => s.doc)
  const itemCount = useEditor((s) => s.elements.length)
  const fieldCount = useMemo(() => fillableFieldCount(doc?.formFields), [doc])
  // Pure XFA forms have no fields; the Form tab then explains why nothing can be filled.
  const hasForm = (doc?.formFields.length ?? 0) > 0 || getFormDocumentInfo(doc?.pdf)?.pureXfa === true
  const current: InspectorTab = hasForm ? tab : 'items'
  const docked = useMediaQuery(RIGHT_PANEL_INLINE)
  const t = useT()
  const p = t.editor.panels
  const close = () => useEditor.getState().setRightPanelOpen(false)
  useCloseWhenUndocked(docked, close)

  const body = (
    <Tabs.Root
      value={current}
      onValueChange={(v) => useEditor.getState().setRightPanelOpen(true, v as InspectorTab)}
      className="flex h-full min-h-0 flex-col"
    >
      <PanelHeader
        onClose={close}
        closeLabel={docked ? p.hidePanel : p.closePanel}
        closeIcon={<PanelRightClose className={MIRRORED} />}
        sheet={!docked}
      >
        {hasForm ? (
          <Tabs.List
            aria-label={p.tabs}
            // A pressed tab focuses itself. Without this, Radix takes the press for a click on the
            // list, and the next Tab into the list stops on the list itself (unseen), not the tab.
            onMouseDown={(e) => e.preventDefault()}
            className="inline-flex items-center gap-0.5 rounded-[10px] bg-surface-3 p-[3px]"
          >
            <TabTrigger value="form" count={fieldCount}>
              {p.form}
            </TabTrigger>
            <TabTrigger value="items" count={itemCount}>
              {p.items}
            </TabTrigger>
          </Tabs.List>
        ) : (
          <>
            <h2 className="text-[13px] font-semibold text-fg">{p.items}</h2>
            <span className="text-[12px] tabular-nums text-fg-subtle">{itemCount}</span>
          </>
        )}
      </PanelHeader>
      {hasForm && (
        <Tabs.Content value="form" forceMount className={TAB_CONTENT}>
          <FormPanel />
        </Tabs.Content>
      )}
      {hasForm ? (
        <Tabs.Content value="items" forceMount className={TAB_CONTENT}>
          <ItemsPanel />
        </Tabs.Content>
      ) : (
        // Without the Form tab there are no tabs: the list isn't a tab panel.
        <div className={TAB_CONTENT}>
          <ItemsPanel />
        </div>
      )}
    </Tabs.Root>
  )

  if (docked) {
    return (
      <DockedPanel side="right" open={open} width={RIGHT_PANEL_WIDTH} label={hasForm ? p.formAndItems : p.items}>
        {body}
      </DockedPanel>
    )
  }
  return (
    <Sheet
      side="end"
      open={open}
      onOpenChange={(o) => useEditor.getState().setRightPanelOpen(o)}
      title={hasForm ? p.formAndItems : p.items}
      className="w-[min(92vw,380px)]"
    >
      <div className="flex h-full min-h-0 flex-col pb-safe pt-[env(safe-area-inset-top)]">{body}</div>
    </Sheet>
  )
}

// Inactive tabs stay mounted (keeps each list's scroll position) but hidden. A tab panel is a Tab
// stop: its focus ring is inset so the panel's edges don't clip it.
const TAB_CONTENT =
  'flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain scrollbar-thin focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent data-[state=inactive]:hidden'

function TabTrigger({ value, count, children }: { value: InspectorTab; count: number; children: ReactNode }) {
  return (
    <Tabs.Trigger
      value={value}
      className="group inline-flex h-7 items-center gap-1.5 rounded-[7px] px-2.5 text-[13px] font-medium text-fg-muted transition-colors hover:text-fg data-[state=active]:bg-surface data-[state=active]:text-fg data-[state=active]:shadow-xs pointer-coarse:h-10"
    >
      {children}
      <span className="min-w-[18px] rounded-full bg-line/80 px-1.5 text-center text-[11px] font-semibold leading-[18px] tabular-nums text-fg-muted group-data-[state=active]:bg-accent-soft group-data-[state=active]:text-accent-ink">
        {count}
      </span>
    </Tabs.Trigger>
  )
}
