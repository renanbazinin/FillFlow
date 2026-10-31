import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { ImageOff } from 'lucide-react'
import { useEditor, type LoadedDocument } from '../../store/editor'
import type { PDFDocumentProxy } from '../../lib/pdf/pdfjs'
import type { PageInfo } from '../../model/types'
import { clamp, cn } from '../../lib/utils/misc'
import { prefersReducedMotion } from '../../lib/utils/motion'
import { viewer } from './viewerApi'
import { bitmapTarget, releaseCanvas, renderPageBitmap, retainPage, type BitmapTarget } from './pageRender'
import { renderQueue } from './renderQueue'
import { cacheThumbnail, getCachedThumbnail, pageBadgeCounts, thumbnailPixelRatio, thumbnailSize } from './thumbnailModel'
import { revealDelta } from './viewMath'
import { VisibilityRegistry, scrollParent } from './visibility'

/** Thumbnails render after the main pages within this many pixels of the viewport. */
const THUMBNAIL_PRIORITY = 5000
/** A thumbnail must stay near the panel's viewport this long before it renders (skips fly-bys). */
const THUMBNAIL_DWELL_MS = 120

function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob(resolve, 'image/jpeg', 0.86)
    } catch {
      resolve(null)
    }
  })
}

/**
 * Renders a page thumbnail and returns it as a JPEG object URL (null when aborted). Afterwards
 * pdf.js frees the page's resources again, unless the document view is using them.
 */
async function renderThumbnail(pdf: PDFDocumentProxy, info: PageInfo, target: BitmapTarget, signal: AbortSignal): Promise<string | null> {
  const releasePage = retainPage(pdf, info.index)
  let canvas: HTMLCanvasElement | null = null
  try {
    canvas = await renderPageBitmap(pdf, info, target, signal)
    const blob = canvas && (await canvasToJpeg(canvas))
    return blob ? URL.createObjectURL(blob) : null
  } finally {
    releaseCanvas(canvas)
    releasePage()
  }
}

/** Scrolls only the thumbnails' own scroll area (never the page) so `el` is visible. */
function revealInScrollArea(el: HTMLElement, center: boolean) {
  const area = scrollParent(el)
  if (!area) return
  const a = area.getBoundingClientRect()
  const r = el.getBoundingClientRect()
  const delta = center ? (r.top + r.bottom) / 2 - (a.top + a.bottom) / 2 : revealDelta(r.top, r.bottom, a.top, a.bottom, 12)
  if (Math.abs(delta) < 1) return
  // Short hops glide; long jumps (or reduced motion) are instant.
  const smooth = !center && !prefersReducedMotion() && Math.abs(delta) < a.height * 1.5
  area.scrollBy({ top: delta, behavior: smooth ? 'smooth' : 'auto' })
}

export interface ThumbnailsProps {
  /** Called after a thumbnail navigates the document (e.g. to close a mobile drawer). */
  onNavigate?: (pageIndex: number) => void
  /** False while the list is hidden (collapsed panel): no rendering or auto-scrolling then. */
  active?: boolean
}

/**
 * Left-panel content: one lazily rendered thumbnail per page. The current page is highlighted,
 * click / Enter scrolls the document there, arrow keys move between pages, and a badge counts the
 * page's placed items + changed form fields. The parent provides the width (~200px) and scrolling.
 */
export function Thumbnails({ onNavigate, active = true }: ThumbnailsProps = {}) {
  const doc = useEditor((s) => s.doc)
  if (!doc) return null
  return <ThumbnailList key={doc.id} doc={doc} onNavigate={onNavigate} active={active} />
}

function ThumbnailList({ doc, onNavigate, active }: { doc: LoadedDocument; onNavigate?: (pageIndex: number) => void; active: boolean }) {
  const current = useEditor((s) => s.currentPage)
  const counts = useEditor(useShallow(pageBadgeCounts))
  const listRef = useRef<HTMLOListElement>(null)
  const buttons = useRef(new Map<number, HTMLButtonElement>())
  const revealed = useRef(false)
  const [registry] = useState(() => new VisibilityRegistry('320px 0px'))
  const pageCount = doc.pages.length

  useLayoutEffect(() => {
    registry.setRoot(scrollParent(listRef.current))
    return () => registry.disconnect()
  }, [registry])

  // Keep the current page's thumbnail in view (centered when the panel opens).
  useEffect(() => {
    if (!active) {
      revealed.current = false
      return
    }
    const el = buttons.current.get(current)
    if (!el) return
    revealInScrollArea(el, !revealed.current)
    revealed.current = true
  }, [current, active])

  const setButton = useCallback((index: number, el: HTMLButtonElement | null) => {
    if (el) buttons.current.set(index, el)
    else buttons.current.delete(index)
  }, [])

  const navigate = useCallback(
    (index: number, opts?: { behavior?: ScrollBehavior; focusDocument?: boolean }) => {
      viewer.scrollToPage(index, opts?.behavior ? { behavior: opts.behavior } : undefined)
      // After a pointer click the next interaction is in the document (Space-pan, arrow scrolling);
      // keyboard users stay in the list to keep moving between pages.
      if (opts?.focusDocument) viewer.getScrollContainer()?.focus({ preventScroll: true })
      onNavigate?.(index)
    },
    [onNavigate],
  )

  const onKeyDown = (e: KeyboardEvent<HTMLOListElement>) => {
    const from = Number((e.target as HTMLElement).closest<HTMLElement>('[data-thumb-index]')?.dataset.thumbIndex)
    if (!Number.isFinite(from)) return
    let to: number | null = null
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') to = from + 1
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') to = from - 1
    else if (e.key === 'PageDown') to = from + 5
    else if (e.key === 'PageUp') to = from - 5
    else if (e.key === 'Home') to = 0
    else if (e.key === 'End') to = pageCount - 1
    if (to === null) return
    e.preventDefault()
    to = clamp(to, 0, pageCount - 1)
    if (to === from) return
    buttons.current.get(to)?.focus()
    navigate(to, { behavior: 'auto' })
  }

  return (
    <ol ref={listRef} role="list" aria-label="Pages" className="flex flex-col items-stretch gap-1 px-3 py-3" onKeyDown={onKeyDown}>
      {doc.pages.map((info) => (
        <ThumbnailItem
          key={info.index}
          docId={doc.id}
          pdf={doc.pdf}
          info={info}
          pageCount={pageCount}
          current={info.index === current}
          count={counts[info.index] ?? 0}
          active={active}
          registry={registry}
          setButton={setButton}
          onSelect={navigate}
        />
      ))}
    </ol>
  )
}

