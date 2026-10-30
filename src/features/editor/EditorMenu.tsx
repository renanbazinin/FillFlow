import { Ellipsis, Eraser, FolderOpen, Keyboard, MoveHorizontal, PanelLeft, PanelRight, X } from 'lucide-react'
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
import { closeDocumentSafely } from './leaveGuard'
import { SHORTCUTS, shortcutLabel } from './shortcuts'
import { usePointerAwareClose } from './usePointerAwareClose'

/** Let the menu finish closing (and hand focus back) before a dialog takes over. */
const afterMenuCloses = (fn: () => void) => window.setTimeout(fn, 0)

/** Top-bar overflow menu. `compact` adds the controls that don't fit a phone's top bar. */
export function EditorMenu({ compact }: { compact: boolean }) {
  const { preference } = useTheme()
  const hasForm = useEditor((s) => (s.doc?.formFields.length ?? 0) > 0)
  const closeHandlers = usePointerAwareClose()
  return (
    <Menu>
      <MenuTrigger asChild>
        <IconButton label="More" icon={<Ellipsis />} />
      </MenuTrigger>
      <MenuContent className="w-60 [&_[role^=menuitem]]:pointer-coarse:h-11" {...closeHandlers}>
        <MenuItem icon={<FolderOpen />} shortcut={shortcutLabel(SHORTCUTS.open)} onSelect={() => void chooseAndOpenPdf()}>
          Open another PDF…
        </MenuItem>
        {compact && (
          <>
            <MenuSeparator />
            <MenuItem icon={<PanelLeft />} onSelect={() => useEditor.getState().setLeftPanelOpen(true)}>
              Pages
            </MenuItem>
            <MenuItem icon={<PanelRight />} onSelect={() => useEditor.getState().setRightPanelOpen(true)}>
              {hasForm ? 'Form & items' : 'Items'}
            </MenuItem>
            <MenuItem icon={<MoveHorizontal />} onSelect={() => viewer.fitWidth()}>
              Fit to width
            </MenuItem>
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
        <ClearAllItem />
        <MenuItem icon={<X />} onSelect={() => afterMenuCloses(() => void closeDocumentSafely())}>
          Close document
        </MenuItem>
      </MenuContent>
    </Menu>
  )
}

/** Only mounted while the menu is open, so the (cheap but non-trivial) count isn't live. */
function ClearAllItem() {
  const hasWork = useEditor((s) => filledCount(s) > 0)
  return (
    <MenuItem
      icon={<Eraser />}
      danger
      disabled={!hasWork}
      onSelect={() =>
        afterMenuCloses(async () => {
          const ok = await confirm({
            title: 'Clear everything you added?',
            description: 'This removes all items from every page and resets the form fields to how they were. You can undo this.',
            confirmLabel: 'Clear all',
            danger: true,
          })
          if (ok) useEditor.getState().clearAll()
        })
      }
    >
      Clear all items…
    </MenuItem>
  )
}
