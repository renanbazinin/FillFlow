import { useEffect } from 'react'
import { useAutosave } from '../../lib/storage/autosave'
import { useEditingShortcuts } from '../elements/useEditingShortcuts'
import { ExportDialog } from '../export/ExportDialog'
import { preloadExportEngine } from '../export/exportJob'
import { SignatureDialog } from '../signature/SignatureDialog'
import { Viewer } from '../viewer/Viewer'
import { ShortcutsDialog } from './ShortcutsDialog'
import { InspectorPanel, PagesPanel } from './SidePanels'
import { ToolDock } from './ToolDock'
import { TopBar } from './TopBar'
import { useEditorChrome } from './useEditorChrome'
import { useShellShortcuts } from './useShellShortcuts'

/**
 * Editor layout: top bar · [pages | viewer + floating dock | form & items] · dialogs.
 * Side panels dock at ≥1024px (pages) / ≥1280px (form & items) and become sheets below.
 */
export function EditorScreen() {
  useEditingShortcuts()
  useAutosave()
  useShellShortcuts()
  useEditorChrome()

  // Fetch the export engine in the background so the first Download doesn't wait for it.
  useEffect(() => {
    const id = window.setTimeout(() => preloadExportEngine().catch(() => {}), 1500)
    return () => window.clearTimeout(id)
  }, [])

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-canvas">
      <TopBar />
      <div className="relative flex min-h-0 flex-1">
        <PagesPanel />
        <main className="relative flex min-w-0 flex-1 flex-col">
          <div className="relative flex min-h-0 flex-1 flex-col">
            <Viewer />
          </div>
          <ToolDock />
        </main>
        <InspectorPanel />
      </div>
      <SignatureDialog />
      <ExportDialog />
      <ShortcutsDialog />
    </div>
  )
}
