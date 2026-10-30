import { useSyncExternalStore, type ReactNode } from 'react'
import { AlertDialog } from 'radix-ui'
import { Button } from './button'

interface ConfirmOptions {
  title: ReactNode
  description?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

interface Pending extends ConfirmOptions {
  resolve: (ok: boolean) => void
}

let pending: Pending | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

/** Promise-based replacement for window.confirm, rendered by <ConfirmHost/>. */
// eslint-disable-next-line react-refresh/only-export-components -- imperative API paired with its host
export function confirm(options: ConfirmOptions): Promise<boolean> {
  pending?.resolve(false)
  return new Promise((resolve) => {
    pending = { ...options, resolve }
    emit()
  })
}

function close(ok: boolean) {
  const p = pending
  pending = null
  emit()
  p?.resolve(ok)
}

/** Mount once near the app root. */
export function ConfirmHost() {
  const current = useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => pending,
  )
  return (
    <AlertDialog.Root open={!!current} onOpenChange={(open) => !open && close(false)}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-[95] bg-overlay data-[state=open]:animate-fade-in" />
        <AlertDialog.Content className="fixed left-1/2 top-1/2 z-[96] w-[min(92vw,420px)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-line bg-surface p-6 text-fg shadow-overlay outline-none data-[state=open]:animate-scale-in">
          <AlertDialog.Title className="text-[17px] font-semibold tracking-[-0.01em]">{current?.title}</AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-sm text-fg-muted">{current?.description ?? ''}</AlertDialog.Description>
          <div className="mt-6 flex justify-end gap-2">
            <AlertDialog.Cancel asChild>
              <Button variant="secondary">{current?.cancelLabel ?? 'Cancel'}</Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <Button variant={current?.danger ? 'danger' : 'primary'} onClick={() => close(true)}>
                {current?.confirmLabel ?? 'Continue'}
              </Button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
