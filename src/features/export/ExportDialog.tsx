import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { toast } from 'sonner'
import { CircleAlert, CircleCheck, Download, FileText, Info, LockOpen, Printer, Share, TriangleAlert } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { FieldLabel, Spinner, Switch } from '../../components/ui/controls'
import { Dialog } from '../../components/ui/dialog'
import { ExportError } from '../../lib/export/errors'
import { neededPassword } from '../../lib/storage/protectedDocs'
import { cn, isMac } from '../../lib/utils/misc'
import { useEditor, type LoadedDocument } from '../../store/editor'
import { canSharePdf, downloadPdf, printPdf, sharePdf } from './deliver'
import {
  countChangedFields,
  countFilledFields,
  defaultBaseName,
  finalFileName,
  formatFileSize,
  isOpenShortcut,
  isSaveShortcut,
  plural,
  progressLabel,
  quotedList,
  unwrittenFieldLabels,
} from './exportFile'
import { errorMessage, latestExport, prepareExport, resetExport, useExportJob, type ExportStatus } from './exportJob'

const FLATTEN_KEY = 'fillflow:export:flatten'

function readFlatten(): boolean {
  try {
    return localStorage.getItem(FLATTEN_KEY) !== '0'
  } catch {
    return true
  }
}

function writeFlatten(value: boolean) {
  try {
    localStorage.setItem(FLATTEN_KEY, value ? '1' : '0')
  } catch {
    /* storage unavailable */
  }
}

const isCoarsePointer = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
const anotherModalOpen = () => !!document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')

type Action = 'download' | 'share' | 'print'

/** ⌘/Ctrl+S anywhere in the editor opens the dialog (the browser's "Save page" never shows). */
function useSaveShortcut() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !isSaveShortcut(e, isMac)) return
      const s = useEditor.getState()
      if (!s.doc) return
      e.preventDefault()
      if (e.repeat || s.activeDialog || s.load.status !== 'idle' || anotherModalOpen()) return
      s.openDialog('export')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}

/**
 * Download / share / print the filled PDF. Mounted once by EditorScreen; open while
 * `activeDialog === 'export'`. The file is prepared in the background as soon as the dialog
 * opens, so the actions are instant.
 */
