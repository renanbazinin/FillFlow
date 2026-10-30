import '@fontsource/instrument-serif/latin-400-italic.css'
import { ArrowUpRight } from 'lucide-react'
import { GITHUB_URL, GitHubIcon } from '../../components/brand/GitHubIcon'
import { Dropzone } from './Dropzone'
import { FeatureTiles } from './FeatureTiles'
import { HomeHeader } from './HomeHeader'
import { RecentDocuments } from './RecentDocuments'
import { usePasteToOpen } from './usePasteToOpen'
import { useShellShortcuts } from '../editor/useShellShortcuts'

/** Landing page: hero, dropzone (+ sample), recent documents, feature highlights. */
export function HomeScreen() {
  usePasteToOpen()
  useShellShortcuts('home')
  return (
    <div data-home-scroll className="relative h-full overflow-y-auto overflow-x-hidden bg-canvas scrollbar-thin">
      <Backdrop />
      <div className="relative mx-auto flex min-h-full max-w-6xl flex-col px-4 sm:px-6 lg:px-8">
        <HomeHeader />
        <main className="flex-1 pb-16">
          <Hero />
          <Dropzone className="mx-auto mt-9 max-w-2xl animate-slide-up [animation-delay:160ms] [animation-fill-mode:both] sm:mt-10" />
          <RecentDocuments className="mx-auto mt-16 max-w-5xl sm:mt-20" />
          <FeatureTiles className="mx-auto mt-16 max-w-5xl sm:mt-20" />
        </main>
        <Footer />
      </div>
    </div>
  )
}

function Hero() {
  return (
    <section className="mx-auto max-w-3xl pt-8 text-center sm:pt-12">
      <a
        href={GITHUB_URL}
        target="_blank"
        rel="noreferrer"
        className="group inline-flex h-7 items-center gap-2 rounded-full border border-line bg-surface/70 pl-2.5 pr-2 text-[12.5px] font-medium text-fg-muted shadow-xs backdrop-blur transition-colors animate-slide-up [animation-fill-mode:both] hover:border-line-strong hover:text-fg"
      >
        <span className="size-1.5 rounded-full bg-brand-gradient" aria-hidden />
        Free &amp; open source
        <span className="h-3 w-px bg-line-strong" aria-hidden />
        <GitHubIcon className="size-3.5" />
        <ArrowUpRight className="-ml-1 size-3.5 opacity-60 transition-transform duration-200 group-hover:-translate-y-px group-hover:translate-x-px" />
      </a>
      <h1 className="mt-6 font-display text-[44px] leading-[1.02] tracking-[-0.015em] text-fg text-balance animate-slide-up [animation-delay:60ms] [animation-fill-mode:both] min-[400px]:text-[50px] sm:mt-7 sm:text-[68px] lg:text-[76px]">
        Fill &amp; sign any PDF, <br className="max-sm:hidden" />
        <em className="text-brand-gradient pr-[0.06em] italic [box-decoration-break:clone]">right in your browser.</em>
      </h1>
      <p className="mx-auto mt-5 max-w-xl text-[15.5px] leading-relaxed text-fg-muted text-pretty animate-slide-up [animation-delay:110ms] [animation-fill-mode:both] sm:mt-6 sm:text-[17px]">
        Type on any form, tick boxes, add your signature and download. Free, no sign-up — your files never leave your device.
      </p>
    </section>
  )
}

/** Soft brand glow behind the hero and a faint dot grid that fades out. */
function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[900px] overflow-hidden">
      <div
        className="absolute inset-0 opacity-100"
        style={{
          backgroundImage: 'radial-gradient(var(--ff-canvas-dot) 1px, transparent 1.3px)',
          backgroundSize: '22px 22px',
          maskImage: 'radial-gradient(ellipse 70% 60% at 50% 0%, #000 30%, transparent 100%)',
          WebkitMaskImage: 'radial-gradient(ellipse 70% 60% at 50% 0%, #000 30%, transparent 100%)',
        }}
      />
      <div
        className="absolute left-1/2 top-[-260px] h-[680px] w-[1200px] -translate-x-1/2 opacity-70 dark:opacity-100"
        style={{
          background:
            'radial-gradient(closest-side at 38% 55%, rgb(31 111 235 / 0.16), transparent 70%), radial-gradient(closest-side at 64% 48%, rgb(20 184 166 / 0.13), transparent 72%)',
        }}
      />
    </div>
  )
}

function Footer() {
  return (
    <footer className="flex flex-col items-center justify-between gap-2 border-t border-line py-6 text-[12.5px] text-fg-subtle sm:flex-row">
      <p>
        <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="font-medium text-fg-muted underline-offset-4 hover:text-fg hover:underline">
          Open source on GitHub
        </a>
        <span className="mx-2" aria-hidden>·</span>No accounts<span className="mx-2" aria-hidden>·</span>No tracking
      </p>
      <p>
        Built with{' '}
        <a href="https://mozilla.github.io/pdf.js/" target="_blank" rel="noreferrer" className="underline-offset-4 hover:text-fg hover:underline">
          PDF.js
        </a>{' '}
        and{' '}
        <a href="https://pdf-lib.js.org/" target="_blank" rel="noreferrer" className="underline-offset-4 hover:text-fg hover:underline">
          pdf-lib
        </a>
      </p>
    </footer>
  )
}
