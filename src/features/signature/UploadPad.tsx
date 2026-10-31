import { useEffect, useRef, useState, type DragEvent } from 'react'
import { toast } from 'sonner'
import { ImageUp, Lightbulb, RefreshCw, X } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { Slider, Spinner, Switch } from '../../components/ui/controls'
import { cn, modKeyLabel } from '../../lib/utils/misc'
import { firstImageFile } from './decode'
import { useSignatureDraft, type UploadDraft } from './draft'
import { padBoxPx, type Box } from './imageUtils'
import type { SignatureRole } from './library'
import { processUpload, type ProcessedImage } from './render'
import { PAD_FRAME, SOFT_DISABLED } from './styles'
import { loadUploadFile, sensitivityToWhitePoint, whitePointToSensitivity } from './upload'

const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes('Files')

export function UploadPad({ role }: { role: SignatureRole }) {
  const upload = useSignatureDraft((s) => s.upload[role])
  const inputRef = useRef<HTMLInputElement>(null)
  const [loading, setLoading] = useState(false)
  const [dragging, setDragging] = useState(false)

  const take = async (file: File | null) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast.error("That file isn't an image", { description: 'Choose a PNG or JPEG picture of your signature.' })
      return
    }
    setLoading(true)
    try {
      await loadUploadFile(role, file, file.name)
    } catch {
      toast.error("Couldn't open this image", { description: 'Try a PNG or JPEG file.' })
    } finally {
      setLoading(false)
    }
  }

  const choose = () => {
    const input = inputRef.current
    if (!input) return
    input.value = ''
    input.click()
  }

  const drop = {
    onDragEnter: (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      setDragging(true)
    },
    onDragOver: (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    },
    onDragLeave: (e: DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false)
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault()
      setDragging(false)
      void take(firstImageFile(e.dataTransfer.files))
    },
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        tabIndex={-1}
        aria-hidden
        className="sr-only"
        onChange={(e) => void take(e.target.files?.[0] ?? null)}
      />
      {upload ? (
        <UploadPreview role={role} upload={upload} dragging={dragging} drop={drop} onReplace={choose} loading={loading} />
      ) : (
        <>
          <button
            type="button"
            onClick={choose}
            {...drop}
            className={cn(
              'group flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line-strong bg-surface-2 px-6 text-center transition-colors duration-150 hover:border-accent/60',
              PAD_FRAME[role],
              dragging && 'border-accent bg-accent-soft',
            )}
          >
            <span className="inline-flex size-10 items-center justify-center rounded-full bg-surface text-fg-muted shadow-xs ring-1 ring-line transition-colors group-hover:text-accent-ink">
              {loading ? <Spinner className="size-5" /> : <ImageUp className="size-5" />}
            </span>
            <span className="text-sm font-medium text-fg">
              {loading ? 'Opening image…' : dragging ? 'Drop to upload' : `Drop an image of your ${role === 'signature' ? 'signature' : 'initials'}`}
            </span>
            <span className="text-[13px] text-fg-muted">
              or <span className="font-medium text-accent-ink underline-offset-2 group-hover:underline">choose a file</span>
              <span className="[@media(hover:none)]:hidden"> · or paste with {modKeyLabel}+V</span>
            </span>
          </button>
          <p className="mt-2.5 flex items-start gap-1.5 text-xs text-fg-subtle">
            <Lightbulb className="mt-px size-3.5 shrink-0" />
            Sign on plain white paper and take the photo in good light. The background is removed automatically.
          </p>
        </>
      )}
    </div>
  )
}

function UploadPreview({
  role,
  upload,
  dragging,
  drop,
  onReplace,
  loading,
}: {
  role: SignatureRole
  upload: UploadDraft
  dragging: boolean
  drop: Record<'onDragEnter' | 'onDragOver' | 'onDragLeave' | 'onDrop', (e: DragEvent) => void>
  onReplace: () => void
  loading: boolean
}) {
  const patchUpload = useSignatureDraft((s) => s.patchUpload)
  const setUpload = useSignatureDraft((s) => s.setUpload)
  const empty = useSignatureDraft((s) => s.uploadEmpty[role])
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const result = useRef<ProcessedImage | null>(null)

  const draw = useRef(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    const r = result.current
    if (!r?.bounds) return
    const box: Box = padBoxPx(r.bounds, 0.04)
    const margin = Math.round(Math.min(canvas.width, canvas.height) * 0.08)
    const k = Math.min((canvas.width - margin * 2) / box.width, (canvas.height - margin * 2) / box.height, 4 * devicePixelRatio)
    const w = box.width * k
    const h = box.height * k
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(r.canvas, box.x, box.y, box.width, box.height, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h)
  })

  // Re-process on every settings change (coalesced to one per frame).
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      result.current = processUpload(upload, 'preview')
      useSignatureDraft.getState().setUploadEmpty(role, !result.current.bounds)
      draw.current()
    })
    return () => cancelAnimationFrame(raf)
  }, [upload, role])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width * devicePixelRatio)
      const h = Math.round(entry.contentRect.height * devicePixelRatio)
      if (w && h && (canvas.width !== w || canvas.height !== h)) {
        canvas.width = w
        canvas.height = h
        draw.current()
      }
    })
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [])

  const sensitivity = whitePointToSensitivity(upload.whitePoint)
  const isAuto = upload.whitePoint === upload.autoWhitePoint

  return (
    <div>
      <div
        {...drop}
        className={cn('relative overflow-hidden rounded-xl border border-line bg-checker shadow-xs', PAD_FRAME[role], dragging && 'ring-3 ring-accent/40')}
      >
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={empty ? 'Preview: nothing left after removing the background' : `Preview of the uploaded ${role === 'signature' ? 'signature' : 'initials'}`}
          className="absolute inset-0 size-full"
        />
        {empty && (
          <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-[13px] font-medium text-black/55">
            Nothing left to keep. Lower the sensitivity or turn background removal off.
          </div>
        )}
        {(loading || dragging) && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/70 text-sm font-medium text-black/70 backdrop-blur-[1px]">
            {loading ? <Spinner className="size-5" /> : 'Drop to replace'}
          </div>
        )}
        <div className="absolute right-2 top-2 flex gap-1.5">
          <Button size="xs" variant="secondary" onClick={onReplace} className="shadow-xs">
            <RefreshCw className="!size-3.5" />
            Replace
          </Button>
          <Button size="xs" variant="secondary" onClick={() => setUpload(role, null)} aria-label="Remove image" className="w-7 px-0 shadow-xs">
            <X className="!size-3.5" />
          </Button>
        </div>
      </div>

      <div className="mt-3 space-y-3 rounded-xl border border-line bg-surface-2 p-3">
        <Switch
          checked={upload.removeBg}
          onCheckedChange={(removeBg) => patchUpload(role, { removeBg })}
          label="Remove background"
          description="Makes the paper transparent so only the ink is placed."
        />
        {upload.removeBg && (
          <div className="flex items-center gap-3">
            <span className="w-20 shrink-0 text-[13px] font-medium text-fg-muted">Sensitivity</span>
            <Slider
              value={sensitivity}
              min={0}
              max={100}
              label="Background removal sensitivity"
              onValueChange={(v) => patchUpload(role, { whitePoint: sensitivityToWhitePoint(v) })}
            />
            {/* aria-disabled: going back to Auto must not take focus away from the button. */}
            <Button
              size="xs"
              variant="ghost"
              onClick={() => !isAuto && patchUpload(role, { whitePoint: upload.autoWhitePoint })}
              aria-disabled={isAuto || undefined}
              className={cn('shrink-0', SOFT_DISABLED)}
            >
              Auto
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
