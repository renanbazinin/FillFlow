import { useState } from 'react'
import { ArrowRight, FolderOpen, LockKeyhole } from 'lucide-react'
import { Kbd, Spinner } from '../../components/ui/controls'
import { cn, modKeyLabel } from '../../lib/utils/misc'
import { useFileDrag } from './fileDrag'
import { chooseAndOpenPdf, openSampleForm } from './openFile'

/**
 * The main call to action: click to choose a PDF, or drop one anywhere on the window (the
 * window-level listeners live in FileDropOverlay; this card lights up while a drag is active).
 */
export function Dropzone({ className }: { className?: string }) {
  const drag = useFileDrag()
  const ready = drag.active && drag.kind !== 'other'
  const [sampleBusy, setSampleBusy] = useState(false)

  const openSample = async () => {
    if (sampleBusy) return
    setSampleBusy(true)
    try {
      await openSampleForm()
    } finally {
      setSampleBusy(false)
    }
  }

  return (
    <div
      className={cn(
        'relative rounded-[26px] border bg-surface p-2 shadow-float transition-[border-color,box-shadow,translate] duration-300 ease-out',
        ready ? '-translate-y-1 border-accent/60 shadow-[0_0_0_6px_var(--ff-accent-soft),var(--shadow-float)]' : 'border-line',
        className,
      )}
    >
      <button
        type="button"
        onClick={() => void chooseAndOpenPdf()}
        aria-label="Choose a PDF to open"
        aria-describedby="ff-dropzone-hint"
        className={cn(
          'group relative flex w-full flex-col items-center overflow-hidden rounded-[19px] border-[1.5px] border-dashed px-5 pb-8 pt-9 text-center transition-colors duration-200 focus-visible:outline-offset-4 sm:pb-9 sm:pt-10',
          ready
            ? 'border-accent/70 bg-accent-soft'
            : 'border-line-strong hover:border-accent/45 hover:bg-accent-soft/50',
        )}
      >
        <DropIllustration active={ready} />
        <span className="mt-5 text-[19px] font-semibold tracking-[-0.015em] text-fg sm:text-[21px]">
          {ready ? (
            'Drop to open your PDF'
          ) : (
            <>
              <span className="pointer-coarse:hidden">Drop a PDF here</span>
              <span className="hidden pointer-coarse:inline">Open a PDF to fill</span>
            </>
          )}
        </span>
        <span id="ff-dropzone-hint" className="mt-1.5 max-w-sm text-[14px] leading-relaxed text-fg-muted text-balance">
          Forms, contracts, applications&nbsp;— any PDF works.
        </span>
        <span
          className={cn(
            'mt-6 inline-flex h-10 items-center gap-2 rounded-xl px-[18px] text-[14px] font-medium shadow-xs transition-[background-color,opacity] duration-200',
            'bg-accent text-accent-fg group-hover:bg-accent-hover',
            ready && 'opacity-0',
          )}
        >
          <FolderOpen className="size-4" />
          Choose PDF
        </span>
        <span className={cn('mt-3.5 flex items-center gap-1.5 text-[12.5px] text-fg-subtle pointer-coarse:hidden', ready && 'opacity-0')}>
          or paste one with
          <Kbd>{modKeyLabel}</Kbd>
          <Kbd>V</Kbd>
        </span>
      </button>

      <div className="flex flex-col items-center justify-between gap-2.5 px-3 pb-1.5 pt-3 text-[13px] sm:flex-row sm:pb-1">
        <span className="inline-flex items-center gap-1.5 text-fg-subtle">
          <LockKeyhole className="size-3.5" />
          Stays on your device — nothing is uploaded
        </span>
        <button
          type="button"
          onClick={() => void openSample()}
          disabled={sampleBusy}
          className="group/sample inline-flex h-8 items-center gap-1.5 rounded-lg px-2 font-medium text-accent-ink transition-colors hover:bg-accent-soft disabled:opacity-70 sm:-mr-1"
        >
          or try a sample form
          {sampleBusy ? (
            <Spinner className="size-3.5" />
          ) : (
            <ArrowRight className="size-3.5 transition-transform duration-200 group-hover/sample:translate-x-0.5" />
          )}
        </button>
      </div>
    </div>
  )
}

/**
 * A little form page with a field + caret (echoing the logo) and an upload badge.
 * The paper stays white in both themes, like real pages.
 */
function DropIllustration({ active }: { active: boolean }) {
  const lift = 'transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] [transform-box:fill-box] origin-center'
  return (
    <svg viewBox="0 0 112 92" className="h-[84px] w-[102px] overflow-visible sm:h-[92px] sm:w-[112px]" aria-hidden>
      <defs>
        <linearGradient id="ff-drop-badge" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#1f6feb" />
          <stop offset="1" stopColor="#14b8a6" />
        </linearGradient>
        <filter id="ff-drop-shadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="3" stdDeviation="4" floodColor="#0e1726" floodOpacity="0.14" />
        </filter>
      </defs>
      {/* back sheet */}
      <g className={cn(lift, active ? '-rotate-[14deg] -translate-x-1.5' : '-rotate-[8deg] group-hover:-rotate-[11deg]')}>
        <rect x="30" y="10" width="50" height="64" rx="7" className="fill-surface-3 stroke-line-strong" strokeWidth="1" />
      </g>
      {/* front sheet */}
      <g
        filter="url(#ff-drop-shadow)"
        className={cn(lift, active ? '-translate-y-2 rotate-[5deg]' : 'rotate-[3deg] group-hover:-translate-y-1 group-hover:rotate-[5deg]')}
      >
        <rect x="32" y="14" width="50" height="64" rx="7" fill="#ffffff" stroke="#dfe3ea" strokeWidth="1" />
        <rect x="39" y="23" width="18" height="3" rx="1.5" fill="#d3d9e2" />
        <rect x="39" y="29.5" width="36" height="10" rx="3" fill="rgb(37 99 235 / 0.08)" stroke="rgb(37 99 235 / 0.45)" strokeWidth="1" />
        <path d="M43.5 32v4" stroke="#2563eb" strokeWidth="1.6" strokeLinecap="round" />
        <rect x="39" y="45" width="14" height="3" rx="1.5" fill="#d3d9e2" />
        <rect x="39" y="51.5" width="36" height="10" rx="3" fill="#f3f5f8" stroke="#dfe3ea" strokeWidth="1" />
        <path d="M41 71c3-4 5-5 6-2.6s2.8 2.2 5-0.6 3.6-2.4 4.6-.6 2.6 1.5 4.6-.4" fill="none" stroke="#1d4ed8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      {/* badge */}
      <g className={cn(lift, active ? 'scale-110 -translate-y-1' : 'group-hover:-translate-y-0.5')}>
        <circle cx="84" cy="70" r="14" fill="url(#ff-drop-badge)" />
        <circle cx="84" cy="70" r="14" fill="none" className="stroke-surface" strokeWidth="3" />
        <path d="M84 76.5v-12.5M78.8 68.6 84 63.6l5.2 5" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  )
}