export function ExportDialog() {
  useSaveShortcut()
  const open = useEditor((s) => s.activeDialog === 'export' && s.doc !== null)
  const docId = useEditor((s) => s.doc?.id ?? null)
  const docName = useEditor((s) => s.doc?.name ?? 'document.pdf')
  const pageCount = useEditor((s) => s.doc?.pages.length ?? 0)
  const hasFields = useEditor((s) => (s.doc?.formFields.length ?? 0) > 0)
  const itemCount = useEditor((s) => s.elements.length)
  const filledFields = useEditor((s) => (s.activeDialog === 'export' && s.doc ? countFilledFields(s.doc.formFields, s.formValues) : 0))
  const changedFields = useEditor((s) => (s.activeDialog === 'export' && s.doc ? countChangedFields(s.doc.formFields, s.formValues) : 0))
  // Only tracked while open (e.g. a text box committing on blur as the dialog takes focus).
  const revision = useEditor((s) => (s.activeDialog === 'export' ? s.revision : -1))
  const doc = useEditor((s) => s.doc)
  const formValues = useEditor((s) => (s.activeDialog === 'export' ? s.formValues : null))
  const job = useExportJob()

  const [flatten, setFlatten] = useState(readFlatten)
  const [baseName, setBaseName] = useState(() => defaultBaseName(docName))
  const [nameFor, setNameFor] = useState(docId)
  const [action, setAction] = useState<Action | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [canShare] = useState(canSharePdf)
  const inputRef = useRef<HTMLInputElement>(null)
  const formId = useId()
  const nameId = useId()

  const [wasOpen, setWasOpen] = useState(open)

  // A different document gets a fresh default name (an edited name sticks for the same one).
  if (docId !== nameFor) {
    setNameFor(docId)
    setBaseName(defaultBaseName(docName))
  }
  // Every opening starts without leftover messages.
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setNotice(null)
      setActionError(null)
    }
  }

  // Effective flatten setting: irrelevant (and hidden) when the document has no fields.
  const flattenForms = hasFields && flatten

  useEffect(() => {
    if (open) void prepareExport(flattenForms).catch(() => {})
    else resetExport()
  }, [open, flattenForms, revision])

  // A document opened with its password is exported without one (pdf-lib can't write encryption).
  const [unlocked, setUnlocked] = useState<LoadedDocument | null>(null)
  useEffect(() => {
    if (!open || !doc) return
    let live = true
    neededPassword(doc).then(
      (needed) => {
        if (live) setUnlocked(needed ? doc : null)
      },
      () => {},
    )
    return () => {
      live = false
    }
  }, [open, doc])
  const passwordDropped = unlocked !== null && unlocked === doc

  // Values the user entered that the prepared file lacks.
  const notWritten = useMemo(
    () => (job.status === 'ready' && doc && formValues ? unwrittenFieldLabels(doc.formFields, formValues, job.unwritten) : []),
    [job.status, job.unwritten, doc, formValues],
  )

  // ⌘O / ⌘S never open the browser's "Open file" / "Save page" dialogs, wherever focus is in
  // here: the shell's handler never sees the keys stopped below. Like the browser, this goes by
  // the letter the layout types, or by physical key on layouts without Latin letters (Hebrew…).
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (isOpenShortcut(e, isMac) || isSaveShortcut(e, isMac)) e.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [open])

  const close = () => useEditor.getState().closeDialog()
  const fileName = finalFileName(baseName, docName)

  const run = async (kind: Action) => {
    if (action) return
    setAction(kind)
    setNotice(null)
    setActionError(null)
    try {
      const stillOpen = () => useEditor.getState().activeDialog === 'export'
      const bytes = await latestExport(flattenForms, stillOpen)
      // Closed while we were waiting: the user changed their mind.
      if (!stillOpen()) return
      if (kind === 'download') {
        downloadPdf(bytes, fileName)
        toast.success('PDF downloaded', { description: fileName })
        setBaseName(fileName.replace(/\.pdf$/, ''))
        close()
      } else if (kind === 'share') {
        // From here the system share sheet owns the interaction (it may never settle).
        setAction(null)
        const result = await sharePdf(bytes, fileName)
        if (result === 'shared') close()
        else if (result === 'needs-gesture') setNotice('Your PDF is ready — tap Share again to send it.')
      } else {
        const result = printPdf(bytes, fileName)
        if (result === 'tab') toast('Opened in a new tab', { description: 'Print it from your browser’s PDF viewer.' })
        else if (result === 'downloaded') toast('PDF downloaded instead', { description: 'This browser can’t print PDFs directly — print it from your files.' })
      }
    } catch (err) {
      if (err instanceof ExportError && err.code === 'aborted') return
      // Export failures are shown by the job status; anything else (e.g. the share sheet) here.
      if (useExportJob.getState().status !== 'error') {
        console.error(`[export] ${kind} failed`, err)
        setActionError(errorMessage(err))
      }
    } finally {
      setAction(null)
    }
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    void run('download')
  }

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (isSaveShortcut(e.nativeEvent, isMac)) {
      e.preventDefault()
      e.stopPropagation()
      if (!e.repeat) void run('download')
      return
    }
    // Editor shortcuts (Delete, V, ⌘Z…) must not act on the document behind the dialog.
    if (e.key !== 'Escape' && e.key !== 'Tab') e.stopPropagation()
  }

  const onOpenAutoFocus = (e: Event) => {
    e.preventDefault()
    const input = inputRef.current
    // Touch: don't pop up the keyboard; keyboard users get the name selected, ready to edit.
    if (isCoarsePointer() || !input) (e.currentTarget as HTMLElement | null)?.focus({ preventScroll: true })
    else {
      input.focus({ preventScroll: true })
      input.select()
    }
  }

  const toggleFlatten = (value: boolean) => {
    setFlatten(value)
    writeFlatten(value)
  }

  const busy = action !== null
  const nothingAdded = itemCount === 0 && changedFields === 0
  const error = job.status === 'error' ? job.error : actionError

  const footer = (
    <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center" onKeyDown={onKeyDown}>
      <div className="flex gap-2 sm:mr-auto">
        <Button variant="secondary" onClick={() => void run('print')} disabled={busy} className="max-sm:h-10 max-sm:flex-1">
          {action === 'print' ? <Spinner /> : <Printer />}
          Print
        </Button>
        {canShare && (
          <Button variant="secondary" onClick={() => void run('share')} disabled={busy} className="max-sm:h-10 max-sm:flex-1">
            {action === 'share' ? <Spinner /> : <Share />}
            Share…
          </Button>
        )}
      </div>
      <Button type="submit" form={formId} variant="primary" disabled={busy} className="min-w-40 max-sm:h-11 max-sm:w-full">
        {action === 'download' ? <Spinner /> : <Download />}
        {action === 'download' && job.status === 'working' ? 'Preparing…' : 'Download PDF'}
      </Button>
    </div>
  )

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && close()}
      title="Download PDF"
      description="Your filled copy is created right here on your device — the file never leaves it."
      size="md"
      onOpenAutoFocus={onOpenAutoFocus}
      footer={footer}
    >
      <form id={formId} onSubmit={onSubmit} onKeyDown={onKeyDown} noValidate className="flex flex-col gap-5">
        <div>
          <FieldLabel htmlFor={nameId}>File name</FieldLabel>
          <div
            className={cn(
              'flex h-10 items-center overflow-hidden rounded-lg border border-line bg-surface shadow-xs transition-[border-color,box-shadow]',
              'hover:border-line-strong focus-within:border-accent focus-within:ring-3 focus-within:ring-accent/20 focus-within:hover:border-accent',
            )}
          >
            <input
              id={nameId}
              ref={inputRef}
              value={baseName}
              onChange={(e) => setBaseName(e.target.value)}
              onBlur={() => setBaseName((v) => finalFileName(v, docName).replace(/\.pdf$/, ''))}
              placeholder={defaultBaseName(docName)}
              dir="auto"
              spellCheck={false}
              autoComplete="off"
              autoCapitalize="off"
              enterKeyHint="done"
              aria-describedby={`${nameId}-ext`}
              className="h-full min-w-0 flex-1 bg-transparent pl-3 text-base text-fg outline-none placeholder:text-fg-subtle sm:text-sm"
            />
            <span id={`${nameId}-ext`} className="select-none pl-1 pr-3 text-base text-fg-subtle sm:text-sm">
              .pdf
            </span>
          </div>
        </div>

        <FileSummary
          pages={pageCount}
          items={itemCount}
          fields={hasFields ? filledFields : null}
          status={job.status}
          progress={progressLabel(job.progress)}
          size={job.size}
        />

        {hasFields && (
          <Switch
            checked={flatten}
            onCheckedChange={toggleFlatten}
            disabled={busy}
            label="Flatten form fields"
            description="Recommended when sending — values can no longer be edited"
          />
        )}

        {nothingAdded && !error && (flattenForms || !passwordDropped) && (
          <p className="-mt-1 flex gap-2 text-[13px] text-fg-muted">
            <Info className="mt-px size-4 shrink-0 text-fg-subtle" aria-hidden />
            {flattenForms
              ? 'You haven’t added anything yet. The form fields will be flattened, so they can no longer be filled in.'
              : 'You haven’t added anything yet, so the download will match the original file.'}
          </p>
        )}

        {passwordDropped && !error && (
          <p className="-mt-1 flex gap-2 text-[13px] text-fg-muted">
            <LockOpen className="mt-px size-4 shrink-0 text-fg-subtle" aria-hidden />
            The downloaded copy won’t be password-protected: anyone who has the file can open it.
          </p>
        )}

        {notWritten.length > 0 && !error && (
          <div role="status" className="flex gap-2.5 rounded-xl border border-warning/25 bg-warning-soft px-3 py-2.5 text-[13px]">
            <TriangleAlert className="mt-px size-4 shrink-0 text-warning" aria-hidden />
            <div className="min-w-0">
              <p className="font-medium text-fg">{notWritten.length === 1 ? 'A field couldn’t be filled in' : 'Some fields couldn’t be filled in'}</p>
              <p className="mt-0.5 text-fg-muted">The PDF won’t include what you entered in {quotedList(notWritten)}.</p>
            </div>
          </div>
        )}

        {notice && (
          <p role="status" className="flex gap-2 rounded-xl bg-accent-soft px-3 py-2.5 text-[13px] text-fg">
            <Info className="mt-px size-4 shrink-0 text-accent-ink" aria-hidden />
            {notice}
          </p>
        )}

        {error && (
          <div role="alert" className="flex gap-2.5 rounded-xl border border-danger/25 bg-danger-soft px-3 py-2.5 text-[13px]">
            <CircleAlert className="mt-px size-4 shrink-0 text-danger" aria-hidden />
            <div className="min-w-0">
              <p className="font-medium text-fg">Couldn’t create the PDF</p>
              <p className="mt-0.5 text-fg-muted">{error}</p>
            </div>
          </div>
        )}
      </form>
    </Dialog>
  )
}

