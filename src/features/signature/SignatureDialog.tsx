import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Tabs } from 'radix-ui'
import { toast } from 'sonner'
import { ImageUp, PenLine, Type, type LucideIcon } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { Spinner } from '../../components/ui/controls'
import { Dialog } from '../../components/ui/dialog'
import { getT, useT } from '../../i18n'
import type { SavedSignature } from '../../lib/storage/db'
import { cn, isEditableTarget, isMac } from '../../lib/utils/misc'
import { useEditor } from '../../store/editor'
import { useMediaQuery } from '../editor/useMediaQuery'
import { shortcutLetter } from '../elements/lib/keys'
import { isOpenShortcut, isSaveShortcut } from '../export/exportFile'
import { viewer } from '../viewer/viewerApi'
import { armPlacement, deleteSavedSignature, placeSavedSignature, releaseTool } from './actions'
import { firstImageFile } from './decode'
import { draftHasContent, SIGNATURE_TABS, useSignatureDraft, type SignatureTab } from './draft'
import { DrawControls, DrawPad } from './DrawPad'
import { fitPadInDialog } from './fit'
import { preloadSignatureFonts, SIGNATURE_FONT_BY_ID } from './fonts'
import { useSavedSignatures, useSignatureLibrary, type SignatureRole } from './library'
import { SaveCheckbox, SavedTile } from './parts'
import { renderDrawing, renderTyped, renderUpload, type RenderedImage } from './render'
import { PEN_SIZES } from './strokes'
import { SHORT_SCREEN } from './styles'
import { TypePad } from './TypePad'
import { UploadPad } from './UploadPad'
import { loadUploadFile } from './upload'

