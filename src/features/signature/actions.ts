import { useEffect, useRef, type RefObject } from 'react'
import { toast } from 'sonner'
import { confirm } from '../../components/ui/confirm'
import type { SavedSignature } from '../../lib/storage/db'
import type { ImageRole } from '../../model/types'
import { useEditor } from '../../store/editor'
import { useSignatureLibrary } from './library'

const PLACE_TOAST_ID = 'fillflow:place-asset'

const isCoarsePointer = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches

/** Leaves the role's tool when nothing is armed (the chooser was dismissed). */
export function releaseTool(role: ImageRole): void {
  const s = useEditor.getState()
  if (s.tool === role && s.placingAssetId === null) s.setTool('select')
}

/**
 * Arms the signature / initials / image tool with an asset and hints where to click. The hint
 * is skipped when another feature consumed the asset right away (e.g. a form signature field),
 * and dismissed as soon as the asset is placed or the tool changes.
 */
export function armPlacement(role: ImageRole, assetId: string): void {
  useEditor.getState().startPlacingAsset(role, assetId)
  setTimeout(() => {
    if (useEditor.getState().placingAssetId !== assetId) return
    toast(isCoarsePointer() ? 'Tap where you want to place it' : 'Click where you want to place it', {
      id: PLACE_TOAST_ID,
      duration: 4000,
      action: {
        label: 'Cancel',
        onClick: () => {
          const s = useEditor.getState()
          if (s.placingAssetId === assetId) s.setTool('select')
        },
      },
    })
    const unsubscribe = useEditor.subscribe(
      (s) => s.placingAssetId,
      (id) => {
        if (id === assetId) return
        toast.dismiss(PLACE_TOAST_ID)
        unsubscribe()
      },
    )
  }, 0)
}

/** Places a saved signature: reuses its asset id, so the document never stores duplicates. */
export function placeSavedSignature(item: SavedSignature): void {
  useEditor.getState().addAsset({ ...item.asset })
  armPlacement(item.role, item.asset.id)
}

/** Asks, then removes a saved item from this device. Resolves true when it was deleted. */
export async function deleteSavedSignature(item: SavedSignature): Promise<boolean> {
  const ok = await confirm({
    title: item.role === 'signature' ? 'Delete this signature?' : 'Delete these initials?',
    description: 'It will be removed from this device. Documents you already signed are not affected.',
    confirmLabel: 'Delete',
    danger: true,
  })
  if (!ok) return false
  try {
    await useSignatureLibrary.getState().remove(item.id)
    return true
  } catch {
    toast.error("Couldn't delete it", { description: 'Please try again.' })
    return false
  }
}

// ---------------------------------------------------------------------------
// Tool activation without an armed asset (keyboard shortcuts set `tool` directly).
// Several docks may mount the same button (e.g. desktop + mobile); only one responds:
// the first visible one, else the first mounted.
// ---------------------------------------------------------------------------

type ActivatableTool = 'signature' | 'initials' | 'image'

interface Target {
  ref: RefObject<HTMLElement | null>
}

const targets: Record<ActivatableTool, Target[]> = { signature: [], initials: [], image: [] }

function isVisible(el: HTMLElement | null): boolean {
  return !!el && el.isConnected && el.getClientRects().length > 0
}

function pickTarget(tool: ActivatableTool): Target | undefined {
  const list = targets[tool]
  return list.find((t) => isVisible(t.ref.current)) ?? list[0]
}

/**
 * Calls `onActivate` when the store's tool switches to `tool` with no asset armed (e.g. the
 * S / I / G shortcuts). It runs synchronously inside that store update, so a key press still
 * counts as user activation (needed to open a file picker).
 */
export function useToolActivation(tool: ActivatableTool, ref: RefObject<HTMLElement | null>, onActivate: () => void): void {
  const handler = useRef(onActivate)
  useEffect(() => {
    handler.current = onActivate
  })
  useEffect(() => {
    const target: Target = { ref }
    targets[tool].push(target)
    const unsubscribe = useEditor.subscribe(
      (s) => s.tool,
      (next, prev) => {
        if (next !== tool || prev === tool) return
        if (useEditor.getState().placingAssetId !== null) return
        if (pickTarget(tool) !== target) return
        handler.current()
      },
    )
    return () => {
      unsubscribe()
      targets[tool] = targets[tool].filter((t) => t !== target)
    }
  }, [tool, ref])
}