function FileSummary({
  pages,
  items,
  fields,
  status,
  progress,
  size,
}: {
  pages: number
  items: number
  /** null = the document has no form fields. */
  fields: number | null
  status: ExportStatus
  progress: string
  size: number | null
}) {
  const parts = [plural(pages, 'page'), `${plural(items, 'item')} placed`]
  if (fields !== null) parts.push(`${plural(fields, 'field')} filled`)
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-surface-2 p-3">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-ink">
        <FileText className="size-5" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-fg">
          {parts.map((p, i) => (
            <span key={p} className="whitespace-nowrap">
              {i > 0 && <span className="px-1.5 text-fg-subtle" aria-hidden>·</span>}
              {p}
            </span>
          ))}
        </p>
        <p className="mt-0.5 flex min-h-5 items-center gap-1.5 text-[13px] text-fg-muted empty:hidden" aria-live="polite">
          {status === 'working' && (
            <>
              <Spinner className="size-3.5 text-accent-ink" />
              <span className="truncate">{progress}</span>
            </>
          )}
          {status === 'ready' && (
            <>
              <CircleCheck className="size-3.5 shrink-0 text-success" aria-hidden />
              <span>Ready{size !== null ? ` · ${formatFileSize(size)}` : ''}</span>
            </>
          )}
        </p>
      </div>
    </div>
  )
}
