import { RotateCcwClock, ShieldCheck, Signature, TextCursorInput, type LucideIcon } from 'lucide-react'
import { cn } from '../../lib/utils/misc'

const FEATURES: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: TextCursorInput,
    title: 'Fill any form',
    body: 'Fillable fields are detected automatically — or click anywhere on the page to type.',
  },
  {
    icon: Signature,
    title: 'Sign in seconds',
    body: 'Draw, type or upload your signature. It’s saved for next time.',
  },
  {
    icon: ShieldCheck,
    title: 'Private by design',
    body: 'Everything happens on your device. Your files are never uploaded.',
  },
  {
    icon: RotateCcwClock,
    title: 'Pick up where you left off',
    body: 'Your progress is auto-saved in this browser as you work.',
  },
]

export function FeatureTiles({ className }: { className?: string }) {
  return (
    <section aria-label="Why FillFlow" className={className}>
      <ul className="grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
        {FEATURES.map(({ icon: Icon, title, body }, i) => (
          <li
            key={title}
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
              <h3 className="text-[14.5px] font-semibold tracking-[-0.01em] text-fg">{title}</h3>
              <p className="mt-1 text-[13.5px] leading-relaxed text-fg-muted">{body}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
