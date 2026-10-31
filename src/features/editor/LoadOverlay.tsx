import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { CircleAlert, Eye, EyeOff, FileText, FolderOpen, LockKeyhole } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { Input, Spinner } from '../../components/ui/controls'
import { Dialog } from '../../components/ui/dialog'
import { cn } from '../../lib/utils/misc'
import { useEditor, type LoadedDocument } from '../../store/editor'
import { chooseAndOpenPdf } from '../home/openFile'
import { displayName } from '../home/pdfFiles'

/** How long an open runs before the "Opening…" card offers to cancel it. */
const CANCEL_AFTER_MS = 3000

/** Dialogs (the "Opening…" card is one), menus and popovers: each owns the keyboard while it has focus. */
const OVERLAY = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]'

/**
 * What had focus when the "Opening…" card took it, and the document then on screen. Focus goes
 * back there when the open is given up: cancelled, or ended in the password prompt or an error
 * that is then closed. Not once a document has opened.
 */
let returnFocus: { el: HTMLElement; doc: LoadedDocument | null } | null = null

function restoreFocus(): boolean {
  const saved = returnFocus
  returnFocus = null
  if (!saved?.el.isConnected || saved.doc !== useEditor.getState().doc) return false
  saved.el.focus({ preventScroll: true })
  return true
}

/** For the prompt and the error dialog that end an open: see `returnFocus`. */
const restoreFocusOnClose = (e: Event) => {
  if (restoreFocus()) e.preventDefault()
}

/**
 * Renders the global load state: a delayed "Opening…" card, the password prompt, and the
 * load-error dialog.
 */
export function LoadOverlay() {
  const load = useEditor((s) => s.load)
  // While the password from the prompt is being tried, keep the prompt up (with a busy button)
  // instead of flashing the generic loading card.
  const unlocking = load.status === 'loading' && load.unlocking === true

  const showPassword = load.status === 'password' || unlocking
  return (
    <>
      {load.status === 'loading' && !unlocking && <LoadingCard fileName={load.fileName} />}
      {/* Mounted only while needed, so every prompt starts with an empty field. */}
      {showPassword && (
        <PasswordDialog
          fileName={'fileName' in load ? load.fileName : ''}
          incorrect={load.status === 'password' && load.incorrect}
          busy={unlocking}
          onSubmit={(password) => void useEditor.getState().submitPassword(password)}
          // Also while a password is being tried: the attempt is then dropped.
          onCancel={() => useEditor.getState().cancelOpen()}
        />
      )}
      <ErrorDialog
        open={load.status === 'error'}
        fileName={load.status === 'error' ? load.fileName : ''}
        message={load.status === 'error' ? load.message : ''}
      />
    </>
  )
}

