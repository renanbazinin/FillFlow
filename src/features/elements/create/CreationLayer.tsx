import { memo, useEffect, useRef, useState } from 'react'
import { TOOL_BY_ID } from '../../../model/tools'
import type { ImageRole, MarkShape, PageInfo, Point, ToolId } from '../../../model/types'
import { useEditor } from '../../../store/editor'
import { clampPoint } from '../lib/geometry'
import { finalizeStroke, strokesToPath } from '../lib/ink'
import { dragBox, dragLine, type BoxTool } from '../lib/placement'
import { blurFocusedField, clientToLocal, dragThreshold, isPanning, trackPointer, type TrackDisposer } from '../interaction/pointer'
import { finishActiveTextEdit } from '../state/textEdit'
import { setInteraction } from '../state/ui'
import { CreationGhost } from './CreationGhost'
import { ShapeDraft } from './ShapeDraft'
import type { Draft } from './types'
import {
  commitInkStroke,
  inkJoinTarget,
  placeAsset,
  placeBox,
  placeDate,
  placeLine,
  placeMark,
  placeText,
  textUnder,
} from './place'

const MARK_TOOLS: ReadonlySet<ToolId> = new Set<ToolId>(['check', 'cross', 'dot'])
const ASSET_TOOLS: ReadonlySet<ToolId> = new Set<ToolId>(['signature', 'initials', 'image'])

/**
 * Capture surface for the creation tools, covering the page above everything else (including
 * form fields). Handles placing, drag-to-draw with live previews, freehand ink, and the hover
 * ghosts that show what a click will add.
 */
