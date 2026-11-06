import { Ellipsis, Eraser, FolderOpen, Keyboard, MoveHorizontal, PanelLeft, PanelRight, X, ZoomIn, ZoomOut } from 'lucide-react'
import { IconButton } from '../../components/ui/button'
import { confirm } from '../../components/ui/confirm'
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from '../../components/ui/menu'
import { setThemePreference, useTheme, type ThemePreference } from '../../lib/theme'
import { filledCount, useEditor } from '../../store/editor'
import { chooseAndOpenPdf } from '../home/openFile'
import { THEME_OPTIONS } from '../home/themeOptions'
import { viewer } from '../viewer/viewerApi'
import { canZoomIn, canZoomOut } from '../viewer/zoom'
import { closeDocumentSafely } from './leaveGuard'
import { SHORTCUTS, shortcutLabel } from './shortcuts'
import { ZOOM_IN_MENU, useMediaQuery } from './useMediaQuery'
import { usePointerAwareClose } from './usePointerAwareClose'

/**
 * Let the menu finish closing and hand focus back to its trigger before a dialog or sheet takes
 * over, so that one knows where to return focus. Radix refocuses in a timeout of its own, queued
 * after this call: hence the second hop.
 */
const afterMenuCloses = (fn: () => void) => window.setTimeout(() => window.setTimeout(fn, 0), 0)

/**
 * Top-bar overflow menu. `compact` adds the controls that don't fit a phone's top bar; zoom is
 * offered whenever the top bar hides its own zoom controls.
 */
export function EditorMenu({ compact }: { compact: boolean }) {
  const { preference } = useTheme()
  const hasForm = useEditor((s) => (s.doc?.formFields.length ?? 0) > 0)
  const zoomInMenu = useMediaQuery(ZOOM_IN_MENU)
  const closeHandlers = usePointerAwareClose()
  return (
    <Menu>
      <MenuTrigger asChild>
        <IconButton label="More" icon={<Ellipsis />} />
      </MenuTrigger>
      <MenuContent className="w-60" {...closeHandlers}>
        <MenuItem icon={<FolderOpen />} shortcut={shortcutLabel(SHORTCUTS.open)} onSelect={() => void chooseAndOpenPdf()}>
          Open another PDF…
        </MenuItem>
        {compact && (
          <>
            <MenuSeparator />
            <MenuItem icon={<PanelLeft />} onSelect={() => afterMenuCloses(() => useEditor.getState().setLeftPanelOpen(true))}>
              Pages
            </MenuItem>
            <MenuItem icon={<PanelRight />} onSelect={() => afterMenuCloses(() => useEditor.getState().setRightPanelOpen(true))}>
              {hasForm ? 'Form & items' : 'Items'}
            </MenuItem>
          </>
        )}
        {zoomInMenu && (
          <>
            <MenuSeparator />
            <ZoomItems />
          </>
        )}
        <MenuItem
          icon={<Keyboard />}
          shortcut="?"
          className="pointer-coarse:hidden"
          onSelect={() => afterMenuCloses(() => useEditor.getState().openDialog('shortcuts'))}
        >
          Keyboard shortcuts
        </MenuItem>
        <MenuSeparator />
        <MenuLabel>Theme</MenuLabel>
        <MenuRadioGroup value={preference} onValueChange={(v) => setThemePreference(v as ThemePreference)}>
          {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
            <MenuRadioItem key={value} value={value} onSelect={(e) => e.preventDefault()}>
              <Icon className="size-4 text-fg-muted" />
              {label}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
        <MenuSeparator />
        <ClearEverythingItem />
        <MenuItem icon={<X />} onSelect={() => afterMenuCloses(() => void closeDocumentSafely())}>
          Close document
        </MenuItem>
      </MenuContent>
    </Menu>
  )
}

/** Zoom steps keep the menu open, so they can be repeated. Only mounted while the menu is open. */
function ZoomItems() {
  const scale = useEditor((s) => s.scale)
  return (
    <>
      <MenuItem
        icon={<ZoomIn />}
        shortcut={shortcutLabel(SHORTCUTS.zoomIn)}
        disabled={!canZoomIn(scale)}
        onSelect={(e) => {
          e.preventDefault()
          viewer.zoomIn()
        }}
      >
        Zoom in
      </MenuItem>
      <MenuItem
        icon={<ZoomOut />}
        shortcut={shortcutLabel(SHORTCUTS.zoomOut)}
        disabled={!canZoomOut(scale)}
        onSelect={(e) => {
          e.preventDefault()
          viewer.zoomOut()
        }}
      >
        Zoom out
      </MenuItem>
      <MenuItem icon={<MoveHorizontal />} shortcut={shortcutLabel(SHORTCUTS.fitWidth)} onSelect={() => viewer.fitWidth()}>
        Fit to width
      </MenuItem>
    </>
  )
}

/**
 * Removes the placed items and resets the form fields: "everything", unlike the Items panel's
 * "Clear all items" (items only) and the Form panel's "Reset form" (fields only). Only mounted
 * while the menu is open, so the (cheap but non-trivial) count isn't live.
 */
function ClearEverythingItem() {
  // Locked items stay, so they aren't something to clear.
  const hasWork = useEditor((s) => filledCount(s) > s.elements.filter((e) => e.locked).length)
  return (
    <MenuItem
      icon={<Eraser />}
      danger
      disabled={!hasWork}
      onSelect={() =>
        afterMenuCloses(async () => {
          const locked = useEditor.getState().elements.filter((e) => e.locked).length
          const ok = await confirm({
            title: 'Clear everything you added?',
            description:
              'This removes all items from every page and resets the form fields to how they were.' +
              (locked ? ` ${locked === 1 ? 'One locked item stays' : `${locked} locked items stay`}.` : '') +
              ' You can undo this.',
            confirmLabel: 'Clear all',
            danger: true,
          })
          if (ok) useEditor.getState().clearAll()
        })
      }
    >
      Clear everything…
    </MenuItem>
  )
}
