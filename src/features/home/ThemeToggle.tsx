import { ToggleGroup } from 'radix-ui'
import { Tooltip } from '../../components/ui/tooltip'
import { useT } from '../../i18n'
import { cn } from '../../lib/utils/misc'
import { setThemePreference, useTheme, type ThemePreference } from '../../lib/theme'
import { THEME_OPTIONS } from './themeOptions'

/** Compact light / dark / system switch (40px targets on touch screens). */
export function ThemeToggle({ className }: { className?: string }) {
  const { preference } = useTheme()
  const t = useT()
  return (
    <ToggleGroup.Root
      type="single"
      value={preference}
      onValueChange={(v) => v && setThemePreference(v as ThemePreference)}
      aria-label={t.shell.theme.label}
      className={cn('inline-flex items-center gap-0.5 rounded-full border border-line bg-surface-2/80 p-0.5', className)}
    >
      {THEME_OPTIONS.map(({ value, name, icon: Icon }) => (
        <Tooltip key={value} content={name(t)}>
          <ToggleGroup.Item
            value={value}
            aria-label={name(t)}
            className="inline-flex size-7 items-center justify-center rounded-full text-fg-subtle transition-colors hover:text-fg data-[state=on]:bg-surface data-[state=on]:text-fg data-[state=on]:shadow-xs pointer-coarse:size-10"
          >
            <Icon className="size-[15px]" strokeWidth={2} />
          </ToggleGroup.Item>
        </Tooltip>
      ))}
    </ToggleGroup.Root>
  )
}
