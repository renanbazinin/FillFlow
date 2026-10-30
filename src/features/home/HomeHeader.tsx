import { GITHUB_URL, GitHubIcon } from '../../components/brand/GitHubIcon'
import { Logo } from '../../components/brand/Logo'
import { Button } from '../../components/ui/button'
import { ThemeToggle } from './ThemeToggle'

export function HomeHeader() {
  return (
    <header className="flex h-16 items-center justify-between gap-4 sm:h-[72px]">
      <a
        href={import.meta.env.BASE_URL}
        onClick={(e) => {
          // Already home: glide back to the top instead of reloading.
          e.preventDefault()
          e.currentTarget.closest('[data-home-scroll]')?.scrollTo({ top: 0, behavior: 'smooth' })
        }}
        className="-m-1.5 rounded-lg p-1.5"
        aria-label="FillFlow home"
      >
        <Logo />
      </a>
      <nav className="flex items-center gap-1.5 sm:gap-2" aria-label="Site">
        <Button asChild variant="ghost" size="sm" className="gap-2 px-2.5 text-fg-muted max-sm:size-9 max-sm:px-0">
          <a href={GITHUB_URL} target="_blank" rel="noreferrer" aria-label="FillFlow on GitHub">
            <GitHubIcon className="size-[17px]" />
            <span className="max-sm:hidden">GitHub</span>
          </a>
        </Button>
        <ThemeToggle />
      </nav>
    </header>
  )
}