/** The tabs' icons (their names are the interface language's: signature.dialog.tabs). */
const TAB_ICONS: Record<SignatureTab, LucideIcon> = { draw: PenLine, type: Type, upload: ImageUp }

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
  const short = useMediaQuery(SHORT_SCREEN)
  const [busy, setBusy] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  /** It was used (or a saved one picked) from the keyboard: focus goes on to the pages, where Enter places it. */
  const keyed = useRef(false)
  const savedHeadingId = useId()
  const t = useT()
  const d = t.signature.dialog

  useEffect(() => {
    if (!openRole) return
    useSignatureDraft.getState().prefill(openRole)
    void preloadSignatureFonts()
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
      loadUploadFile(openRole, file, file.name || 'Pasted image').catch(() => {
        const { title, description } = getT().signature.dialog.pasteFailed
        toast.error(title, { description })
      })
    }
    window.addEventListener('paste', onPaste, true)
    return () => window.removeEventListener('paste', onPaste, true)
  }, [openRole])

  // Keys anywhere in the dialog, even once focus fell to <body>: ⌘Z undoes the last stroke, and
  // ⌘S / ⌘O never open the browser's "Save page" / "Open file" dialogs (the editor's handlers,
  // which would prevent those, never see the keys the dialog keeps to itself). Like the browser's
  // own shortcuts, letters go by what the layout types, or by physical key where it types no Latin
  // letter (Hebrew…), so this holds on any layout.
  useEffect(() => {
    if (!openRole) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (isSaveShortcut(e, isMac) || isOpenShortcut(e, isMac)) {
        e.preventDefault()
        return
      }
      const undoKey = (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && shortcutLetter(e) === 'z'
      if (!undoKey || isEditableTarget(e.target) || useSignatureDraft.getState().tab !== 'draw') return
      // Not when it's meant for a confirmation on top of the dialog, even once focus fell to <body>
      // there (a press on its backdrop): the last modal opened is the one on top.
      const dialog = bodyRef.current?.closest('[role="dialog"]')
      const modals = document.querySelectorAll('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')
      if (!dialog || modals[modals.length - 1] !== dialog) return
      if (e.target !== document.body && !(e.target instanceof Node && dialog.contains(e.target))) return
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

  const pickSaved = (item: SavedSignature, byKeyboard: boolean) => {
    keyed.current = byKeyboard
    useEditor.getState().closeDialog()
    placeSavedSignature(item)
  }

  const confirm = async (byKeyboard: boolean) => {
    if (busy || !openRole || !draftHasContent(useSignatureDraft.getState(), openRole, useSignatureDraft.getState().tab)) return
    keyed.current = byKeyboard
    setBusy(true)
    try {
      await nextFrame() // let the spinner paint before the (synchronous) rasterization
      const out = await renderActiveTab(openRole)
      // Closed (×) while rendering: the user changed their mind.
      if (useEditor.getState().activeDialog !== openRole) return
      if (!out) {
        const { title, description } = getT().signature.dialog.nothingToUse
        toast.error(title, { description: description[openRole] })
        return
      }
      const draft = useSignatureDraft.getState()
      const editor = useEditor.getState()
      const id = editor.addAsset(out)
      const asset = useEditor.getState().assets[id]
      if (draft.save && asset) {
        useSignatureLibrary
          .getState()
          .add(openRole, asset)
          .catch(() => {
            const { title, description } = getT().signature.dialog.saveFailed
            toast.error(title, { description })
          })
      }
      if (draft.tab === 'type') draft.rememberText(openRole)
      draft.consume(openRole, draft.tab)
      editor.closeDialog()
      armPlacement(openRole, id)
    } catch (err) {
      console.error('[signature] could not create the image', err)
      const { title, description } = getT().signature.dialog.failed
      toast.error(title, { description })
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
    // "Save for next time" at the start (left, or right in a right-to-left interface), the buttons at the end.
    <div className="flex w-full flex-wrap items-center gap-x-2 gap-y-3" onKeyDown={onKeyDown}>
      <SaveCheckbox checked={save} onCheckedChange={setSave} className="me-auto max-sm:w-full" />
      <Button variant="secondary" onClick={close} className="max-sm:flex-1">
        {t.common.cancel}
      </Button>
      {/* Pressing Enter or Space on a button fires a click with no click count. */}
      <Button variant="primary" onClick={(e) => void confirm(e.detail === 0)} disabled={!canUse || busy} className="min-w-32 max-sm:flex-1">
        {busy && <Spinner />}
        {d.use[role]}
      </Button>
    </div>
  )

  return (
    <Dialog
      open={openRole !== null}
      onOpenChange={(next) => !next && close()}
      title={d.title[role]}
      // A short screen has no room to spare for it: there it's only read out.
      description={<span className={cn(short && 'sr-only')}>{d.description}</span>}
      size="lg"
      dismissible={!busy}
      onOpenAutoFocus={onOpenAutoFocus}
      onCloseAutoFocus={(e) => {
        // Back on the dock button, Enter would open this dialog again.
        if (keyed.current && useEditor.getState().placingAssetId !== null) {
          e.preventDefault()
          viewer.getScrollContainer()?.focus({ preventScroll: true })
        }
        keyed.current = false
      }}
      footer={footer}
    >
      <div ref={bodyRef} onKeyDown={onKeyDown}>
        {saved.length > 0 && (
          <section aria-labelledby={savedHeadingId} className="mb-5">
            <h3 id={savedHeadingId} className="mb-2 text-[13px] font-medium text-fg-muted">
              {d.useSaved[role]}
            </h3>
            {/* Newest first, from the start of the row (the right, in a right-to-left interface). */}
            <div data-saved-row className="-m-1 flex gap-2.5 overflow-x-auto p-1 scrollbar-thin">
              {saved.map((item) => (
                <SavedTile
                  key={item.id}
                  item={item}
                  onUse={(e) => pickSaved(item, e.detail === 0)}
                  onDelete={() => void removeSaved(item)}
                  className={cn('h-[72px] shrink-0', role === 'signature' ? 'w-44' : 'w-28')}
                />
              ))}
            </div>
            <div className="mt-5 flex items-center gap-3 text-xs font-medium text-fg-subtle">
              <span className="h-px flex-1 bg-line" />
              {d.createNew[role]}
              <span className="h-px flex-1 bg-line" />
            </div>
          </section>
        )}

        <Tabs.Root ref={fitPadInDialog} value={tab} onValueChange={(v) => setTab(v as SignatureTab)}>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
            <Tabs.List
              aria-label={d.tabsLabel[role]}
              // A pressed tab focuses itself. Without this, Radix takes the press for a click on the
              // list, and the next Tab into the list stops on the list itself (unseen), not the tab.
              onMouseDown={(e) => e.preventDefault()}
              // Touch screens: 40px tabs.
              className="grid h-10 w-full grid-cols-3 items-center rounded-lg bg-surface-3 p-0.5 sm:inline-grid sm:h-9 sm:w-auto pointer-coarse:min-h-11"
            >
              {SIGNATURE_TABS.map((id) => {
                const Icon = TAB_ICONS[id]
                return (
                  <Tabs.Trigger
                    key={id}
                    value={id}
                    className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md px-4 text-[13px] font-medium text-fg-muted transition-colors hover:text-fg data-[state=active]:bg-surface data-[state=active]:text-fg data-[state=active]:shadow-xs sm:h-8 pointer-coarse:min-h-10"
                  >
                    {!short && <Icon className="size-4" />}
                    {d.tabs[id]}
                  </Tabs.Trigger>
                )
              })}
            </Tabs.List>
            {/* Short screen: the drawing controls sit up here, where the pad can't push them out of view
                (at the end of the row: right, or left in a right-to-left interface). */}
            {short && tab === 'draw' && <DrawControls role={role} compact className="ms-auto" />}
          </div>
          <Tabs.Content value="draw" className="mt-4">
            <DrawPad role={role} controls={!short} />
          </Tabs.Content>
          <Tabs.Content value="type" className="mt-4">
            {/* Enter in the name field: on a touch screen, its keyboard's Go key, and a tap places it. */}
            <TypePad role={role} onSubmit={() => void confirm(!isCoarsePointer())} inputRef={nameRef} />
          </Tabs.Content>
          <Tabs.Content value="upload" className="mt-4">
            <UploadPad role={role} />
          </Tabs.Content>
        </Tabs.Root>
      </div>
    </Dialog>
  )
}
