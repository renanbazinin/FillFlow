import { useEffect, useState } from 'react'
import { Check, TriangleAlert } from 'lucide-react'
import { Spinner } from '../../components/ui/controls'
import { Tooltip } from '../../components/ui/tooltip'
import { useDir, useT } from '../../i18n'
import { useSaveStatus, type SaveStatus } from '../../lib/storage/autosave'
import { cn } from '../../lib/utils/misc'
import { useEditor } from '../../store/editor'
import { displayName } from '../home/pdfFiles'

/** File name, page count and save status, stacked, for the top bar. */
export function DocumentTitle() {
  const name = useEditor((s) => s.doc?.name ?? '')
  const pageCount = useEditor((s) => s.doc?.pages.length ?? 0)
  const t = useT()
  const dir = useDir()
  return (
    <div className="flex min-w-0 flex-col justify-center">
      {/* The name keeps its own direction (dir="auto": cut short at its own end), and lines up with
          the line under it, at the interface's start: logical alignment would follow the name's. */}
      <h1
        data-doc-name
        className={cn(
          'truncate text-[13.5px] font-semibold leading-5 tracking-[-0.005em] text-fg',
          dir === 'rtl' ? 'text-right' : 'text-left',
        )}
        title={name}
        dir="auto"
      >
        {displayName(name)}
      </h1>
      <div className="flex min-w-0 items-center gap-1.5 text-[11.5px] leading-4 text-fg-subtle">
        <span className="shrink-0 tabular-nums">{t.common.pages(pageCount)}</span>
        <SaveIndicator />
      </div>
    </div>
  )
}

/**
 * Autosave status. Quick saves don't flash "Saving…": it only appears when a write takes a
 * moment, otherwise the label goes straight to "Saved".
 */
function SaveIndicator() {
  const state = useCalmSaveState()
  const error = useSaveStatus((s) => s.error)
  const t = useT()
  const s = t.editor.save
  if (state === 'idle') return null
  return (
    <span className="flex min-w-0 items-center gap-1.5" aria-live="polite">
      <span aria-hidden>·</span>
      {state === 'saving' && (
        <span className="flex items-center gap-1">
          <Spinner className="size-3" />
          {s.saving}
        </span>
      )}
      {state === 'saved' && (
        <span className="flex min-w-0 items-center gap-1 animate-fade-in">
          <Check className="size-3 shrink-0 text-success" strokeWidth={3} />
          <span className="truncate max-sm:hidden">{s.saved}</span>
          <span className="sm:hidden">{s.savedShort}</span>
        </span>
      )}
      {state === 'error' && (
        <Tooltip content={s.notSavedTip(error ?? s.refused)}>
          <button
            type="button"
            onClick={() => useEditor.getState().openDialog('export')}
            className="flex items-center gap-1 rounded font-medium text-warning hover:underline"
          >
            <TriangleAlert className="size-3 shrink-0" strokeWidth={2.5} />
            {s.notSaved}
          </button>
        </Tooltip>
      )}
    </span>
  )
}

function useCalmSaveState(): SaveStatus['state'] {
  const state = useSaveStatus((s) => s.state)
  const [shown, setShown] = useState(state)
  useEffect(() => {
    const t = window.setTimeout(() => setShown(state), state === 'saving' ? 700 : 0)
    return () => window.clearTimeout(t)
  }, [state])
  return shown
}
