/// <reference lib="dom" />
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, type Download, type Locator, type Page } from '@playwright/test'
import type { ViewSize } from './pdf'

/**
 * Helpers that drive the app through its documented, user-facing contracts only:
 *  - each rendered page is an element with `data-page-index="<0-based>"` holding a <canvas>,
 *  - each AcroForm widget on a page carries `data-form-field="<field name>"`,
 *  - tool buttons are labelled with the tool name ("Text", "Checkmark", …),
 *  - the top bar has a "Download" button; the export dialog a "Download PDF" button.
 * Where the UI may legitimately vary (file picker, focus handling), they try the usual options.
 */

export const SAMPLE_PDF = fileURLToPath(new URL('../../public/samples/sample-form.pdf', import.meta.url))

export function fixture(name: string): string {
  return fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url))
}

export interface Point {
  x: number
  y: number
}

/** Places on page 2 of the sample form (view space, points from the top-left; A4). */
export const SAMPLE_SPOTS = {
  /** Just above the "Full name" line of the emergency contact section. */
  emergencyName: { x: 110, y: 197 },
  /** Center of the "Yes" box of the allergies question. */
  allergiesYes: { x: 440.8, y: 318 },
} satisfies Record<string, Point>

/** Collects uncaught page errors so a test can assert there were none. */
export function trackPageErrors(page: Page): Error[] {
  const errors: Error[] = []
  page.on('pageerror', (err) => errors.push(err))
  return errors
}

export async function gotoHome(page: Page): Promise<void> {
  await page.goto('./')
  await expect(page.locator('#root > *').first()).toBeVisible()
}

/** Opens a local PDF the way a user would: file input, file picker, or a drop on the window. */
export async function openPdf(page: Page, file: string): Promise<void> {
  const inputs = page.locator('input[type="file"]')
  for (let i = 0, n = await inputs.count(); i < n; i++) {
    const accept = (await inputs.nth(i).getAttribute('accept')) ?? ''
    if (!accept || /pdf/i.test(accept)) {
      await inputs.nth(i).setInputFiles(file)
      return
    }
  }
  const opener = page
    .getByRole('button', { name: /(choose|open|browse|select|upload)\b.*\b(pdf|file)/i })
    .filter({ visible: true })
    .first()
  if (await opener.count()) {
    const chooser = page.waitForEvent('filechooser', { timeout: 10_000 })
    await opener.click()
    await (await chooser).setFiles(file)
    return
  }
  await dropFile(page, file)
}

async function dropFile(page: Page, file: string): Promise<void> {
  const data = (await readFile(file)).toString('base64')
  const dataTransfer = await page.evaluateHandle(
    ({ data, name }) => {
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
      const dt = new DataTransfer()
      dt.items.add(new File([bytes], name, { type: 'application/pdf' }))
      return dt
    },
    { data, name: basename(file) },
  )
  for (const type of ['dragenter', 'dragover', 'drop']) await page.dispatchEvent('body', type, { dataTransfer })
}

/**
 * The on-screen element of a PDF page. Thumbnails may reuse `data-page-index`, so when there
 * are several matches the largest one (the page in the viewer) wins.
 */
export async function pdfPage(page: Page, index: number): Promise<Locator> {
  const all = page.locator(`[data-page-index="${index}"]`)
  await expect(all.first()).toBeAttached({ timeout: 30_000 })
  const n = await all.count()
  if (n === 1) return all.first()
  const areas = await all.evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect()
      return r.width * r.height
    }),
  )
  return all.nth(areas.indexOf(Math.max(...areas)))
}

/** Scrolls a page into view and waits until its canvas is rendered. */
export async function showPage(page: Page, index: number): Promise<Locator> {
  const el = await pdfPage(page, index)
  await el.scrollIntoViewIfNeeded()
  await expect(el.locator('canvas').first()).toBeVisible({ timeout: 30_000 })
  return el
}

/** Screen box of the page itself (the canvas when it covers the whole page). */
async function pageBox(el: Locator, size: ViewSize) {
  const canvas = el.locator('canvas').first()
  const cb = (await canvas.count()) ? await canvas.boundingBox() : null
  if (cb && cb.height > 0 && Math.abs(cb.width / cb.height - size.width / size.height) < 0.01) return cb
  const eb = await el.boundingBox()
  if (!eb) throw new Error('The page is not visible')
  return eb
}

/**
 * Clicks a point given in the page's view space (PDF points from the top-left of the page as
 * displayed). Scrolls first so the point sits in the middle band of the window, clear of the
 * top bar and the floating tool dock.
 */
export async function clickPagePoint(page: Page, index: number, pt: Point, size: ViewSize): Promise<void> {
  const el = await showPage(page, index)
  const vh = page.viewportSize()?.height ?? 800
  for (let attempt = 0; attempt < 8; attempt++) {
    const box = await pageBox(el, size)
    const x = box.x + (pt.x / size.width) * box.width
    const y = box.y + (pt.y / size.height) * box.height
    if (y > vh * 0.2 && y < vh * 0.7) {
      await page.mouse.click(x, y)
      return
    }
    await page.mouse.move(box.x + box.width / 2, vh / 2)
    await page.mouse.wheel(0, y - vh * 0.45)
    await page.waitForTimeout(150)
  }
  throw new Error(`Could not bring (${pt.x}, ${pt.y}) on page ${index + 1} into view`)
}

