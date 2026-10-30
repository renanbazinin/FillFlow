import { memo, useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { cn } from '../../lib/utils/misc'
import { TOOL_BY_ID } from '../../model/tools'
import type { ToolId } from '../../model/types'
import { useEditor } from '../../store/editor'
import { ImageToolButton, SignatureToolButton } from '../signature/SignatureToolButton'
import { ShapesButton } from './ShapesButton'
import { ToolButton } from './ToolButton'
import { ToolHint } from './ToolHint'
import { COMPACT_LAYOUT, useMediaQuery } from './useMediaQuery'

/**
 * The floating tool dock (bottom-center over the viewer). On phones it becomes a full-width,
 * horizontally scrollable bar pinned to the bottom edge.
 */
export const ToolDock = memo(function ToolDock() {
  const compact = useMediaQuery(COMPACT_LAYOUT)
  const barRef = useRef<HTMLDivElement>(null)
  const fades = useScrollFades(barRef, compact)

  // Keep the active tool in view on phones (e.g. after a keyboard shortcut or placing an item).
  useEffect(() => {
    if (!compact) return
    return useEditor.subscribe(
      (s) => s.tool,
      () => {
        requestAnimationFrame(() => {
          barRef.current
            ?.querySelector<HTMLElement>('[aria-pressed="true"]')
            ?.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' })
        })
      },
    )
  }, [compact])

  return (
    <div className="pointer-events-none relative z-30 shrink-0 sm:absolute sm:inset-x-0 sm:bottom-4 sm:flex sm:justify-center sm:px-4">
      <ToolHint className="absolute inset-x-0 bottom-full mb-2.5 px-3" />
      <div
        ref={barRef}
        role="toolbar"
        aria-label="Tools"
        onKeyDown={onToolbarKeyDown}
        style={compact ? { maskImage: fades, WebkitMaskImage: fades } : undefined}
        className={cn(
          'pointer-events-auto flex items-center gap-1 border-line bg-surface/90 shadow-float backdrop-blur-xl backdrop-saturate-150',
          // phones: edge-to-edge bar, 44px targets, scrolls sideways
          'max-sm:w-full max-sm:snap-x max-sm:snap-proximity max-sm:overflow-x-auto max-sm:overscroll-x-contain max-sm:border-t max-sm:px-2 max-sm:pt-1.5 max-sm:pb-[max(6px,env(safe-area-inset-bottom))] max-sm:shadow-none max-sm:scrollbar-none max-sm:[&_button]:size-11',
          // larger screens: floating pill
          'sm:rounded-2xl sm:border sm:p-1.5',
        )}
      >
        <Group>
          <PlainTool id="select" />
          <PlainTool id="hand" />
        </Group>
        <Divider />
        <Group>
          <PlainTool id="text" />
          <PlainTool id="check" />
          <PlainTool id="cross" />
          <PlainTool id="dot" />
          <PlainTool id="date" />
        </Group>
        <Divider />
        <Group>
          <SignatureToolButton role="signature" />
          <SignatureToolButton role="initials" />
          <ImageToolButton />
        </Group>
        <Divider />
        <Group>
          <PlainTool id="ink" />
          <PlainTool id="highlight" />
          <PlainTool id="whiteout" />
          <ShapesButton />
        </Group>
      </div>
    </div>
  )
})

function Group({ children }: { children: ReactNode }) {
  return <div className="flex shrink-0 snap-start scroll-ml-2 items-center gap-1">{children}</div>
}

function Divider() {
  return <div aria-hidden className="mx-0.5 h-6 w-px shrink-0 bg-line dark:bg-line-strong" />
}

const PlainTool = memo(function PlainTool({ id }: { id: ToolId }) {
  const def = TOOL_BY_ID[id]
  const lockable = def.placement !== 'none'
  const active = useEditor((s) => s.tool === id)
  const locked = useEditor((s) => s.tool === id && s.toolLocked && lockable)
  return (
    <ToolButton
      tool={def}
      active={active}
      badge={locked}
      onClick={() => useEditor.getState().setTool(id)}
      onDoubleClick={lockable ? () => useEditor.getState().setTool(id, { locked: true }) : undefined}
    />
  )
})

/** Arrow keys / Home / End move focus between the dock's buttons. */
function onToolbarKeyDown(e: KeyboardEvent<HTMLDivElement>) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
  const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
  const i = buttons.indexOf(document.activeElement as HTMLButtonElement)
  if (i < 0) return
  e.preventDefault()
  // Don't let the editor nudge the selection while moving through the toolbar.
  e.stopPropagation()
  const n = buttons.length
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + n) % n
  buttons[next].focus()
}

/** Edge fades that only appear where the bar can scroll further. */
function useScrollFades(ref: RefObject<HTMLDivElement | null>, enabled: boolean): string | undefined {
  const [edges, setEdges] = useState({ start: false, end: false })
  useEffect(() => {
    const el = ref.current
    if (!enabled || !el) return
    const update = () => {
      const start = el.scrollLeft > 2
      const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 2
      setEdges((prev) => (prev.start === start && prev.end === end ? prev : { start, end }))
    }
    el.addEventListener('scroll', update, { passive: true })
    // Also fires once right after observe(), which sets the initial state.
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', update)
      ro.disconnect()
    }
  }, [ref, enabled])
  if (!enabled || (!edges.start && !edges.end)) return undefined
  const a = edges.start ? 'transparent 0, #000 28px' : '#000 0'
  const b = edges.end ? '#000 calc(100% - 28px), transparent 100%' : '#000 100%'
  return `linear-gradient(to right, ${a}, ${b})`
}
