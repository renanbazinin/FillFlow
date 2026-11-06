import { useEffect, useState } from 'react'
import { Check, TriangleAlert } from 'lucide-react'
import { Spinner } from '../../components/ui/controls'
import { Tooltip } from '../../components/ui/tooltip'
import { useSaveStatus, type SaveStatus } from '../../lib/storage/autosave'
import { useEditor } from '../../store/editor'
import { displayName } from '../home/pdfFiles'
import { pluralize } from '../home/recentMeta'

/** File name, page count and save status, stacked, for the top bar. */
export function DocumentTitle() {
  const name = useEditor((s) => s.doc?.name ?? '')
  const pageCount = useEditor((s) => s.doc?.pages.length ?? 0)
  return (
    <div className="flex min-w-0 flex-col justify-center">
      <h1 className="truncate text-left text-[13.5px] font-semibold leading-5 tracking-[-0.005em] text-fg" title={name} dir="auto">
        {displayName(name)}
      </h1>
      <div className="flex min-w-0 items-center gap-1.5 text-[11.5px] leading-4 text-fg-subtle">
        <span className="shrink-0 tabular-nums">{pluralize(pageCount, 'page')}</span>
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
  if (state === 'idle') return null
  return (
    <span className="flex min-w-0 items-center gap-1.5" aria-live="polite">
      <span aria-hidden>·</span>
      {state === 'saving' && (
        <span className="flex items-center gap-1">
          <Spinner className="size-3" />
          Saving…
        </span>
      )}
      {state === 'saved' && (
        <span className="flex min-w-0 items-center gap-1 animate-fade-in">
          <Check className="size-3 shrink-0 text-success" strokeWidth={3} />
          <span className="truncate max-sm:hidden">Saved on this device</span>
          <span className="sm:hidden">Saved</span>
        </span>
      )}
      {state === 'error' && (
        <Tooltip content={`${error ?? 'Your browser refused to store your changes.'} Download your PDF to keep them.`}>
          <button
            type="button"
            onClick={() => useEditor.getState().openDialog('export')}
            className="flex items-center gap-1 rounded font-medium text-warning hover:underline"
          >
            <TriangleAlert className="size-3 shrink-0" strokeWidth={2.5} />
            Not saved
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
