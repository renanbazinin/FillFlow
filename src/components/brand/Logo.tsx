import { useId } from 'react'
import { cn } from '../../lib/utils/misc'

/**
 * The FillFlow mark: a rounded text field with an I-beam cursor whose outline flows out
 * into an arrow sweeping upward. Drawn on a 32-unit grid with round caps so it stays crisp
 * from 16px (favicon) to hero sizes. Keep `public/favicon.svg` in sync with these paths.
 */
const FIELD = 'M16 7.5H8.5a5 5 0 0 0-5 5v7.5a5 5 0 0 0 5 5H15C21.5 25 26 21 26.5 6.5'
const ARROW_HEAD = 'M23.34 9.56 26.5 6.5l2.95 3.27'
const CURSOR = 'M10.5 12.25v8M8.75 12.25h3.5M8.75 20.25h3.5'

export const BRAND_BLUE = '#1f6feb'
export const BRAND_TEAL = '#14b8a6'

export interface LogoMarkProps {
  className?: string
  /**
   * 'glyph' (default): gradient strokes on a transparent background.
   * 'tile': white strokes on a rounded gradient square (app-icon style).
   */
  variant?: 'glyph' | 'tile'
  /** Accessible name; omit when the mark is decorative (e.g. inside a labelled button). */
  title?: string
}

export function LogoMark({ className, variant = 'glyph', title }: LogoMarkProps) {
  // useId output can contain characters that are awkward inside url(#…) references.
  const gradientId = `ff-logo-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const a11y = title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': true }
  const glyph = (
    <>
      <path d={FIELD} />
      <path d={ARROW_HEAD} />
      <path d={CURSOR} />
    </>
  )

  if (variant === 'tile') {
    return (
      <svg viewBox="0 0 32 32" className={cn('size-8 shrink-0', className)} {...a11y}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="32" x2="32" y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor={BRAND_BLUE} />
            <stop offset="1" stopColor={BRAND_TEAL} />
          </linearGradient>
        </defs>
        <rect width="32" height="32" rx="8.5" fill={`url(#${gradientId})`} />
        <g
          transform="translate(16 16.1) scale(0.72) translate(-16.5 -15.75)"
          fill="none"
          stroke="#fff"
          strokeWidth={3.2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {glyph}
        </g>
      </svg>
    )
  }

  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      stroke={`url(#${gradientId})`}
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('size-7 shrink-0', className)}
      {...a11y}
    >
      <defs>
        <linearGradient id={gradientId} x1="3" y1="26" x2="30" y2="5" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={BRAND_BLUE} />
          <stop offset="1" stopColor={BRAND_TEAL} />
        </linearGradient>
      </defs>
      {glyph}
    </svg>
  )
}

export interface LogoProps {
  className?: string
  /** Size preset for mark + wordmark. */
  size?: 'sm' | 'md' | 'lg'
}

const SIZES = {
  sm: { mark: 'size-6', word: 'text-[15px]', gap: 'gap-1.5' },
  md: { mark: 'size-7', word: 'text-[17px]', gap: 'gap-2' },
  lg: { mark: 'size-9', word: 'text-[22px]', gap: 'gap-2.5' },
} as const

/** Mark + "FillFlow" wordmark ("Flow" in the brand gradient). */
export function Logo({ className, size = 'md' }: LogoProps) {
  const s = SIZES[size]
  return (
    <span className={cn('inline-flex items-center', s.gap, className)} role="img" aria-label="FillFlow">
      <LogoMark className={s.mark} />
      <span aria-hidden className={cn('font-semibold leading-none tracking-[-0.025em] text-fg', s.word)}>
        Fill<span className="text-brand-gradient">Flow</span>
      </span>
    </span>
  )
}
