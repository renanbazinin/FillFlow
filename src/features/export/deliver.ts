import { getT } from '../../i18n'
import { downloadBytes } from '../../lib/utils/misc'

/** Ways to hand the exported file to the user: download, system share sheet, print. */

const asBlob = (bytes: Uint8Array) => new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' })

export function downloadPdf(bytes: Uint8Array, fileName: string): void {
  downloadBytes(bytes, fileName)
}

let shareSupport: boolean | null = null

/** Whether the system share sheet accepts PDF files (mobile, Chrome/Edge on desktop…). */
export function canSharePdf(): boolean {
  if (shareSupport === null) {
    try {
      const probe = new File([new Uint8Array([37])], 'probe.pdf', { type: 'application/pdf' })
      shareSupport = typeof navigator !== 'undefined' && typeof navigator.share === 'function' && !!navigator.canShare?.({ files: [probe] })
    } catch {
      shareSupport = false
    }
  }
  return shareSupport
}

export type ShareResult = 'shared' | 'cancelled' | 'needs-gesture'

export async function sharePdf(bytes: Uint8Array, fileName: string): Promise<ShareResult> {
  const file = new File([bytes as Uint8Array<ArrayBuffer>], fileName, { type: 'application/pdf' })
  try {
    await navigator.share({ files: [file], title: fileName })
    return 'shared'
  } catch (err) {
    const name = err instanceof DOMException ? err.name : ''
    if (name === 'AbortError') return 'cancelled'
    // The click's user activation expired while the file was being prepared.
    if (name === 'NotAllowedError') return 'needs-gesture'
    throw err
  }
}

export type PrintResult = 'dialog' | 'tab' | 'downloaded'

let printFrame: { iframe: HTMLIFrameElement; url: string } | null = null

function cleanupPrintFrame() {
  if (!printFrame) return
  printFrame.iframe.remove()
  URL.revokeObjectURL(printFrame.url)
  printFrame = null
}

/** Chromium desktop can print a PDF from a hidden frame through its built-in viewer. */
function canPrintInFrame(): boolean {
  if (typeof navigator === 'undefined') return false
  if (navigator.pdfViewerEnabled === false) return false
  const ua = navigator.userAgent
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua))
  return !mobile && /Chrome\/|Chromium\/|Edg\//.test(ua) && !/Firefox\//.test(ua)
}

/**
 * Opens the print dialog for the PDF: through a hidden iframe where the browser's PDF viewer
 * supports it, otherwise in a new tab (the user prints from there), and as a last resort
 * (pop-up blocked, no PDF viewer) by downloading it.
 */
export function printPdf(bytes: Uint8Array, fileName: string): PrintResult {
  cleanupPrintFrame()
  const url = URL.createObjectURL(asBlob(bytes))
  if (canPrintInFrame()) {
    const iframe = document.createElement('iframe')
    iframe.title = getT().export.printFrame
    iframe.setAttribute('aria-hidden', 'true')
    iframe.tabIndex = -1
    // Not display:none — hidden frames don't get a layout to print.
    Object.assign(iframe.style, { position: 'fixed', right: '0', bottom: '0', width: '1px', height: '1px', border: '0', opacity: '0', pointerEvents: 'none' })
    iframe.onload = () => {
      // The viewer plugin needs a beat after load before print() targets the document.
      window.setTimeout(() => {
        try {
          iframe.contentWindow?.focus()
          iframe.contentWindow?.print()
        } catch {
          window.open(url, '_blank', 'noopener')
        }
      }, 120)
    }
    iframe.src = url
    document.body.appendChild(iframe)
    printFrame = { iframe, url }
    // Keep the frame until the next print / a generous timeout (the dialog is async in Chrome).
    window.setTimeout(() => printFrame?.iframe === iframe && cleanupPrintFrame(), 10 * 60_000)
    return 'dialog'
  }
  const tab = navigator.pdfViewerEnabled === false ? null : window.open(url, '_blank')
  if (tab) {
    tab.opener = null
    window.setTimeout(() => URL.revokeObjectURL(url), 10 * 60_000)
    return 'tab'
  }
  URL.revokeObjectURL(url)
  downloadBytes(bytes, fileName)
  return 'downloaded'
}