export const CreationLayer = memo(function CreationLayer({ page, scale, tool }: { page: PageInfo; scale: number; tool: ToolId }) {
  const ref = useRef<HTMLDivElement>(null)
  const inkRef = useRef<SVGPathElement>(null)
  const scaleRef = useRef(scale)
  const [hover, setHover] = useState<Point | null>(null)
  const [overText, setOverText] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const placement = TOOL_BY_ID[tool].placement

  useEffect(() => {
    scaleRef.current = scale
  }, [scale])

  const pageIndex = page.index
  const pageW = page.width
  const pageH = page.height

  useEffect(() => {
    const node = ref.current
    if (!node) return
    const page = { index: pageIndex, width: pageW, height: pageH }
    const size = { width: pageW, height: pageH }
    const toLocal = (x: number, y: number) => clientToLocal(node, pageW, pageH, x, y)
    let dispose: TrackDisposer | null = null
    let down: { x: number; y: number } | null = null

    function placeClick(p: Point) {
      if (tool === 'text') placeText(page, p)
      else if (tool === 'date') placeDate(page, p)
      else if (MARK_TOOLS.has(tool)) placeMark(page, p, tool as MarkShape)
      else if (ASSET_TOOLS.has(tool)) placeAsset(page, p, tool as ImageRole)
    }

    function startDrag(e: PointerEvent) {
      const start = clampPoint(toLocal(e.clientX, e.clientY), size)
      const isLine = tool === 'line'
      let active = false
      const compute = (clientX: number, clientY: number, shift: boolean): Draft => {
        const cur = toLocal(clientX, clientY)
        if (isLine) {
          const [a, b] = dragLine(start, cur, shift, size)
          return { kind: 'line', a, b }
        }
        return { kind: 'box', tool: tool as BoxTool, rect: dragBox(tool as BoxTool, start, cur, shift, size) }
      }
      setInteraction('create')
      dispose = trackPointer(
        e,
        {
          move(p) {
            if (!active && Math.hypot(p.clientX - e.clientX, p.clientY - e.clientY) < dragThreshold(p.pointerType)) return
            active = true
            setDraft(compute(p.clientX, p.clientY, p.shiftKey))
          },
          up(p) {
            dispose = null
            setDraft(null)
            setInteraction('idle')
            const d = active ? compute(p.clientX, p.clientY, p.shiftKey) : null
            if (isLine) {
              const ends: [Point, Point] | null = d?.kind === 'line' && Math.hypot(d.b.x - d.a.x, d.b.y - d.a.y) >= 2 ? [d.a, d.b] : null
              placeLine(page, ends, start)
            } else placeBox(page, tool as BoxTool, d?.kind === 'box' ? d.rect : null, start)
          },
          cancel() {
            dispose = null
            setDraft(null)
            setInteraction('idle')
          },
        },
        { capture: node, modifiers: true, autoScroll: true },
      )
    }

    function startInk(e: PointerEvent) {
      const pts: Point[] = [clampPoint(toLocal(e.clientX, e.clientY), size)]
      const joinId = inkJoinTarget(page.index, performance.now())
      const path = inkRef.current
      const style = useEditor.getState().styles.ink
      const k = scaleRef.current
      // The live path grows by appending segments (no full rebuild per pointer event).
      let d = strokesToPath([[{ x: pts[0].x * k, y: pts[0].y * k }]])
      if (path) {
        path.setAttribute('stroke', style.color)
        path.setAttribute('stroke-width', String(style.strokeWidth * k))
        path.setAttribute('d', d)
      }
      const clear = () => path?.setAttribute('d', '')
      setInteraction('create')
      dispose = trackPointer(
        e,
        {
          move(_p, raw) {
            if (!raw) return
            const events = typeof raw.getCoalescedEvents === 'function' ? raw.getCoalescedEvents() : []
            for (const ce of events.length ? events : [raw]) {
              const q = clampPoint(toLocal(ce.clientX, ce.clientY), size)
              pts.push(q)
              d += `L${(q.x * k).toFixed(2)} ${(q.y * k).toFixed(2)}`
            }
            path?.setAttribute('d', d)
          },
          up() {
            dispose = null
            setInteraction('idle')
            const r = node!.getBoundingClientRect()
            const stroke = finalizeStroke(pts, r.width / page.width || scaleRef.current)
            commitInkStroke(page.index, stroke, joinId)
            clear()
          },
          cancel() {
            dispose = null
            setInteraction('idle')
            clear()
          },
        },
        { capture: node },
      )
    }

    function onPointerDown(e: PointerEvent) {
      if (!e.isPrimary || e.button !== 0 || isPanning()) return
      finishActiveTextEdit()
      blurFocusedField()
      if (placement === 'click') {
        // Placed on click, so a one-finger scroll on touch never drops anything.
        down = { x: e.clientX, y: e.clientY }
        return
      }
      e.preventDefault()
      dispose?.()
      if (placement === 'drag') startDrag(e)
      else if (placement === 'draw') startInk(e)
    }

    function onClick(e: MouseEvent) {
      if (placement !== 'click' || !down || isPanning()) return
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y)
      down = null
      if (moved > 10) return
      placeClick(toLocal(e.clientX, e.clientY))
    }

    function onMove(e: PointerEvent) {
      if (e.pointerType === 'touch' || placement !== 'click') return
      const p = toLocal(e.clientX, e.clientY)
      setHover(p)
      if (tool === 'text') setOverText(!!textUnder(page.index, p))
    }

    const onLeave = () => setHover(null)

    node.addEventListener('pointerdown', onPointerDown)
    node.addEventListener('click', onClick)
    node.addEventListener('pointermove', onMove)
    node.addEventListener('pointerleave', onLeave)
    return () => {
      node.removeEventListener('pointerdown', onPointerDown)
      node.removeEventListener('click', onClick)
      node.removeEventListener('pointermove', onMove)
      node.removeEventListener('pointerleave', onLeave)
      dispose?.()
    }
  }, [pageIndex, pageW, pageH, tool, placement])

  const armed = useEditor((s) => s.placingAssetId !== null)
  // Signature / image tools do nothing until their picker armed an asset.
  const cursor = tool === 'text' ? 'text' : ASSET_TOOLS.has(tool) && !armed ? 'default' : 'crosshair'
  const touchAction = placement === 'click' ? 'manipulation' : 'none'
  const styles = useEditor((s) => s.styles)

  return (
    <>
      {/* The capture surface is its own stacking context; previews stay outside it so a
          highlight preview multiplies with the page like the real thing. */}
      <div ref={ref} data-creation-layer className="pointer-events-auto absolute inset-0 z-[23]" style={{ cursor, touchAction }} />
      {hover && placement === 'click' && <CreationGhost tool={tool} at={hover} page={page} scale={scale} overText={overText} />}
      {draft && <ShapeDraft draft={draft} page={page.index} scale={scale} styles={styles} />}
      {placement === 'draw' && (
        <svg className="pointer-events-none absolute left-0 top-0 z-[24] overflow-visible" width={1} height={1} aria-hidden>
          <path ref={inkRef} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </>
  )
})