function LoadingCard({ fileName }: { fileName: string }) {
  const [slow, setSlow] = useState(false)
  const card = useRef<HTMLDivElement>(null)
  const cancelButton = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const nameId = useId()

  // The card owns the keyboard while it blocks the pointer: keys typed while a document opens
  // must not change the one on screen, which the new copy replaces (it would never show those
  // changes, and would save over them). So, as a dialog (the editor's shortcuts leave keys in a
  // dialog alone), it takes focus and keeps it, Tab included, unless a dialog, menu or popover
  // has it. Toasts don't keep it either: keys there would reach the shortcuts.
  useLayoutEffect(() => {
    const el = card.current
    if (!el) return
    const active = document.activeElement
    if (active instanceof HTMLElement && active !== document.body && !active.closest(OVERLAY)) {
      returnFocus = { el: active, doc: useEditor.getState().doc }
    }
    const keep = () => {
      if (!document.activeElement?.closest(OVERLAY)) el.focus({ preventScroll: true })
    }
    keep()
    // Focus moving out (a press on a toast, a dialog handing focus back as it closes), and a key
    // or a paste while nothing has focus, which would go to the page.
    const events = ['keydown', 'paste', 'cut'] as const
    document.addEventListener('focusin', keep)
    for (const type of events) window.addEventListener(type, keep, true)
    return () => {
      document.removeEventListener('focusin', keep)
      for (const type of events) window.removeEventListener(type, keep, true)
      // Given up on: back to where the user was. (The prompt or the error dialog that ends an
      // open does this as it closes; an open that applied leaves focus alone.)
      if (useEditor.getState().load.status === 'idle') restoreFocus()
    }
  }, [])

  // An open that takes long (or never ends) can be given up.
  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), CANCEL_AFTER_MS)
    return () => window.clearTimeout(timer)
  }, [])
  useEffect(() => {
    if (!slow) return
    const onKeyDown = (e: KeyboardEvent) => {
      // Escape in a dialog, menu or popover that has focus is theirs.
      if (e.key !== 'Escape' || e.defaultPrevented || !card.current?.contains(document.activeElement)) return
      e.preventDefault()
      useEditor.getState().cancelOpen()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [slow])

  const keepTabInside = (e: ReactKeyboardEvent) => {
    if (e.key !== 'Tab') return
    e.preventDefault()
    cancelButton.current?.focus()
  }

  return (
    // Fades in after a short delay so quick opens don't flash; it still blocks input at once.
    <div
      ref={card}
      role="dialog"
      aria-modal
      aria-labelledby={titleId}
      aria-describedby={nameId}
      tabIndex={-1}
      onKeyDown={keepTabInside}
      className="fixed inset-0 z-[85] grid place-items-center bg-overlay/60 p-6 opacity-0 outline-none animate-fade-in [animation-delay:150ms] [animation-duration:200ms] [animation-fill-mode:forwards]"
    >
      <div className="flex max-w-[min(92vw,420px)] items-center gap-3.5 rounded-2xl border border-line bg-surface py-3.5 pl-4 pr-5 shadow-overlay animate-scale-in [animation-delay:150ms] [animation-fill-mode:both]">
        <div className="relative grid size-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent-ink">
          <FileText className="size-[18px]" strokeWidth={1.9} />
          <Spinner className="absolute -bottom-1 -right-1 size-[18px] rounded-full bg-surface p-[2px] text-accent" />
        </div>
        <div className="min-w-0 flex-1">
          <div id={titleId} className="text-[13.5px] font-semibold text-fg">
            Opening…
          </div>
          <div id={nameId} className="truncate text-[12.5px] text-fg-muted" dir="auto" title={fileName}>
            {displayName(fileName)}
          </div>
        </div>
        {slow && (
          <Button
            ref={cancelButton}
            variant="secondary"
            size="sm"
            onClick={() => useEditor.getState().cancelOpen()}
            aria-keyshortcuts="Escape"
            className="-mr-1.5 animate-fade-in"
          >
            Cancel
          </Button>
        )}
      </div>
    </div>
  )
}

function PasswordDialog({
  fileName,
  incorrect,
  busy,
  onSubmit,
  onCancel,
}: {
  fileName: string
  incorrect: boolean
  busy: boolean
  onSubmit: (password: string) => void
  onCancel: () => void
}) {
  const [password, setPassword] = useState('')
  const [reveal, setReveal] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // After a wrong attempt: select the text so the next try replaces it.
  useEffect(() => {
    if (incorrect && !busy) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [incorrect, busy])

  const close = () => onCancel()

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && close()}
      size="sm"
      title={<IconTitle icon={<LockKeyhole />}>This PDF is password&#8209;protected</IconTitle>}
      description={
        <>
          {/* <bdi>: a right-to-left name keeps its own order inside the English sentence. */}
          Enter the password to open <bdi className="font-medium text-fg">{displayName(fileName)}</bdi>.
        </>
      }
      onOpenAutoFocus={(e) => {
        e.preventDefault()
        inputRef.current?.focus()
      }}
      onCloseAutoFocus={restoreFocusOnClose}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="ff-password-form" disabled={!password || busy} className="min-w-20">
            {busy ? <Spinner /> : 'Open'}
          </Button>
        </>
      }
    >
      <form
        id="ff-password-form"
        onSubmit={(e) => {
          e.preventDefault()
          if (password && !busy) onSubmit(password)
        }}
        className="pb-1"
      >
        <label htmlFor="ff-pdf-password" className="sr-only">
          Password
        </label>
        <div className="relative">
          <Input
            ref={inputRef}
            id="ff-pdf-password"
            type={reveal ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
            aria-invalid={incorrect || undefined}
            aria-describedby={incorrect ? 'ff-pdf-password-error' : undefined}
            className="h-10 pr-10 aria-[invalid]:border-danger aria-[invalid]:focus:ring-danger/20"
          />
          <button
            type="button"
            onClick={() => setReveal((r) => !r)}
            aria-label={reveal ? 'Hide password' : 'Show password'}
            className="absolute right-1 top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-fg-subtle hover:bg-surface-3 hover:text-fg"
          >
            {reveal ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
        {incorrect && !busy && (
          <p id="ff-pdf-password-error" role="alert" className="mt-2 flex items-center gap-1.5 text-[13px] text-danger">
            <CircleAlert className="size-3.5 shrink-0" />
            That password isn’t right. Please try again.
          </p>
        )}
      </form>
    </Dialog>
  )
}

function ErrorDialog({ open, fileName, message }: { open: boolean; fileName: string; message: string }) {
  const dismiss = () => useEditor.getState().dismissLoadError()
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && dismiss()}
      size="sm"
      title={
        <IconTitle icon={<CircleAlert />} danger>
          Couldn’t open this file
        </IconTitle>
      }
      description={message}
      onCloseAutoFocus={restoreFocusOnClose}
      footer={
        <>
          <Button variant="secondary" onClick={dismiss}>
            Close
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              dismiss()
              void chooseAndOpenPdf()
            }}
          >
            <FolderOpen />
            Try another file
          </Button>
        </>
      }
    >
      {fileName && (
        <div className="mb-1 flex items-center gap-2.5 rounded-xl border border-line bg-surface-2 px-3 py-2.5">
          <FileText className="size-4 shrink-0 text-fg-subtle" />
          <span className="min-w-0 truncate text-[13px] font-medium text-fg" dir="auto" title={fileName}>
            {fileName}
          </span>
        </div>
      )}
    </Dialog>
  )
}

/** Dialog title with a soft icon tile above it. */
function IconTitle({ icon, danger, children }: { icon: ReactNode; danger?: boolean; children: ReactNode }) {
  return (
    <span className="flex flex-col items-start gap-3.5">
      <span
        className={cn(
          'grid size-10 place-items-center rounded-xl [&_svg]:size-5',
          danger ? 'bg-danger-soft text-danger' : 'bg-accent-soft text-accent-ink',
        )}
      >
        {icon}
      </span>
      <span>{children}</span>
    </span>
  )
}
