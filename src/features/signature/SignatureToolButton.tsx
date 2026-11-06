import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { toast } from 'sonner'
import { Plus } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/menu'
import { dismissPassingToasts } from '../../components/ui/toasts'
import type { SavedSignature } from '../../lib/storage/db'
import { cn } from '../../lib/utils/misc'
import { TOOL_BY_ID } from '../../model/tools'
import { useEditor } from '../../store/editor'
import { ToolButton } from '../editor/ToolButton'
import { viewer } from '../viewer/viewerApi'
import { armPlacement, deleteSavedSignature, placeSavedSignature, releaseTool, useToolActivation } from './actions'
import { importImageAsset } from './decode'
import { savedFor, useSavedSignatures, useSignatureLibrary, type SignatureRole } from './library'
import { SavedTile } from './parts'

type Side = 'top' | 'bottom' | 'left' | 'right'

export interface DockButtonProps {
  /** Show the text label under the icon (wide docks). */
  showLabel?: boolean
  tooltipSide?: Side
  className?: string
}

/**
 * Dock button for the signature / initials tools. With saved items it opens a popover of
 * one-click tiles (plus "New…"); with nothing saved it opens the creation dialog directly.
 * Also responds to the S / I shortcuts (the store's tool switching to `role`).
 */
export function SignatureToolButton({
  role,
  showLabel,
  tooltipSide = 'top',
  popoverSide = 'top',
  className,
}: { role: SignatureRole; popoverSide?: Side } & DockButtonProps) {
  const active = useEditor((s) => s.tool === role)
  const items = useSavedSignatures(role)
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  /** A delete confirmation is up: keep the popover open while focus visits it. */
  const confirming = useRef(false)
  /** The popover closed to hand over to placement or the dialog: don't refocus the button. */
  const handedOff = useRef(false)
  /** A saved one was picked from the keyboard: focus goes on to the pages, where Enter places it. */
  const keyed = useRef(false)
  /** The last activation came from a mouse / touch press on the button. */
  const pressed = useRef(false)
  const noun = role === 'signature' ? 'signature' : 'initials'

  const activate = useCallback(() => {
    void useSignatureLibrary
      .getState()
      .load()
      .then(() => {
        if (!savedFor(role).length) {
          // A clicked button would get focus back when the dialog closes, popping its tooltip
          // over the placement hint. Keyboard users keep the usual focus return.
          if (pressed.current) triggerRef.current?.blur()
          useEditor.getState().openDialog(role)
          return
        }
        // The list opens where passing toasts sit, and any left up would cover its tiles: clear them all.
        // The messages that stay until acted on (Reload) have a stack of their own under the top bar,
        // and stay. A passing autosave failure still shows in the title's save status.
        dismissPassingToasts()
        setOpen(true)
      })
  }, [role])

  useToolActivation(role, triggerRef, activate)

  const onOpenChange = (next: boolean) => {
    if (next) {
      activate()
      return
    }
    setOpen(false)
    releaseTool(role)
  }

  const use = (item: SavedSignature, byKeyboard: boolean) => {
    handedOff.current = true
    keyed.current = byKeyboard
    setOpen(false)
    placeSavedSignature(item)
  }

  const createNew = (byKeyboard: boolean) => {
    handedOff.current = true
    // The dialog gives focus back to what had it when it opened, and this popover will be gone by
    // then: move keyboard focus to the dock button first. (Clicks get no focus back, as in `activate`.)
    if (byKeyboard) triggerRef.current?.focus({ preventScroll: true })
    setOpen(false)
    useEditor.getState().openDialog(role)
  }

  const remove = async (item: SavedSignature) => {
    confirming.current = true
    try {
      await deleteSavedSignature(item)
    } finally {
      confirming.current = false
    }
    // The tile may be gone: keep keyboard focus inside the popover. Runs after the confirmation's
    // own focus return, and keeps it if it landed in the popover.
    setTimeout(() => {
      const content = contentRef.current
      if (!content || content.contains(document.activeElement)) return
      content.querySelector<HTMLElement>('[data-saved-tile] button, [data-new]')?.focus()
    }, 0)
  }

  const keepOpen = (e: Event) => {
    if (confirming.current) e.preventDefault()
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <ToolButton
          ref={triggerRef}
          tool={TOOL_BY_ID[role]}
          active={active || open}
          showLabel={showLabel}
          tooltipSide={tooltipSide}
          className={className}
          onPointerDown={() => (pressed.current = true)}
          onKeyDown={() => (pressed.current = false)}
          // Focus coming back while a signature waits to be placed (the dialog closed on "Use"): its
          // tooltip would cover the placement hint.
          onFocus={(e) => useEditor.getState().placingAssetId !== null && e.preventDefault()}
        />
      </PopoverTrigger>
      <PopoverContent
        ref={contentRef}
        side={popoverSide}
        aria-label={role === 'signature' ? 'Saved signatures' : 'Saved initials'}
        onFocusOutside={keepOpen}
        onInteractOutside={keepOpen}
        onCloseAutoFocus={(e) => {
          if (handedOff.current) e.preventDefault()
          // Back on the dock button, Enter would open this list again.
          if (keyed.current && useEditor.getState().placingAssetId !== null) viewer.getScrollContainer()?.focus({ preventScroll: true })
          handedOff.current = false
          keyed.current = false
        }}
        className="w-[min(calc(100vw-16px),344px)] p-0"
      >
        <div className="flex items-baseline justify-between gap-3 px-3 pb-2 pt-3">
          <div className="text-[13px] font-semibold text-fg">{role === 'signature' ? 'Your signatures' : 'Your initials'}</div>
          {items.length > 0 && <div className="text-xs text-fg-subtle">Pick one to place it</div>}
        </div>
        {items.length > 0 ? (
          <div
            className={cn(
              'grid max-h-[min(46dvh,312px)] gap-2 overflow-y-auto px-3 pb-3 pt-0.5 scrollbar-thin',
              role === 'signature' ? 'grid-cols-2' : 'grid-cols-3',
            )}
          >
            {items.map((item) => (
              <SavedTile
                key={item.id}
                item={item}
                onUse={(e) => use(item, e.detail === 0)}
                onDelete={() => void remove(item)}
                className="h-[72px]"
              />
            ))}
          </div>
        ) : (
          <p className="px-3 pb-3 text-[13px] text-fg-muted">Nothing saved yet. Create one and tick “Save for next time”.</p>
        )}
        <div className="border-t border-line p-1.5">
          {/* Pressing Enter or Space on a button fires a click with no click count. */}
          <Button data-new variant="ghost" size="sm" onClick={(e) => createNew(e.detail === 0)} className="w-full justify-start text-fg">
            <Plus />
            {role === 'signature' ? 'New signature' : 'New initials'}
          </Button>
        </div>
        <span className="sr-only" aria-live="polite">
          {items.length} saved {noun}
        </span>
      </PopoverContent>
    </Popover>
  )
}

