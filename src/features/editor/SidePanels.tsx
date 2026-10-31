import { memo, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import { PanelLeftClose, PanelRightClose } from 'lucide-react'
import { Tabs } from 'radix-ui'
import { IconButton } from '../../components/ui/button'
import { Sheet } from '../../components/ui/dialog'
import { getFormDocumentInfo } from '../../lib/pdf/formFields'
import { cn } from '../../lib/utils/misc'
import { useEditor } from '../../store/editor'
import { ItemsPanel as ItemsPanelView } from '../elements/ItemsPanel'
import { FormPanel as FormPanelView } from '../forms/FormPanel'
import { pluralize } from '../home/recentMeta'
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

/**
 * A docked side panel that collapses by animating its width; the content keeps its width and
 * is anchored to the outer edge, so it slides out instead of reflowing.
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
        side === 'left' ? 'border-r' : 'border-l',
        open ? 'border-line' : 'border-transparent',
      )}
    >
      <div className={cn('absolute inset-y-0 flex flex-col', side === 'left' ? 'left-0' : 'right-0')} style={{ width }}>
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
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line pl-3 pr-2">
      <div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>
      <IconButton label={closeLabel} icon={closeIcon} size="icon-sm" onClick={onClose} tooltip={!sheet} className="pointer-coarse:size-10" />
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
  const close = () => useEditor.getState().setLeftPanelOpen(false)
  useCloseWhenUndocked(docked, close)

  const body = (
    <>
      <PanelHeader onClose={close} closeLabel="Hide pages" closeIcon={<PanelLeftClose />}>
        <h2 className="text-[13px] font-semibold text-fg">Pages</h2>
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
      <DockedPanel side="left" open={open} width={LEFT_PANEL_WIDTH} label="Pages">
        {body}
      </DockedPanel>
    )
  }
  return (
    <Sheet side="left" open={open} onOpenChange={(o) => useEditor.getState().setLeftPanelOpen(o)} title="Pages" className="w-[min(80vw,280px)]">
      <div className="flex h-full min-h-0 flex-col pt-[env(safe-area-inset-top)]">
        <PanelHeader onClose={close} closeLabel="Close pages" closeIcon={<PanelLeftClose />} sheet>
          <h2 className="text-[13px] font-semibold text-fg">Pages</h2>
          <span className="text-[12px] tabular-nums text-fg-subtle">{pluralize(pageCount, 'page')}</span>
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
  const close = () => useEditor.getState().setRightPanelOpen(false)
  useCloseWhenUndocked(docked, close)

  const body = (
    <Tabs.Root
      value={current}
      onValueChange={(v) => useEditor.getState().setRightPanelOpen(true, v as InspectorTab)}
      className="flex h-full min-h-0 flex-col"
    >
      <PanelHeader onClose={close} closeLabel={docked ? 'Hide panel' : 'Close panel'} closeIcon={<PanelRightClose />} sheet={!docked}>
        {hasForm ? (
          <Tabs.List aria-label="Panel" className="inline-flex items-center gap-0.5 rounded-[10px] bg-surface-3 p-[3px]">
            <TabTrigger value="form" count={fieldCount}>
              Form
            </TabTrigger>
            <TabTrigger value="items" count={itemCount}>
              Items
            </TabTrigger>
          </Tabs.List>
        ) : (
          <>
            <h2 className="text-[13px] font-semibold text-fg">Items</h2>
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
      <DockedPanel side="right" open={open} width={RIGHT_PANEL_WIDTH} label={hasForm ? 'Form and items' : 'Items'}>
        {body}
      </DockedPanel>
    )
  }
  return (
    <Sheet
      side="right"
      open={open}
      onOpenChange={(o) => useEditor.getState().setRightPanelOpen(o)}
      title={hasForm ? 'Form and items' : 'Items'}
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
      className="group inline-flex h-7 items-center gap-1.5 rounded-[7px] px-2.5 text-[13px] font-medium text-fg-muted transition-colors hover:text-fg data-[state=active]:bg-surface data-[state=active]:text-fg data-[state=active]:shadow-xs"
    >
      {children}
      <span className="min-w-[18px] rounded-full bg-line/80 px-1.5 text-center text-[11px] font-semibold leading-[18px] tabular-nums text-fg-muted group-data-[state=active]:bg-accent-soft group-data-[state=active]:text-accent-ink">
        {count}
      </span>
    </Tabs.Trigger>
  )
}
