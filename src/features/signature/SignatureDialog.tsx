import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Tabs } from 'radix-ui'
import { toast } from 'sonner'
import { ImageUp, PenLine, Type, type LucideIcon } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { Spinner } from '../../components/ui/controls'
import { Dialog } from '../../components/ui/dialog'
import type { SavedSignature } from '../../lib/storage/db'
import { cn, isEditableTarget, isMac } from '../../lib/utils/misc'
import { useEditor } from '../../store/editor'
import { shortcutLetter } from '../elements/lib/keys'
import { isOpenShortcut, isSaveShortcut } from '../export/exportFile'
import { armPlacement, deleteSavedSignature, placeSavedSignature, releaseTool } from './actions'
import { firstImageFile } from './decode'
import { draftHasContent, SIGNATURE_TABS, useSignatureDraft, type SignatureTab } from './draft'
import { DrawPad } from './DrawPad'
import { preloadSignatureFonts, SIGNATURE_FONT_BY_ID } from './fonts'
import { useSavedSignatures, useSignatureLibrary, type SignatureRole } from './library'
import { SaveCheckbox, SavedTile } from './parts'
import { renderDrawing, renderTyped, renderUpload, type RenderedImage } from './render'
import { PEN_SIZES } from './strokes'
import { TypePad } from './TypePad'
import { UploadPad } from './UploadPad'
import { loadUploadFile } from './upload'

const TABS: Record<SignatureTab, { label: string; icon: LucideIcon }> = {
  draw: { label: 'Draw', icon: PenLine },
  type: { label: 'Type', icon: Type },
  upload: { label: 'Upload', icon: ImageUp },
}

const isCoarsePointer = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()))

/** Renders the active tab's content into the final transparent PNG. */
async function renderActiveTab(role: SignatureRole): Promise<RenderedImage | null> {
  const d = useSignatureDraft.getState()
  if (d.tab === 'draw') return renderDrawing(d.strokes[role], { color: d.color, size: PEN_SIZES[d.pen], role })
  if (d.tab === 'type') return renderTyped(d.text[role], { font: SIGNATURE_FONT_BY_ID[d.font], color: d.color, role })
  const upload = d.upload[role]
  return upload ? renderUpload(upload, role) : null
}

/**
 * Create a signature or initials: saved items first (one click), then Draw / Type / Upload.
 * Mounted once; open while `activeDialog` is 'signature' or 'initials'.
 */
