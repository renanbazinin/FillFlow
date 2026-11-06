import { Languages } from 'lucide-react'
import { isLocale, LANGUAGE_NAMES, LOCALES, setLocale, useLocale, useT, type Locale } from '../i18n'
import { cn } from '../lib/utils/misc'
import { Button } from './ui/button'
import { MenuLabel, MenuRadioGroup, MenuRadioItem } from './ui/menu'
import { Tooltip } from './ui/tooltip'

/** The language after this one (with two, the other one). */
const nextLocale = (locale: Locale): Locale => LOCALES[(LOCALES.indexOf(locale) + 1) % LOCALES.length]

/**
 * The home page's language switch: offers the other language, named in its own words ("עברית" in
 * English, "English" in Hebrew); a click switches to it and remembers the choice on this device.
 */
export function LanguageButton({ className }: { className?: string }) {
  const t = useT()
  const other = nextLocale(useLocale())
  return (
    <Tooltip content={t.shell.language.label}>
      <Button variant="ghost" size="sm" onClick={() => setLocale(other)} className={cn('gap-2 px-2.5 text-fg-muted max-sm:px-2', className)}>
        <Languages className="max-sm:hidden" />
        <span lang={other}>{LANGUAGE_NAMES[other]}</span>
      </Button>
    </Tooltip>
  )
}

/** The editor menu's "Language" choices, each named in its own words. Choosing one closes the menu. */
export function LanguageMenuItems() {
  const t = useT()
  const locale = useLocale()
  return (
    <>
      <MenuLabel>{t.shell.language.label}</MenuLabel>
      <MenuRadioGroup value={locale} onValueChange={(v) => isLocale(v) && setLocale(v)}>
        {LOCALES.map((l) => (
          <MenuRadioItem key={l} value={l}>
            <span lang={l}>{LANGUAGE_NAMES[l]}</span>
          </MenuRadioItem>
        ))}
      </MenuRadioGroup>
    </>
  )
}
