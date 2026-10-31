import { useEffect, useRef, useState, type ReactNode } from 'react'
import { CircleAlert, Eye, EyeOff, FileText, FolderOpen, LockKeyhole } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { Input, Spinner } from '../../components/ui/controls'
import { Dialog } from '../../components/ui/dialog'
import { cn } from '../../lib/utils/misc'
import { useEditor } from '../../store/editor'
import { chooseAndOpenPdf } from '../home/openFile'
import { displayName } from '../home/pdfFiles'

/**
 * Renders the global load state: a delayed "Opening…" card, the password prompt, and the
 * load-error dialog.
 */
export function LoadOverlay() {
  const load = useEditor((s) => s.load)
  // While a password attempt is in flight the store reports 'loading'; keep the password
  // dialog up (with a busy button) instead of flashing the generic loading card.
  const [pwBusy, setPwBusy] = useState(false)

  const showPassword = load.status === 'password' || (pwBusy && load.status === 'loading')
  return (
    <>
      {load.status === 'loading' && !pwBusy && <LoadingCard fileName={load.fileName} />}
      {/* Mounted only while needed, so every prompt starts with an empty field. */}
      {showPassword && (
        <PasswordDialog
          fileName={'fileName' in load ? load.fileName : ''}
          incorrect={load.status === 'password' && load.incorrect}
          busy={pwBusy}
          onSubmit={async (password) => {
            setPwBusy(true)
            try {
              await useEditor.getState().submitPassword(password)
            } finally {
              setPwBusy(false)
            }
          }}
          onCancel={() => void useEditor.getState().submitPassword(null)}
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
  return (
    // Fades in after a short delay so quick opens don't flash; it still blocks input at once.
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-[85] grid place-items-center bg-overlay/60 p-6 opacity-0 animate-fade-in [animation-delay:150ms] [animation-duration:200ms] [animation-fill-mode:forwards]"
    >
      <div className="flex max-w-[min(92vw,420px)] items-center gap-3.5 rounded-2xl border border-line bg-surface py-3.5 pl-4 pr-5 shadow-overlay animate-scale-in [animation-delay:150ms] [animation-fill-mode:both]">
        <div className="relative grid size-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent-ink">
          <FileText className="size-[18px]" strokeWidth={1.9} />
          <Spinner className="absolute -bottom-1 -right-1 size-[18px] rounded-full bg-surface p-[2px] text-accent" />
        </div>
        <div className="min-w-0">
          <div className="text-[13.5px] font-semibold text-fg">Opening…</div>
          <div className="truncate text-[12.5px] text-fg-muted" dir="auto" title={fileName}>
            {displayName(fileName)}
          </div>
        </div>
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
  onSubmit: (password: string) => Promise<void>
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
      onOpenChange={(o) => !o && !busy && close()}
      size="sm"
      dismissible={!busy}
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
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={busy}>
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
          if (password && !busy) void onSubmit(password)
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
