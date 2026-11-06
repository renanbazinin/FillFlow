import { RotateCcwClock, ShieldCheck, Signature, TextCursorInput, type LucideIcon } from 'lucide-react'
import { useT } from '../../i18n'
import { cn } from '../../lib/utils/misc'

/** The tiles, by their words in `home.features`. */
const FEATURES: { id: 'fill' | 'sign' | 'private' | 'resume'; icon: LucideIcon }[] = [
  { id: 'fill', icon: TextCursorInput },
  { id: 'sign', icon: Signature },
  { id: 'private', icon: ShieldCheck },
  { id: 'resume', icon: RotateCcwClock },
]

export function FeatureTiles({ className }: { className?: string }) {
  const t = useT()
  return (
    <section aria-labelledby="ff-features-title" className={className}>
      {/* The tiles' headings sit under this one, not under whatever section comes before. */}
      <h2 id="ff-features-title" className="sr-only">
        {t.home.features.heading}
      </h2>
      <ul className="grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
        {FEATURES.map(({ id, icon: Icon }, i) => (
          <li
            key={id}
            className={cn(
              'flex gap-3.5 rounded-2xl border border-line bg-surface/70 p-4 shadow-xs backdrop-blur-sm sm:flex-col sm:gap-0 sm:p-5',
              'animate-slide-up [animation-fill-mode:both]',
            )}
            style={{ animationDelay: `${260 + i * 60}ms` }}
          >
            <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent-ink ring-1 ring-inset ring-accent/10">
              <Icon className="size-[18px]" strokeWidth={1.9} />
            </div>
            <div className="min-w-0 sm:mt-4">
              <h3 className="text-[14.5px] font-semibold tracking-[-0.01em] text-fg">{t.home.features[id].title}</h3>
              <p className="mt-1 text-[13.5px] leading-relaxed text-fg-muted">{t.home.features[id].body}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
