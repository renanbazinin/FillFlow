import { useEffect, useRef, useState } from 'react'
import { Check, Ellipsis, FolderOpen, Trash } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../../components/ui/button'
import { confirm } from '../../components/ui/confirm'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '../../components/ui/menu'
import {
  forgetDocument,
  forgetStaleSessions,
  forgetUnlistedSessions,
  hasSession,
  hasUnlistedSessions,
  listRecentDocuments,
  loadDocumentBytes,
  patchRecentDocument,
  removeRecentDocument,
  type RecentDocument,
} from '../../lib/storage/db'
import { cn } from '../../lib/utils/misc'
import { useEditor } from '../../store/editor'
import { usePointerAwareClose } from '../editor/usePointerAwareClose'
import { displayName } from './pdfFiles'
import { pluralize, recentMetaLine } from './recentMeta'

/**
 * Recently opened documents (stored only in this browser), followed by a line about the work still
 * saved for documents that dropped off the list, if any, which offers to delete it.
 */
export function RecentDocuments({ className }: { className?: string }) {
  const [docs, setDocs] = useState<RecentDocument[] | null>(null)
  const [showSkeleton, setShowSkeleton] = useState(false)
  /** Work is still saved for documents that are no longer listed. */
  const [olderWork, setOlderWork] = useState(false)

  useEffect(() => {
    let alive = true
    // Work on documents that dropped off the list is kept for a while (opening the same file
    // again brings it back), then let go of.
    const tidied = forgetStaleSessions().catch((err) => console.warn('[recents] could not delete old saved work', err))
    const load = () => {
      void tidied
        .then(hasUnlistedSessions)
        .then((found) => alive && setOlderWork(found))
        .catch((err) => console.warn('[recents] could not look for saved work', err))
      return listRecentDocuments()
        .then((list) => alive && setDocs(list))
        .catch((err) => {
          console.warn('[recents] could not list documents', err)
          if (alive) setDocs((prev) => prev ?? [])
        })
    }
    // IndexedDB usually answers within a frame; only show a skeleton if it doesn't.
    const skeletonTimer = window.setTimeout(() => alive && setShowSkeleton(true), 150)
    void load()
    // Coming back from the editor, its last save (progress count, thumbnail) may still be
    // landing: look again shortly, and whenever the tab becomes visible.
    const refreshTimer = window.setTimeout(load, 900)
    const onVisible = () => document.visibilityState === 'visible' && void load()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive = false
      window.clearTimeout(skeletonTimer)
      window.clearTimeout(refreshTimer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  const listRef = useRef<HTMLUListElement>(null)
  /** Which card gets keyboard focus once a removal has re-rendered the list. */
  const focusAfterRemoval = useRef<number | null>(null)

  // A removal takes the focused control (the card's menu button, Clear all, Delete it) away with
  // it: move focus to the card now in its place, or to the dropzone once the list is gone.
  useEffect(() => {
    const index = focusAfterRemoval.current
    if (index === null || docs === null) return
    focusAfterRemoval.current = null
    // After the confirm dialog's own focus handling.
    requestAnimationFrame(() => {
      if (document.activeElement && document.activeElement !== document.body) return
      const cards = listRef.current?.querySelectorAll<HTMLElement>('[data-recent-open]')
      const target =
        cards?.[Math.min(index, cards.length - 1)] ?? document.querySelector<HTMLElement>('button[aria-describedby="ff-dropzone-hint"]')
      target?.focus()
    })
  }, [docs, olderWork])

  const remove = async (doc: RecentDocument) => {
    const ok = await confirm({
      title: (
        <>
          Remove “<bdi>{displayName(doc.name)}</bdi>”?
        </>
      ),
      description: 'The file and the work you’ve done on it will be deleted from this device. This can’t be undone.',
      confirmLabel: 'Remove',
      danger: true,
    })
    if (!ok) return
    try {
      await forgetDocument(doc.id)
      focusAfterRemoval.current = Math.max(0, docs?.findIndex((d) => d.id === doc.id) ?? 0)
      setDocs((list) => list?.filter((d) => d.id !== doc.id) ?? null)
      toast.success('Removed from this device')
    } catch {
      toast.error('Couldn’t remove the document')
    }
  }

  const clearAll = async () => {
    if (!docs?.length) return
    const ok = await confirm({
      title: 'Clear all recent documents?',
      description: `${pluralize(docs.length, 'document')} and the work you’ve done on ${docs.length === 1 ? 'it' : 'them'} will be deleted from this device. This can’t be undone.`,
      confirmLabel: 'Clear all',
      danger: true,
    })
    if (!ok) return
    const results = await Promise.allSettled(docs.map((d) => forgetDocument(d.id)))
    const kept = docs.filter((_, i) => results[i].status === 'rejected')
    // Work kept from documents that dropped off the list to make room goes too.
    await forgetUnlistedSessions()
      .then(() => setOlderWork(false))
      .catch((err) => console.warn('[recents] could not delete saved work', err))
    focusAfterRemoval.current = 0
    setDocs(kept)
    if (kept.length) toast.error('Some documents couldn’t be removed')
    else toast.success('Recent documents cleared')
  }

  const deleteOlderWork = async () => {
    const ok = await confirm({
      title: 'Delete your work on documents no longer listed?',
      description: 'What you filled in, typed or signed on them will be deleted from this device. This can’t be undone.',
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!ok) return
    try {
      await forgetUnlistedSessions()
      focusAfterRemoval.current = 0
      setOlderWork(false)
      toast.success('Work deleted from this device')
    } catch {
      toast.error('Couldn’t delete the work')
    }
  }

  if (docs === null && !showSkeleton) return null
  if (docs !== null && docs.length === 0) {
    return olderWork ? <OlderWorkNotice className={className} onDelete={() => void deleteOlderWork()} /> : null
  }

  /**
   * The file of a listed document is gone: it stays listed for its work (see
   * `RecentDocument.fileMissing`), or goes when it has none.
   */
  const fileMissing = (doc: RecentDocument) => {
    const drop = () => setDocs((list) => list?.filter((d) => d.id !== doc.id) ?? null)
    void (async () => {
      if (!(await hasSession(doc.id))) {
        await removeRecentDocument(doc.id)
        drop()
      } else if (await patchRecentDocument(doc.id, { fileMissing: true })) {
        setDocs((list) => list?.map((d) => (d.id === doc.id ? { ...d, fileMissing: true } : d)) ?? null)
      } else {
        // No longer listed at all (removed, or dropped off the list, in another tab).
        drop()
        setOlderWork(await hasUnlistedSessions())
      }
    })().catch((err: unknown) => console.warn('[recents] could not update a document whose file is gone', err))
  }

  return (
    <section aria-labelledby="ff-recents-title" className={className}>
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h2 id="ff-recents-title" className="text-[15px] font-semibold tracking-[-0.01em] text-fg">
            Recent documents
          </h2>
          <p className="mt-0.5 text-[13px] text-fg-subtle">Saved in this browser only.</p>
        </div>
        {docs && (
          <Button variant="ghost" size="sm" onClick={() => void clearAll()} className="-mr-2 text-fg-subtle">
            Clear all
          </Button>
        )}
      </div>
      <ul ref={listRef} className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
        {docs
          ? docs.map((doc, i) => (
              <RecentCard key={doc.id} doc={doc} index={i} onRemove={() => void remove(doc)} onMissing={() => fileMissing(doc)} />
            ))
          : Array.from({ length: 4 }, (_, i) => <SkeletonCard key={i} />)}
      </ul>
      {olderWork && <OlderWorkNotice className="mt-6" onDelete={() => void deleteOlderWork()} />}
    </section>
  )
}

function RecentCard({
  doc,
  index,
  onRemove,
  onMissing,
}: {
  doc: RecentDocument
  index: number
  onRemove: () => void
  /** The file's bytes aren't stored (there was no room for them, or they were evicted or removed in another tab). */
  onMissing: () => void
}) {
  const name = displayName(doc.name)
  const closeHandlers = usePointerAwareClose()
  const open = async () => {
    const ok = await useEditor.getState().openRecent(doc.id, doc.name)
    // Only a file that is really gone: one that can't be read right now keeps its card.
    if (!ok && (await loadDocumentBytes(doc.id).catch(() => undefined)) === null) onMissing()
  }
  const filled = doc.filledCount ?? 0
  return (
    <li
      className="group relative flex flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-xs transition-[translate,box-shadow,border-color] duration-200 ease-out animate-slide-up [animation-fill-mode:both] hover:-translate-y-0.5 hover:border-line-strong hover:shadow-float"
      style={{ animationDelay: `${Math.min(index, 8) * 35}ms` }}
    >
      <div className="relative aspect-[4/3] overflow-hidden border-b border-line bg-surface-2">
        <div className="absolute inset-x-[14%] top-[13%] h-[120%] overflow-hidden rounded-t-[4px] bg-white shadow-page transition-transform duration-300 ease-out group-hover:-translate-y-1">
          {doc.thumbnail ? (
            <img src={doc.thumbnail} alt="" loading="lazy" decoding="async" draggable={false} className="w-full select-none" />
          ) : (
            <PagePlaceholder />
          )}
        </div>
        {filled > 0 && (
          <span className="absolute bottom-2 left-2 inline-flex h-[22px] items-center gap-1 rounded-full border border-line bg-surface/95 px-2 text-[11px] font-semibold text-success shadow-xs backdrop-blur">
            <Check className="size-3" strokeWidth={3} />
            {filled} filled
          </span>
        )}
      </div>
      <div className="min-w-0 px-3 pb-3 pt-2.5">
        <div className="truncate text-left text-[13.5px] font-medium text-fg" title={doc.name} dir="auto">
          {name}
        </div>
        {doc.fileMissing ? (
          <div
            className="mt-0.5 truncate text-[12px] text-warning"
            title="Its file isn’t stored on this device. Open the same file again to continue."
          >
            {pluralize(doc.pageCount, 'page')} · file not stored
          </div>
        ) : (
          <div className="mt-0.5 truncate text-[12px] text-fg-subtle">{recentMetaLine(doc.pageCount, doc)}</div>
        )}
      </div>

      {/* Stretched button: the whole card opens the document. */}
      <button
        type="button"
        data-recent-open
        onClick={() => void open()}
        aria-label={`Open ${name}`}
        title={doc.name}
        className="absolute inset-0 rounded-2xl focus-visible:outline-offset-[-2px]"
      />

      <Menu>
        <MenuTrigger asChild>
          <button
            type="button"
            aria-label={`More options for ${name}`}
            className="absolute right-2 top-2 z-10 inline-flex size-8 items-center justify-center rounded-lg border border-line bg-surface/95 text-fg-muted opacity-0 shadow-xs backdrop-blur transition-[opacity,color,background-color] duration-150 hover:bg-surface-3 hover:text-fg focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100 pointer-coarse:size-10 pointer-coarse:opacity-100"
          >
            <Ellipsis className="size-4" />
          </button>
        </MenuTrigger>
        <MenuContent align="end" className="min-w-56" {...closeHandlers}>
          <MenuItem icon={<FolderOpen />} onSelect={() => void open()}>
            Open
          </MenuItem>
          <MenuSeparator />
          <MenuItem icon={<Trash />} danger onSelect={onRemove}>
            Remove from this device
          </MenuItem>
        </MenuContent>
      </Menu>
    </li>
  )
}

/** The work on documents that dropped off the list is kept for a while: it can be continued, or deleted. */
function OlderWorkNotice({ className, onDelete }: { className?: string; onDelete: () => void }) {
  return (
    <p className={cn('text-center text-[13px] text-fg-subtle text-pretty', className)}>
      Your work on documents no longer listed is still saved on this device. Open the same file again to continue.{' '}
      <button type="button" onClick={onDelete} className="font-medium text-fg-muted underline-offset-4 hover:text-fg hover:underline">
        Delete it
      </button>
    </p>
  )
}

/** Stand-in for a missing thumbnail: an abstract page of text lines. */
function PagePlaceholder() {
  const lines = ['72%', '88%', '64%', null, '80%', '92%', '56%', null, '84%', '70%', '78%']
  return (
    <div className="flex flex-col gap-2 px-[12%] pt-[12%]" aria-hidden>
      <div className="mb-1 h-[7px] w-[46%] rounded-full bg-[#cfd5de]" />
      {lines.map((w, i) =>
        w ? (
          <div key={i} className="h-[5px] rounded-full bg-[#e6e9ef]" style={{ width: w }} />
        ) : (
          <div key={i} className="h-1" />
        ),
      )}
    </div>
  )
}

function SkeletonCard() {
  return (
    <li className="overflow-hidden rounded-2xl border border-line bg-surface" aria-hidden>
      <div className="aspect-[4/3] skeleton" />
      <div className="space-y-2 px-3 pb-3.5 pt-3">
        <div className={cn('h-3 w-3/4 rounded-full skeleton')} />
        <div className="h-2.5 w-1/2 rounded-full skeleton" />
      </div>
    </li>
  )
}