export function SignatureDialog() {
  const activeDialog = useEditor((s) => s.activeDialog)
  const openRole: SignatureRole | null = activeDialog === 'signature' || activeDialog === 'initials' ? activeDialog : null
  // Keep showing the last role while closing.
  const [lastRole, setLastRole] = useState<SignatureRole>('signature')
  if (openRole && openRole !== lastRole) setLastRole(openRole)
  const role = openRole ?? lastRole

  const tab = useSignatureDraft((s) => s.tab)
  const setTab = useSignatureDraft((s) => s.setTab)
  const save = useSignatureDraft((s) => s.save)
  const setSave = useSignatureDraft((s) => s.setSave)
  const canUse = useSignatureDraft((s) => draftHasContent(s, role, s.tab))
  const saved = useSavedSignatures(role)
  const [busy, setBusy] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const savedHeadingId = useId()
  const noun = role === 'signature' ? 'signature' : 'initials'

  useEffect(() => {
    if (!openRole) return
    useSignatureDraft.getState().prefill(openRole)
    void preloadSignatureFonts()
    // Transient toasts sit above dialogs and would cover the sheet's controls on phones.
    toast.dismiss()
  }, [openRole])

  // Pasting an image anywhere in the dialog uploads it (captured first, so the editor's own
  // paste handling never drops it onto the page behind the dialog). Text pasted into a field
  // stays text, even when the clipboard also holds a picture of it (as Office copies do).
  useEffect(() => {
    if (!openRole) return
    const onPaste = (e: ClipboardEvent) => {
      if (isEditableTarget(e.target) && e.clipboardData?.getData('text/plain').trim()) return
      const file = firstImageFile(e.clipboardData?.files) ?? firstImageFile(e.clipboardData?.items)
      if (!file) return
      e.preventDefault()
      e.stopPropagation()
      useSignatureDraft.getState().setTab('upload')
      loadUploadFile(openRole, file, file.name || 'Pasted image').catch(() =>
        toast.error("Couldn't read the pasted image", { description: 'Try saving it as a PNG or JPEG file first.' }),
      )
    }
    window.addEventListener('paste', onPaste, true)
    return () => window.removeEventListener('paste', onPaste, true)
  }, [openRole])

  // Keys anywhere in the dialog, even once focus fell to <body>: ⌘Z undoes the last stroke, and
  // ⌘S / ⌘O never open the browser's "Save page" / "Open file" dialogs (the editor's handlers,
  // which would prevent those, never see the keys the dialog keeps to itself). Letters go by
  // physical key too, like the browser's own shortcuts, so this holds on Hebrew and other layouts.
  useEffect(() => {
    if (!openRole) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (isSaveShortcut(e, isMac) || isOpenShortcut(e, isMac)) {
        e.preventDefault()
        return
      }
      const undoKey = (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && shortcutLetter(e) === 'z'
      if (!undoKey || isEditableTarget(e.target) || useSignatureDraft.getState().tab !== 'draw') return
      // Not when it's meant for a confirmation on top of the dialog.
      const dialog = bodyRef.current?.closest('[role="dialog"]')
      if (e.target !== document.body && !(e.target instanceof Node && dialog?.contains(e.target))) return
      e.preventDefault()
      useSignatureDraft.getState().undoStroke(openRole)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [openRole])

  const close = () => {
    useEditor.getState().closeDialog()
    releaseTool(role)
  }

  const pickSaved = (item: SavedSignature) => {
    useEditor.getState().closeDialog()
    placeSavedSignature(item)
  }

  const confirm = async () => {
    if (busy || !openRole || !draftHasContent(useSignatureDraft.getState(), openRole, useSignatureDraft.getState().tab)) return
    setBusy(true)
    try {
      await nextFrame() // let the spinner paint before the (synchronous) rasterization
      const out = await renderActiveTab(openRole)
      // Closed (×) while rendering: the user changed their mind.
      if (useEditor.getState().activeDialog !== openRole) return
      if (!out) {
        toast.error(`There's nothing to use yet`, { description: `Add your ${noun} first.` })
        return
      }
      const d = useSignatureDraft.getState()
      const editor = useEditor.getState()
      const id = editor.addAsset(out)
      const asset = useEditor.getState().assets[id]
      if (d.save && asset) {
        useSignatureLibrary
          .getState()
          .add(openRole, asset)
          .catch(() => toast.error("Couldn't save it for next time", { description: "This browser isn't allowing local storage." }))
      }
      if (d.tab === 'type') d.rememberText(openRole)
      d.consume(openRole, d.tab)
      editor.closeDialog()
      armPlacement(openRole, id)
    } catch (err) {
      console.error('[signature] could not create the image', err)
      toast.error('Something went wrong', { description: 'Please try again.' })
    } finally {
      setBusy(false)
    }
  }

  const onKeyDown = (e: ReactKeyboardEvent) => {
    // Editor shortcuts (Delete, V, ⌘Z…) must not act on the document behind the dialog.
    if (e.key !== 'Escape' && e.key !== 'Tab') e.stopPropagation()
  }

  const removeSaved = async (item: SavedSignature) => {
    const from = document.activeElement
    await deleteSavedSignature(item)
    // The tile may be gone once the confirmation closes: keep focus in the dialog, on the pressed ×
    // while it's still there. Runs after the confirmation's own focus return, and keeps it if it
    // landed in the dialog.
    setTimeout(() => {
      const dialog = bodyRef.current?.closest('[role="dialog"]')
      const active = document.activeElement
      if (!dialog || (active !== dialog && dialog.contains(active))) return
      const target =
        from instanceof HTMLElement && from !== dialog && dialog.contains(from)
          ? from
          : (bodyRef.current?.querySelector<HTMLElement>('[data-saved-row] button') ??
            bodyRef.current?.querySelector<HTMLElement>('[role="tab"][data-state="active"]'))
      target?.focus()
    }, 0)
  }

  const onOpenAutoFocus = (e: Event) => {
    const body = bodyRef.current
    if (!body) return
    e.preventDefault()
    // Touch: focus the sheet itself (no keyboard popping up, no stray focus ring).
    const target = isCoarsePointer()
      ? (e.currentTarget as HTMLElement | null)
      : (body.querySelector<HTMLElement>('[data-saved-row] button') ??
        (useSignatureDraft.getState().tab === 'type' ? nameRef.current : null) ??
        body.querySelector<HTMLElement>('[role="tab"][data-state="active"]'))
    target?.focus({ preventScroll: true })
  }

  const footer = (
    <div className="flex w-full flex-wrap items-center gap-x-2 gap-y-3" onKeyDown={onKeyDown}>
      <SaveCheckbox checked={save} onCheckedChange={setSave} className="mr-auto max-sm:w-full" />
      <Button variant="secondary" onClick={close} className="max-sm:flex-1">
        Cancel
      </Button>
      <Button variant="primary" onClick={() => void confirm()} disabled={!canUse || busy} className="min-w-32 max-sm:flex-1">
        {busy && <Spinner />}
        {role === 'signature' ? 'Use signature' : 'Use initials'}
      </Button>
    </div>
  )

  return (
    <Dialog
      open={openRole !== null}
      onOpenChange={(next) => !next && close()}
      title={role === 'signature' ? 'Add your signature' : 'Add your initials'}
      description="Draw, type or upload it. It never leaves your device."
      size="lg"
      dismissible={!busy}
      onOpenAutoFocus={onOpenAutoFocus}
      footer={footer}
    >
      <div ref={bodyRef} onKeyDown={onKeyDown}>
        {saved.length > 0 && (
          <section aria-labelledby={savedHeadingId} className="mb-5">
            <h3 id={savedHeadingId} className="mb-2 text-[13px] font-medium text-fg-muted">
              {role === 'signature' ? 'Use a saved signature' : 'Use your saved initials'}
            </h3>
            <div data-saved-row className="-m-1 flex gap-2.5 overflow-x-auto p-1 scrollbar-thin">
              {saved.map((item) => (
                <SavedTile
                  key={item.id}
                  item={item}
                  onUse={() => pickSaved(item)}
                  onDelete={() => void removeSaved(item)}
                  className={cn('h-[72px] shrink-0', role === 'signature' ? 'w-44' : 'w-28')}
                />
              ))}
            </div>
            <div className="mt-5 flex items-center gap-3 text-xs font-medium text-fg-subtle">
              <span className="h-px flex-1 bg-line" />
              or create a new one
              <span className="h-px flex-1 bg-line" />
            </div>
          </section>
        )}

        <Tabs.Root value={tab} onValueChange={(v) => setTab(v as SignatureTab)}>
          <Tabs.List
            aria-label={`How to create your ${noun}`}
            className="grid h-10 w-full grid-cols-3 items-center rounded-lg bg-surface-3 p-0.5 sm:inline-grid sm:h-9 sm:w-auto"
          >
            {SIGNATURE_TABS.map((t) => {
              const { label, icon: Icon } = TABS[t]
              return (
                <Tabs.Trigger
                  key={t}
                  value={t}
                  className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md px-4 text-[13px] font-medium text-fg-muted transition-colors hover:text-fg data-[state=active]:bg-surface data-[state=active]:text-fg data-[state=active]:shadow-xs sm:h-8"
                >
                  <Icon className="size-4" />
                  {label}
                </Tabs.Trigger>
              )
            })}
          </Tabs.List>
          <Tabs.Content value="draw" className="mt-4">
            <DrawPad role={role} />
          </Tabs.Content>
          <Tabs.Content value="type" className="mt-4">
            <TypePad role={role} onSubmit={() => void confirm()} inputRef={nameRef} />
          </Tabs.Content>
          <Tabs.Content value="upload" className="mt-4">
            <UploadPad role={role} />
          </Tabs.Content>
        </Tabs.Root>
      </div>
    </Dialog>
  )
}