interface ThumbnailItemProps {
  docId: string
  pdf: PDFDocumentProxy
  info: PageInfo
  pageCount: number
  current: boolean
  count: number
  active: boolean
  registry: VisibilityRegistry
  setButton: (index: number, el: HTMLButtonElement | null) => void
  onSelect: (index: number, opts?: { focusDocument?: boolean }) => void
}

const ThumbnailItem = memo(function ThumbnailItem({
  docId,
  pdf,
  info,
  pageCount,
  current,
  count,
  active,
  registry,
  setButton,
  onSelect,
}: ThumbnailItemProps) {
  const index = info.index
  const { width, height } = thumbnailSize(info)
  const [url, setUrl] = useState(() => getCachedThumbnail(docId, index) ?? null)
  const [failed, setFailed] = useState(false)
  const [near, setNear] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    return registry.observe(el, setNear)
  }, [registry])

  // Hiding the list (or scrolling past) cancels a queued or running render.
  useEffect(() => {
    if (url || failed || !near || !active) return
    let cancel: (() => void) | null = null
    const dwell = setTimeout(() => {
      const target = bitmapTarget(width, height, thumbnailPixelRatio(window.devicePixelRatio))
      cancel = renderQueue.schedule(async (signal) => {
        try {
          const objectUrl = await renderThumbnail(pdf, info, target, signal)
          if (!objectUrl) return
          // Cache even if this item went away meanwhile: the panel may come right back.
          if (!cacheThumbnail(docId, index, objectUrl, useEditor.getState().doc?.id ?? null)) {
            URL.revokeObjectURL(objectUrl)
            return
          }
          if (!signal.aborted) setUrl(objectUrl)
        } catch (err) {
          if (signal.aborted) return
          console.warn(`[thumbnails] page ${index + 1} could not be rendered`, err)
          setFailed(true)
        }
      }, () => THUMBNAIL_PRIORITY + index)
    }, THUMBNAIL_DWELL_MS)
    return () => {
      clearTimeout(dwell)
      cancel?.()
    }
  }, [url, failed, near, active, pdf, info, docId, index, width, height])

  const buttonRef = useCallback((el: HTMLButtonElement | null) => setButton(index, el), [setButton, index])
  const label = `Page ${index + 1} of ${pageCount}${count ? `, ${count} ${count === 1 ? 'edit' : 'edits'}` : ''}`

  return (
    <li className="flex justify-center">
      <button
        ref={buttonRef}
        type="button"
        data-thumb-index={index}
        tabIndex={current ? 0 : -1}
        aria-current={current ? 'page' : undefined}
        aria-label={label}
        onClick={(e) => onSelect(index, { focusDocument: e.detail > 0 })}
        className="group flex w-full flex-col items-center gap-1.5 rounded-xl px-2 pb-1.5 pt-2.5 transition-colors hover:bg-surface-3/70 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
      >
        <div className="relative">
          <div
            ref={boxRef}
            className={cn(
              'relative overflow-hidden rounded-[3px] bg-white transition-shadow duration-150',
              current
                ? 'shadow-float ring-2 ring-accent ring-offset-2 ring-offset-surface'
                : 'shadow-xs ring-1 ring-line group-hover:shadow-float group-hover:ring-line-strong',
            )}
            style={{ width, height }}
          >
            {url ? (
              <img src={url} alt="" draggable={false} className="block size-full animate-fade-in select-none" />
            ) : failed ? (
              <div className="flex size-full items-center justify-center text-black/30">
                <ImageOff className="size-5" aria-hidden />
              </div>
            ) : (
              near && active && (
                <div className="absolute inset-0 animate-shimmer bg-[linear-gradient(100deg,transparent_35%,rgb(15_23_42/0.06)_50%,transparent_65%)] bg-[length:200%_100%]" />
              )
            )}
          </div>
          {count > 0 && (
            <span
              aria-hidden
              className="absolute -right-2 -top-2 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-none tabular-nums text-accent-fg shadow-xs ring-2 ring-surface"
            >
              {count > 99 ? '99+' : count}
            </span>
          )}
        </div>
        <span
          className={cn(
            'min-w-7 rounded-md px-1.5 py-0.5 text-center text-[11px] font-medium leading-4 tabular-nums transition-colors',
            current ? 'bg-accent-soft text-accent-ink' : 'text-fg-muted group-hover:text-fg',
          )}
        >
          {index + 1}
        </span>
      </button>
    </li>
  )
})
