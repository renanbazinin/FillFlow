import { memo } from 'react'
import { Download, PanelLeft, PanelRight, Redo2, Undo2 } from 'lucide-react'
import { LogoMark } from '../../components/brand/Logo'
import { Button, IconButton } from '../../components/ui/button'
import { Tooltip } from '../../components/ui/tooltip'
import { selectCanRedo, selectCanUndo, useEditor } from '../../store/editor'
import { ZoomControls } from '../viewer/ZoomControls'
import { DocumentTitle } from './DocumentTitle'
import { EditorMenu } from './EditorMenu'
import { closeDocumentSafely } from './leaveGuard'
import { SHORTCUTS, shortcutLabel } from './shortcuts'
import { COMPACT_LAYOUT, useMediaQuery } from './useMediaQuery'

export const TopBar = memo(function TopBar() {
  const compact = useMediaQuery(COMPACT_LAYOUT)
  return (
    <header className="relative z-40 flex h-[calc(3.5rem+env(safe-area-inset-top))] shrink-0 items-center gap-1.5 border-b border-line bg-surface/85 pl-2 pr-2 pt-[env(safe-area-inset-top)] backdrop-blur-xl backdrop-saturate-150 sm:gap-2 sm:pl-2.5 sm:pr-3">
      <Tooltip content="Back to home" side="bottom" align="start">
        <button
          type="button"
          onClick={() => void closeDocumentSafely()}
          aria-label="Back to home"
          className="group inline-flex size-10 shrink-0 items-center justify-center rounded-xl transition-colors hover:bg-surface-3 active:bg-line"
        >
          <LogoMark className="size-[26px] transition-transform duration-200 ease-out group-hover:-translate-x-px group-hover:scale-[1.04]" />
        </button>
      </Tooltip>
      <div aria-hidden className="h-6 w-px shrink-0 bg-line max-sm:hidden" />
      <div className="min-w-0 flex-1 sm:pl-1">
        <DocumentTitle />
      </div>

      <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
        <HistoryButtons />
        {/* The zoom group (and its divider) collapses if the control renders nothing. */}
        <div className="flex items-center max-md:hidden [&:not(:has(>:nth-child(2)))]:hidden">
          <Divider />
          <ZoomControls />
        </div>
        <Divider className="max-sm:hidden" />
        <PanelToggles />
        <Button
          variant="primary"
          size="sm"
          onClick={() => useEditor.getState().openDialog('export')}
          aria-label="Download"
          className="ml-1 max-sm:size-9 max-sm:px-0 sm:ml-1.5"
        >
          <Download />
          <span className="max-sm:hidden">Download</span>
        </Button>
        <EditorMenu compact={compact} />
      </div>
    </header>
  )
})

function Divider({ className }: { className?: string }) {
  return <div aria-hidden className={`mx-1 h-5 w-px shrink-0 bg-line ${className ?? ''}`} />
}

function HistoryButtons() {
  const canUndo = useEditor(selectCanUndo)
  const canRedo = useEditor(selectCanRedo)
  return (
    <>
      <IconButton
        label="Undo"
        shortcut={shortcutLabel(SHORTCUTS.undo)}
        icon={<Undo2 />}
        disabled={!canUndo}
        onClick={() => useEditor.getState().undo()}
      />
      <IconButton
        label="Redo"
        shortcut={shortcutLabel(SHORTCUTS.redo)}
        icon={<Redo2 />}
        disabled={!canRedo}
        onClick={() => useEditor.getState().redo()}
      />
    </>
  )
}

// Panel toggles read as "on" quietly; the accent is reserved for the primary action.
const PANEL_ON = 'bg-surface-3 text-fg hover:bg-surface-3 hover:text-fg'

function PanelToggles() {
  const left = useEditor((s) => s.leftPanelOpen)
  const right = useEditor((s) => s.rightPanelOpen)
  const hasForm = useEditor((s) => (s.doc?.formFields.length ?? 0) > 0)
  return (
    <div className="flex items-center gap-0.5 max-sm:hidden">
      {/* data-panel-toggle: a docked panel hands focus here when it closes from inside. */}
      <IconButton
        label="Pages"
        icon={<PanelLeft />}
        data-panel-toggle="left"
        active={left}
        onClick={() => useEditor.getState().setLeftPanelOpen(!left)}
        className={left ? PANEL_ON : undefined}
      />
      <IconButton
        label={hasForm ? 'Form & items' : 'Items'}
        icon={<PanelRight />}
        data-panel-toggle="right"
        active={right}
        onClick={() => useEditor.getState().setRightPanelOpen(!right)}
        className={right ? PANEL_ON : undefined}
      />
    </div>
  )
}
