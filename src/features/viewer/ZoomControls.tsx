import { ChevronDown, Minus, Plus } from 'lucide-react'
import { useEditor, zoomPercent } from '../../store/editor'
import { cn, modKeyLabel } from '../../lib/utils/misc'
import { Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuShortcut, MenuTrigger } from '../../components/ui/menu'
import { Tooltip } from '../../components/ui/tooltip'
import { viewer } from './viewerApi'
import { ZOOM_PRESETS, canZoomIn, canZoomOut, percentToScale } from './zoom'

const shortcut = (key: string) => `${modKeyLabel} ${key}`

// Focus rings are inset so the group's rounded border never clips them.
const SEGMENT = 'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent'

const STEP_BUTTON = cn(
  'inline-flex h-full w-8 shrink-0 items-center justify-center text-fg-muted transition-colors hover:bg-surface-3 hover:text-fg disabled:pointer-events-none disabled:opacity-35 pointer-coarse:w-10 [&_svg]:size-4',
  SEGMENT,
)

/**
 * Compact `− [125% ▾] +` zoom group for the top bar (h-8). On touch screens its buttons are 40px
 * targets (inside the border).
 */
export function ZoomControls({ className }: { className?: string }) {
  const scale = useEditor((s) => s.scale)
  const fitMode = useEditor((s) => s.fitMode)
  const percent = zoomPercent(scale)
  const value = fitMode ?? (ZOOM_PRESETS.some((p) => p === percent) ? String(percent) : '')

  const onValueChange = (v: string) => {
    if (v === 'width') viewer.fitWidth()
    else if (v === 'page') viewer.fitPage()
    else if (v) viewer.zoomTo(percentToScale(Number(v)))
  }

  return (
    <div
      role="group"
      aria-label="Zoom"
      className={cn(
        'inline-flex h-8 items-stretch rounded-lg border border-line bg-surface shadow-xs pointer-coarse:box-content pointer-coarse:h-10',
        className,
      )}
    >
      <Tooltip content="Zoom out" shortcut={shortcut('−')}>
        <button type="button" aria-label="Zoom out" disabled={!canZoomOut(scale)} onClick={() => viewer.zoomOut()} className={cn(STEP_BUTTON, 'rounded-l-[7px]')}>
          <Minus />
        </button>
      </Tooltip>
      <Menu>
        {/* No tooltip here: the menu hands focus back to this trigger on close, which would pop it. */}
        <MenuTrigger asChild>
          <button
            type="button"
            aria-label={`Zoom level ${percent}%${fitMode ? `, fit ${fitMode}` : ''}`}
            className={cn(
              'inline-flex h-full min-w-[4.5rem] items-center justify-center gap-1 border-x border-line px-2 text-[13px] font-medium tabular-nums text-fg transition-colors hover:bg-surface-3 data-[state=open]:bg-surface-3',
              SEGMENT,
            )}
          >
            {percent}%
            <ChevronDown className="size-3.5 text-fg-subtle" aria-hidden />
          </button>
        </MenuTrigger>
        <MenuContent align="center" className="min-w-48">
          <MenuRadioGroup value={value} onValueChange={onValueChange}>
            <MenuRadioItem value="width">
              <span className="flex-1">Fit width</span>
              <MenuShortcut>{shortcut('0')}</MenuShortcut>
            </MenuRadioItem>
            <MenuRadioItem value="page">
              <span className="flex-1">Fit page</span>
            </MenuRadioItem>
            <MenuSeparator />
            {ZOOM_PRESETS.map((p) => (
              <MenuRadioItem key={p} value={String(p)} className="tabular-nums">
                {p}%
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuContent>
      </Menu>
      <Tooltip content="Zoom in" shortcut={shortcut('+')}>
        <button type="button" aria-label="Zoom in" disabled={!canZoomIn(scale)} onClick={() => viewer.zoomIn()} className={cn(STEP_BUTTON, 'rounded-r-[7px]')}>
          <Plus />
        </button>
      </Tooltip>
    </div>
  )
}
