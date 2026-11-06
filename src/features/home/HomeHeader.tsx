import { GITHUB_URL, GitHubIcon } from '../../components/brand/GitHubIcon'
import { Logo } from '../../components/brand/Logo'
import { LanguageButton } from '../../components/LanguageSwitch'
import { Button } from '../../components/ui/button'
import { useT } from '../../i18n'
import { scrollBehavior } from '../../lib/utils/motion'
import { ThemeToggle } from './ThemeToggle'

export function HomeHeader() {
  const t = useT()
  return (
    <header className="flex h-16 items-center justify-between gap-4 sm:h-[72px]">
      <a
        href={import.meta.env.BASE_URL}
        onClick={(e) => {
          // Already home: glide back to the top instead of reloading.
          e.preventDefault()
          e.currentTarget.closest('[data-home-scroll]')?.scrollTo({ top: 0, behavior: scrollBehavior() })
        }}
        className="-m-1.5 rounded-lg p-1.5"
        aria-label={t.shell.home.homeLink}
      >
        <Logo />
      </a>
      <nav className="flex items-center gap-1.5 sm:gap-2" aria-label={t.shell.home.nav}>
        <Button asChild variant="ghost" size="sm" className="gap-2 px-2.5 text-fg-muted max-sm:size-9 max-sm:px-0">
          <a href={GITHUB_URL} target="_blank" rel="noreferrer" aria-label={t.shell.home.github}>
            <GitHubIcon className="size-[17px]" />
            <span className="max-sm:hidden">GitHub</span>
          </a>
        </Button>
        <LanguageButton />
        <ThemeToggle />
      </nav>
    </header>
  )
}
