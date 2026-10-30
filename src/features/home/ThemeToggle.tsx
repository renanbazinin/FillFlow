import { ToggleGroup } from 'radix-ui'
import { Tooltip } from '../../components/ui/tooltip'
import { cn } from '../../lib/utils/misc'
import { setThemePreference, useTheme, type ThemePreference } from '../../lib/theme'
import { THEME_OPTIONS } from './themeOptions'

/** Compact light / dark / system switch. */
export function ThemeToggle({ className }: { className?: string }) {
  const { preference } = useTheme()
  return (
    <ToggleGroup.Root
      type="single"
      value={preference}
      onValueChange={(v) => v && setThemePreference(v as ThemePreference)}
      aria-label="Theme"
      className={cn('inline-flex items-center gap-0.5 rounded-full border border-line bg-surface-2/80 p-0.5', className)}
    >
      {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
        <Tooltip key={value} content={`${label} theme`}>
          <ToggleGroup.Item
            value={value}
            aria-label={`${label} theme`}
            className="inline-flex size-7 items-center justify-center rounded-full text-fg-subtle transition-colors hover:text-fg data-[state=on]:bg-surface data-[state=on]:text-fg data-[state=on]:shadow-xs"
          >
            <Icon className="size-[15px]" strokeWidth={2} />
          </ToggleGroup.Item>
        </Tooltip>
      ))}
    </ToggleGroup.Root>
  )
}
