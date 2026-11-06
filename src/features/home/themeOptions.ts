import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react'
import type { Messages } from '../../i18n'
import type { ThemePreference } from '../../lib/theme'

export interface ThemeOption {
  value: ThemePreference
  icon: LucideIcon
  /** "Light", as a menu row under the "Theme" heading. */
  label: (t: Messages) => string
  /** "Light theme", on its own (the theme switch's buttons). */
  name: (t: Messages) => string
}

export const THEME_OPTIONS: ThemeOption[] = [
  { value: 'light', icon: Sun, label: (t) => t.shell.theme.light, name: (t) => t.shell.theme.lightName },
  { value: 'dark', icon: Moon, label: (t) => t.shell.theme.dark, name: (t) => t.shell.theme.darkName },
  { value: 'system', icon: Monitor, label: (t) => t.shell.theme.system, name: (t) => t.shell.theme.systemName },
]
