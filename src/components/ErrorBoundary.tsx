import { Component, type ReactNode } from 'react'
import { RotateCw } from 'lucide-react'
import { Logo } from './brand/Logo'
import { Button } from './ui/button'

interface ErrorBoundaryProps {
  /** Shown instead of the children once they have crashed (nothing by default). */
  fallback?: ReactNode
  children: ReactNode
}

/** Keeps a render error in one part of the UI from unmounting the whole app. React logs it. */
export class ErrorBoundary extends Component<ErrorBoundaryProps, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    return this.state.failed ? (this.props.fallback ?? null) : this.props.children
  }
}

/** Last resort when the app itself can't render: explain, and offer a reload. */
export function CrashScreen() {
  return (
    <main className="grid min-h-full place-items-center bg-canvas p-4">
      <div role="alert" className="flex w-full max-w-sm flex-col items-center rounded-2xl border border-line bg-surface px-6 pb-6 pt-7 text-center shadow-float">
        <Logo />
        <h1 className="mt-6 text-[17px] font-semibold tracking-[-0.01em] text-fg">Something went wrong</h1>
        <p className="mt-1.5 text-sm text-fg-muted text-pretty">
          FillFlow ran into an unexpected problem. Reload the page to continue — work saved on this device is kept.
        </p>
        <Button variant="primary" className="mt-5" onClick={() => window.location.reload()}>
          <RotateCw />
          Reload
        </Button>
      </div>
    </main>
  )
}