/**
 * Dock button for the image tool: pick a picture, which becomes an asset ready to place.
 * Also responds to the G shortcut (the store's tool switching to 'image').
 */
export function ImageToolButton({ showLabel, tooltipSide = 'top', className }: DockButtonProps) {
  const active = useEditor((s) => s.tool === 'image')
  const [busy, setBusy] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const pressed = useRef(false)
  /** The button was pressed from the keyboard: once a picture is chosen, focus goes on to the pages. */
  const keyed = useRef(false)

  const openPicker = useCallback((fromShortcut: boolean, byKeyboard = false) => {
    const input = inputRef.current
    if (!input) return
    input.value = ''
    keyed.current = byKeyboard
    // The closing picker refocuses the clicked button, which would pop its tooltip over the
    // placement hint. Keyboard users keep their focus.
    if (!fromShortcut && pressed.current) buttonRef.current?.blur()
    if (typeof input.showPicker !== 'function') {
      input.click()
      return
    }
    try {
      input.showPicker()
    } catch {
      // No user activation (the shortcut didn't come from a key press we can use).
      if (fromShortcut) {
        releaseTool('image')
        toast('Choose a picture with the Image button', { description: 'Your browser blocked opening the file picker from the shortcut.' })
      } else {
        input.click()
      }
    }
  }, [])

  useToolActivation('image', buttonRef, () => openPicker(true))

  // Closing the picker without a file leaves the tool.
  useEffect(() => {
    const input = inputRef.current
    if (!input) return
    const onCancel = () => releaseTool('image')
    input.addEventListener('cancel', onCancel)
    return () => input.removeEventListener('cancel', onCancel)
  }, [])

  const onChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true)
    const slow = setTimeout(() => toast.loading('Preparing image…', { id: 'fillflow:image-import' }), 300)
    try {
      if (file.type && !file.type.startsWith('image/')) throw new Error('not an image')
      const asset = await importImageAsset(file)
      const id = useEditor.getState().addAsset(asset)
      armPlacement('image', id)
      // Back on the button, Enter would open the picker again; on the pages, it places the picture.
      // (Unless focus has moved on meanwhile.)
      const focused = document.activeElement
      if (keyed.current && (focused === buttonRef.current || focused === document.body)) viewer.getScrollContainer()?.focus({ preventScroll: true })
    } catch {
      releaseTool('image')
      toast.error("This image couldn't be opened", { description: 'Try a PNG, JPEG, WebP or GIF file.' })
    } finally {
      clearTimeout(slow)
      toast.dismiss('fillflow:image-import')
      setBusy(false)
    }
  }

  return (
    <>
      <ToolButton
        ref={buttonRef}
        tool={TOOL_BY_ID.image}
        active={active}
        aria-busy={busy || undefined}
        showLabel={showLabel}
        tooltipSide={tooltipSide}
        className={className}
        onPointerDown={() => (pressed.current = true)}
        onKeyDown={() => (pressed.current = false)}
        // Pressing Enter or Space on a button fires a click with no click count.
        onClick={(e) => openPicker(false, e.detail === 0)}
      />
      <input ref={inputRef} type="file" accept="image/*" tabIndex={-1} aria-hidden className="sr-only" onChange={onChange} />
    </>
  )
}
