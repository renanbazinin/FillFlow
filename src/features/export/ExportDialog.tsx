import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { toast } from 'sonner'
import { CircleAlert, CircleCheck, Download, FileText, Info, LockOpen, Printer, Share, TriangleAlert } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { FieldLabel, Spinner, Switch } from '../../components/ui/controls'
import { Dialog } from '../../components/ui/dialog'
import { OPEN_OVERLAY } from '../../components/ui/modal'
import { getT, useLocale, useT } from '../../i18n'
import { ExportError } from '../../lib/export/errors'
import { neededPassword } from '../../lib/storage/protectedDocs'
import { firstStrongDirection } from '../../lib/text/direction'
import { cn, isMac } from '../../lib/utils/misc'
import { useEditor, type LoadedDocument } from '../../store/editor'
import { canSharePdf, downloadPdf, printPdf, sharePdf } from './deliver'
import {
  countChangedFields,
  countFilledFields,
  coveredFieldLabels,
  coveredFieldsNote,
  defaultBaseName,
  finalFileName,
  formatFileSize,
  isOpenShortcut,
  isSaveShortcut,
  progressLabel,
  quotedList,
  summaryParts,
  typedFileName,
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
const anotherModalOpen = () => !!document.querySelector(OPEN_OVERLAY)

type Action = 'download' | 'share' | 'print'

/**
 * ⌘/Ctrl+S anywhere in the editor opens the dialog (the browser's "Save page" never shows), but
 * not while another modal or a menu is up: the keyboard is theirs (a menu would stay open over it).
 */
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
  const elements = useEditor((s) => (s.activeDialog === 'export' ? s.elements : null))
  const job = useExportJob()
  const t = useT()
  const locale = useLocale()

  const [flatten, setFlatten] = useState(readFlatten)
  const [baseName, setBaseName] = useState(() => defaultBaseName(docName))
  const [nameFor, setNameFor] = useState({ docId, locale })
  const [action, setAction] = useState<Action | null>(null)
  /** Sharing needs another press (its own went to preparing the file): says so. */
  const [shareAgain, setShareAgain] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [canShare] = useState(canSharePdf)
  const inputRef = useRef<HTMLInputElement>(null)
  const formId = useId()
  const nameId = useId()

  const [wasOpen, setWasOpen] = useState(open)

  // A different document gets a fresh default name (an edited name sticks for the same one), and so
  // does a default name left as it was when the language changes: it ends in one of its words.
  if (docId !== nameFor.docId || locale !== nameFor.locale) {
    setNameFor({ docId, locale })
    if (docId !== nameFor.docId || baseName === defaultBaseName(docName, nameFor.locale)) setBaseName(defaultBaseName(docName, locale))
  }
  // Every opening starts without leftover messages.
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setShareAgain(false)
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

  // Fields under items the user placed are flattened even when flattening is off (they'd hide the items).
  const covered = useMemo(
    () => (hasFields && !flatten && doc && elements ? coveredFieldLabels(doc.formFields, elements) : []),
    [hasFields, flatten, doc, elements],
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
  const placeholder = defaultBaseName(docName, locale)
  // The name's direction, as dir="auto" would pick it (from the placeholder when it's empty).
  const nameDir = firstStrongDirection(baseName || placeholder) ?? 'ltr'

  // Cleaned as it's typed, so the field shows the characters the file gets. Not while a word is
  // being composed, which that would break up: the next change or leaving the field does it.
  const onNameChange = (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.target
    if ((e.nativeEvent as InputEvent).isComposing) {
      setBaseName(input.value)
      return
    }
    const typed = typedFileName(input.value, input.selectionStart ?? input.value.length, input.selectionEnd ?? input.value.length)
    if (typed.value !== input.value) {
      // Replacing the text moves the caret to its end: put it back.
      input.value = typed.value
      input.setSelectionRange(typed.start, typed.end)
    }
    setBaseName(typed.value)
  }

  const run = async (kind: Action) => {
    if (action) return
    // The field shows the exact name the file gets (trimmed, or the default for an empty one).
    setBaseName(fileName.replace(/\.pdf$/, ''))
    setAction(kind)
    setShareAgain(false)
    setActionError(null)
    try {
      const stillOpen = () => useEditor.getState().activeDialog === 'export'
      const bytes = await latestExport(flattenForms, stillOpen)
      // Closed while we were waiting: the user changed their mind.
      if (!stillOpen()) return
      const delivered = getT().export.delivered
      if (kind === 'download') {
        downloadPdf(bytes, fileName)
        // The file's name in its own direction.
        toast.success(delivered.downloaded, { description: <bdi>{fileName}</bdi> })
        close()
      } else if (kind === 'share') {
        // From here the system share sheet owns the interaction (it may never settle).
        setAction(null)
        const result = await sharePdf(bytes, fileName)
        if (result === 'shared') close()
        else if (result === 'needs-gesture') setShareAgain(true)
      } else {
        const result = printPdf(bytes, fileName)
        if (result === 'tab') toast(delivered.printTab.title, { description: delivered.printTab.description })
        else if (result === 'downloaded') toast(delivered.printDownloaded.title, { description: delivered.printDownloaded.description })
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
    // Print and Share at the start (left, or right in a right-to-left interface), Download at the end.
    <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center" onKeyDown={onKeyDown}>
      <div className="flex gap-2 sm:me-auto">
        <Button variant="secondary" onClick={() => void run('print')} disabled={busy} className="max-sm:h-10 max-sm:flex-1">
          {action === 'print' ? <Spinner /> : <Printer />}
          {t.export.actions.print}
        </Button>
        {canShare && (
          <Button variant="secondary" onClick={() => void run('share')} disabled={busy} className="max-sm:h-10 max-sm:flex-1">
            {action === 'share' ? <Spinner /> : <Share />}
            {t.export.actions.share}
          </Button>
        )}
      </div>
      <Button type="submit" form={formId} variant="primary" disabled={busy} className="min-w-40 max-sm:h-11 max-sm:w-full">
        {action === 'download' ? <Spinner /> : <Download />}
        {action === 'download' && job.status === 'working' ? t.export.actions.preparing : t.export.actions.download}
      </Button>
    </div>
  )

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && close()}
      title={t.export.title}
      description={t.export.description}
      size="md"
      onOpenAutoFocus={onOpenAutoFocus}
      footer={footer}
    >
      <form id={formId} onSubmit={onSubmit} onKeyDown={onKeyDown} noValidate className="flex flex-col gap-5">
        <div>
          <FieldLabel htmlFor={nameId}>{t.export.fileName}</FieldLabel>
          {/* The name is what people typed: laid out in its own direction, whatever the interface's, so
              ".pdf" follows its end (left of a Hebrew name, right of an English one). */}
          <div
            dir={nameDir}
            className={cn(
              'flex h-10 items-center overflow-hidden rounded-lg border border-control bg-surface shadow-xs transition-[border-color,box-shadow]',
              'hover:border-fg-subtle focus-within:border-accent focus-within:ring-3 focus-within:ring-accent/20 focus-within:hover:border-accent',
            )}
          >
            <input
              id={nameId}
              ref={inputRef}
              dir="auto"
              value={baseName}
              onChange={onNameChange}
              onBlur={() => setBaseName((v) => finalFileName(v, docName).replace(/\.pdf$/, ''))}
              placeholder={placeholder}
              spellCheck={false}
              autoComplete="off"
              autoCapitalize="off"
              enterKeyHint="done"
              aria-describedby={`${nameId}-ext`}
              className="h-full min-w-0 flex-1 bg-transparent ps-3 text-base text-fg outline-none placeholder:text-fg-subtle sm:text-sm"
            />
            <span id={`${nameId}-ext`} className="select-none ps-1 pe-3 text-base text-fg-subtle sm:text-sm">
              <span dir="ltr">.pdf</span>
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
            label={t.export.flatten}
            description={t.export.flattenHint}
          />
        )}

        {covered.length > 0 && !error && (
          <p className="-mt-1 flex gap-2 text-[13px] text-fg-muted">
            <Info className="mt-px size-4 shrink-0 text-fg-subtle" aria-hidden />
            {coveredFieldsNote(covered)}
          </p>
        )}

        {nothingAdded && !error && (flattenForms || !passwordDropped) && (
          <p className="-mt-1 flex gap-2 text-[13px] text-fg-muted">
            <Info className="mt-px size-4 shrink-0 text-fg-subtle" aria-hidden />
            {flattenForms ? t.export.nothingAdded.flattened : t.export.nothingAdded.unchanged}
          </p>
        )}

        {passwordDropped && !error && (
          <p className="-mt-1 flex gap-2 text-[13px] text-fg-muted">
            <LockOpen className="mt-px size-4 shrink-0 text-fg-subtle" aria-hidden />
            {t.export.passwordDropped}
          </p>
        )}

        {notWritten.length > 0 && !error && (
          <div role="status" className="flex gap-2.5 rounded-xl border border-warning/25 bg-warning-soft px-3 py-2.5 text-[13px]">
            <TriangleAlert className="mt-px size-4 shrink-0 text-warning" aria-hidden />
            <div className="min-w-0">
              <p className="font-medium text-fg">{t.export.unwritten.title(notWritten.length)}</p>
              <p className="mt-0.5 text-fg-muted">{t.export.unwritten.body(quotedList(notWritten), notWritten.length)}</p>
            </div>
          </div>
        )}

        {shareAgain && (
          <p role="status" className="flex gap-2 rounded-xl bg-accent-soft px-3 py-2.5 text-[13px] text-fg">
            <Info className="mt-px size-4 shrink-0 text-accent-ink" aria-hidden />
            {t.export.shareAgain}
          </p>
        )}

        {error && (
          <div role="alert" className="flex gap-2.5 rounded-xl border border-danger/25 bg-danger-soft px-3 py-2.5 text-[13px]">
            <CircleAlert className="mt-px size-4 shrink-0 text-danger" aria-hidden />
            <div className="min-w-0">
              <p className="font-medium text-fg">{t.export.failed}</p>
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
  const t = useT()
  const parts = summaryParts(pages, items, fields)
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-surface-2 p-3">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-ink">
        <FileText className="size-5" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        {/* Wraps between the parts, never inside one. Each part comes after a separator, and the
            one that would start a line is clipped off (the line starts that much further out, to
            the left, or the right in a right-to-left interface). */}
        <div className="overflow-hidden">
          <p className="-ms-4 flex flex-wrap text-sm font-medium text-fg">
            {parts.map((p) => (
              <span key={p} className="whitespace-nowrap">
                <span className="inline-block w-4 select-none text-center text-fg-subtle" aria-hidden>
                  ·
                </span>
                {p}
              </span>
            ))}
          </p>
        </div>
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
              <span>{size !== null ? t.export.summary.readySize(formatFileSize(size)) : t.export.summary.ready}</span>
            </>
          )}
        </p>
      </div>
    </div>
  )
}