/** Picks a tool from the dock (falls back to its keyboard shortcut). */
export async function selectTool(page: Page, label: string, shortcut?: string): Promise<void> {
  const button = page.getByRole('button', { name: label, exact: true }).filter({ visible: true }).first()
  if (await button.count()) {
    const pressable = (await button.getAttribute('aria-pressed')) !== null
    await button.click()
    if (pressable) await expect(button).toHaveAttribute('aria-pressed', 'true')
    return
  }
  if (!shortcut) throw new Error(`No "${label}" tool button`)
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.keyboard.press(shortcut.toLowerCase())
}

/** Waits until a text editor (input, textarea or contenteditable) has focus. */
export async function expectEditing(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null
        if (!el) return false
        if (el.isContentEditable || el.tagName === 'TEXTAREA') return true
        return el.tagName === 'INPUT' && ['text', 'search', ''].includes((el as HTMLInputElement).type)
      }),
    )
    .toBe(true)
}

/** Types into a newly placed text element and leaves editing mode. */
export async function typeAndCommit(page: Page, text: string): Promise<void> {
  await expectEditing(page)
  await page.keyboard.type(text)
  await page.keyboard.press('Escape')
}

function attr(value: string): string {
  return value.replace(/["\\]/g, '\\$&')
}

/** A form field's widget on the page (or, failing that, anywhere, e.g. the form panel). */
export async function formField(page: Page, name: string): Promise<Locator> {
  const anywhere = page.locator(`[data-form-field="${attr(name)}"]`)
  await expect(anywhere.first()).toBeAttached({ timeout: 30_000 })
  const onPage = page.locator(`[data-page-index] [data-form-field="${attr(name)}"]`)
  return (await onPage.count()) ? onPage.first() : anywhere.first()
}

function textControl(root: Locator): Locator {
  return root.locator('xpath=self::input | self::textarea | .//input | .//textarea').first()
}

export async function fillFormField(page: Page, name: string, value: string): Promise<void> {
  const root = await formField(page, name)
  await root.scrollIntoViewIfNeeded()
  const control = textControl(root)
  if (await control.count()) {
    await control.fill(value)
    await control.blur()
  } else {
    await root.click()
    await page.keyboard.type(value)
    await page.keyboard.press('Tab')
  }
}

export async function expectFormFieldValue(page: Page, name: string, value: string): Promise<void> {
  const root = await formField(page, name)
  const control = textControl(root)
  if (await control.count()) await expect(control).toHaveValue(value)
  else await expect(root).toContainText(value)
}

/** Opens the export dialog, downloads the PDF and returns its bytes. */
export async function downloadPdf(page: Page): Promise<{ bytes: Uint8Array; name: string }> {
  const download = page.waitForEvent('download', { timeout: 60_000 })
  await page.getByRole('button', { name: /^download$/i }).filter({ visible: true }).first().click()
  const confirm = page.getByRole('button', { name: /download pdf/i }).filter({ visible: true }).first()
  // Some flows download straight away; otherwise confirm in the dialog.
  const first = await Promise.race([
    download.then(() => 'download' as const),
    confirm.waitFor({ state: 'visible', timeout: 20_000 }).then(() => 'dialog' as const),
  ])
  if (first === 'dialog') await confirm.click()
  const file: Download = await download
  const path = await file.path()
  return { bytes: new Uint8Array(await readFile(path)), name: file.suggestedFilename() }
}

/** The "open" control of a recent document on the home screen. */
export async function recentDocument(page: Page, name: RegExp): Promise<Locator> {
  const open = page.getByRole('button', { name: new RegExp(`^open\\b.*${name.source}`, 'i') })
  await expect(open.or(page.getByRole('button', { name })).first()).toBeVisible({ timeout: 20_000 })
  return (await open.count()) ? open.first() : page.getByRole('button', { name }).first()
}

/**
 * Reads every record of an IndexedDB object store from the page. Never creates the database
 * (that would leave it without its object store and break the app).
 */
export function readIndexedDb<T = unknown>(page: Page, dbName: string, storeName: string): Promise<T[]> {
  return page.evaluate(
    ([dbName, storeName]) =>
      new Promise<T[]>((resolve) => {
        const req = indexedDB.open(dbName)
        req.onupgradeneeded = () => req.transaction?.abort()
        req.onerror = () => resolve([])
        req.onsuccess = () => {
          const db = req.result
          if (!db.objectStoreNames.contains(storeName)) {
            db.close()
            resolve([])
            return
          }
          const all = db.transaction(storeName, 'readonly').objectStore(storeName).getAll()
          all.onsuccess = () => {
            db.close()
            resolve(all.result as T[])
          }
          all.onerror = () => {
            db.close()
            resolve([])
          }
        }
      }),
    [dbName, storeName] as const,
  )
}

export interface StoredSession {
  docId: string
  fileName: string
  elements: { kind: string; page: number; text?: string }[]
  formValues: Record<string, unknown>
}

export interface StoredRecent {
  id: string
  name: string
  pageCount: number
  thumbnail?: string
  filledCount?: number
}

export const storedSessions = (page: Page) => readIndexedDb<StoredSession>(page, 'fillflow-sessions', 'sessions')
export const storedRecents = (page: Page) => readIndexedDb<StoredRecent>(page, 'fillflow-recents', 'recents')
