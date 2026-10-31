import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  SAMPLE_PDF,
  SAMPLE_SPOTS,
  clickPagePoint,
  expectEditing,
  fillFormField,
  fixture,
  formField,
  gotoHome,
  openPdf,
  readIndexedDb,
  recentDocument,
  selectTool,
  showPage,
  storedRecents,
  storedSessions,
  trackPageErrors,
} from './support/app'
import { readViewSizes } from './support/pdf'

/** The sample form's stored session (null until one is saved). */
async function sampleSession(page: Page) {
  return (await storedSessions(page)).find((s) => s.fileName === 'sample-form.pdf') ?? null
}

async function textInput(page: Page, field: string) {
  const root = await formField(page, field)
  return root.locator('xpath=self::input | self::textarea | .//input | .//textarea').first()
}

/** What the fields on the pages show, in page order. */
function shownValues(page: Page) {
  return page.locator('[data-page-index] [data-form-field]').evaluateAll((roots) =>
    roots.map((root) => {
      const control = root.matches('input, textarea, select') ? root : root.querySelector('input, textarea, select')
      return [root.getAttribute('data-form-field'), (control as HTMLInputElement | null)?.value ?? null]
    }),
  )
}

/** Drops a PDF on the window (with whatever has focus keeping it); `contents` stands in for the file's. */
async function dropPdf(page: Page, file: string, contents?: Buffer) {
  const data = (contents ?? (await readFile(file))).toString('base64')
  const dataTransfer = await page.evaluateHandle(
    ({ data, name }) => {
      const dt = new DataTransfer()
      dt.items.add(new File([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], name, { type: 'application/pdf' }))
      return dt
    },
    { data, name: basename(file) },
  )
  for (const type of ['dragenter', 'dragover', 'drop']) await page.dispatchEvent('body', type, { dataTransfer })
}

/**
 * Holds the next read of saved work (the load of a document being opened) until `release()`:
 * the open stays in progress, for as long as the test needs, right after reading what is stored.
 */
async function holdNextSessionRead(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { releaseSessionRead?: () => void }
    const get = IDBObjectStore.prototype.get
    IDBObjectStore.prototype.get = function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['get']>) {
      const req = get.apply(this, args)
      if (this.name !== 'sessions' || this.transaction.mode !== 'readonly') return req
      IDBObjectStore.prototype.get = get
      document.documentElement.dataset.sessionRead = ''
      let onsuccess: IDBRequest['onsuccess'] = null
      Object.defineProperty(req, 'onsuccess', { get: () => onsuccess, set: (fn: IDBRequest['onsuccess']) => (onsuccess = fn) })
      let read: Event | null = null
      let released = false
      const deliver = () => read && released && onsuccess?.call(req, read)
      req.addEventListener('success', (e) => {
        read = e
        deliver()
      })
      w.releaseSessionRead = () => {
        released = true
        deliver()
      }
      return req
    }
  })
  return {
    /** Waits until the held read has been made. */
    reached: async () => {
      await expect(page.locator('html[data-session-read]')).toBeAttached()
      await page.evaluate(() => delete document.documentElement.dataset.sessionRead)
    },
    release: () => page.evaluate(() => (window as unknown as { releaseSessionRead?: () => void }).releaseSessionRead?.()),
  }
}

/** The next read of saved work (opening a document) fails. */
function failNextSessionRead(page: Page) {
  return page.evaluate(() => {
    const get = IDBObjectStore.prototype.get
    IDBObjectStore.prototype.get = function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['get']>) {
      if (this.name !== 'sessions' || this.transaction.mode !== 'readonly') return get.apply(this, args)
      IDBObjectStore.prototype.get = get
      throw new DOMException('Data lost due to missing file.', 'NotReadableError')
    }
  })
}

/** Every later write of saved work fails (storage full): leaving the document then asks first. */
function failSessionWrites(page: Page) {
  return page.evaluate(() => {
    const put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'sessions') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
      return put.apply(this, args)
    }
  })
}

/** Toasts on screen, in page order, with whether each is the front one of its stack. */
function shownToasts(page: Page) {
  return page
    .locator('[data-sonner-toast]:not([data-removed="true"])')
    .evaluateAll((els) => els.map((el) => ({ front: el.getAttribute('data-front') === 'true', text: el.textContent ?? '' })))
}

/** Whether nothing covers the middle of `target`: a press there reaches it. */
function uncovered(target: Locator) {
  return target.evaluate((el) => {
    const r = el.getBoundingClientRect()
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
    return hit !== null && el.contains(hit)
  })
}

/** Writes a record straight into one of the app's IndexedDB stores (as another build might). */
function putRecord(page: Page, dbName: string, storeName: string, key: string, value: unknown) {
  return page.evaluate(
    ([dbName, storeName, key, value]) =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open(dbName)
        req.onerror = () => reject(req.error)
        req.onsuccess = () => {
          const tx = req.result.transaction(storeName, 'readwrite')
          tx.objectStore(storeName).put(value, key)
          tx.oncomplete = () => {
            req.result.close()
            resolve()
          }
        }
      }),
    [dbName, storeName, key, value] as const,
  )
}

test('a change made just before a reload is kept', async ({ page }) => {
  await gotoHome(page)
  await openPdf(page, SAMPLE_PDF)
  const input = await textInput(page, 'Full name')
  await input.click()
  await input.pressSequentially('221B Baker Street', { delay: 20 })
  // Well inside the autosave delay: only the write on pagehide can keep it.
  await page.waitForTimeout(100)
  await page.reload()
  await expect.poll(async () => (await sampleSession(page))?.formValues['Full name']).toBe('221B Baker Street')
})

test('a text box left empty is never stored or counted', async ({ page }) => {
  const sizes = await readViewSizes(SAMPLE_PDF)
  await gotoHome(page)
  await openPdf(page, SAMPLE_PDF)
  await showPage(page, 0)
  await selectTool(page, 'Text', 'T')
  await clickPagePoint(page, 1, SAMPLE_SPOTS.emergencyName, sizes[1])
  await expectEditing(page)
  await page.waitForTimeout(1200)
  await page.reload()
  await expect.poll(async () => (await sampleSession(page))?.elements).toEqual([])
  expect((await storedRecents(page)).find((d) => d.name === 'sample-form.pdf')?.filledCount ?? 0).toBe(0)
  await (await recentDocument(page, /sample-form/i)).click()
  await showPage(page, 1)
  await expect(page.locator('[data-element-id]')).toHaveCount(0)
})

test('a tab with an out-of-date copy never overwrites newer work, and offers to reload', async ({ page, context }) => {
  await gotoHome(page)
  await openPdf(page, SAMPLE_PDF)
  await fillFormField(page, 'Full name', 'From tab A')
  await expect.poll(async () => (await sampleSession(page))?.formValues['Full name']).toBe('From tab A')

  // The same document in a second tab: newer work is saved there.
  const other = await context.newPage()
  await gotoHome(other)
  await (await recentDocument(other, /sample-form/i)).click()
  await fillFormField(other, 'Full name', 'From tab B')
  await expect.poll(async () => (await sampleSession(other))?.formValues['Full name']).toBe('From tab B')
  await other.close()

  // Back in the first tab, which still shows the old copy.
  await expect(page.getByText('This document was changed in another tab')).toBeVisible()
  await fillFormField(page, 'Email', 'stale@example.com')
  await expect(page.getByRole('button', { name: /not saved/i })).toBeVisible()
  await page.waitForTimeout(1500)
  expect((await sampleSession(page))?.formValues).toMatchObject({ 'Full name': 'From tab B', Email: '' })

  await page.getByRole('button', { name: 'Reload' }).click()
  await expect(await textInput(page, 'Full name')).toHaveValue('From tab B')
})

for (const [device, viewport] of [
  ['desktop', { width: 1440, height: 900 }],
  ['phone', { width: 390, height: 844 }],
] as const) {
  test(`a message that stays until acted on sits under the top bar, clear of the dock’s popovers (${device})`, async ({ page, context }) => {
    await page.setViewportSize(viewport)
    await gotoHome(page)
    await openPdf(page, SAMPLE_PDF)
    await showPage(page, 0)
    const dock = (label: string) => page.getByRole('button', { name: label, exact: true }).filter({ visible: true }).first()
    // One signature saved, so the Signature button opens the saved list.
    await dock('Signature').click()
    const dialog = page.getByRole('dialog', { name: 'Add your signature' })
    await dialog.getByRole('tab', { name: 'Type' }).click()
    await dialog.getByLabel('Your full name').fill('Ada Lovelace')
    await dialog.getByRole('button', { name: 'Use signature' }).click()
    await expect(dialog).toBeHidden()
    await page.keyboard.press('Escape') // don't place it

    // Newer work is saved in another tab: this copy stops saving, and says so until reloaded.
    await fillFormField(page, 'Full name', 'From tab A')
    await expect.poll(async () => (await sampleSession(page))?.formValues['Full name']).toBe('From tab A')
    const other = await context.newPage()
    await gotoHome(other)
    await (await recentDocument(other, /sample-form/i)).click()
    await fillFormField(other, 'Full name', 'From tab B')
    await expect.poll(async () => (await sampleSession(other))?.formValues['Full name']).toBe('From tab B')
    await other.close()
    const outdated = page.locator('[data-sonner-toast]', { hasText: 'This document was changed in another tab' })
    await expect(outdated).toBeVisible()
    // Just under the top bar: not over its controls, nor down where the dock's popovers open.
    const bar = (await page.locator('header').first().boundingBox())!
    await expect.poll(async () => (await outdated.boundingBox())!.y - (bar.y + bar.height)).toBeGreaterThanOrEqual(0)
    expect((await outdated.boundingBox())!.y - (bar.y + bar.height)).toBeLessThan(40)
    // The only message left (passing ones, such as the hint about the form's fields, go by themselves).
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(1)

    /** Waits for the element's own animations (a popover opening) to finish. */
    const settled = (el: Locator) => el.evaluate((node) => Promise.all(node.getAnimations().map((a) => a.finished)))
    // The dock's popovers open clear of it: a press on any of their items reaches the item.
    await dock('Shapes').click()
    const shapes = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: /^Rectangle/ }) })
    await settled(shapes)
    for (const item of await shapes.getByRole('button').all()) expect(await uncovered(item)).toBe(true)
    await page.keyboard.press('Escape')
    await expect(shapes).toHaveCount(0)
    await dock('Signature').click()
    const saved = page.getByRole('dialog', { name: 'Saved signatures' })
    await settled(saved)
    const tile = saved.getByRole('button', { name: /^Place signature saved/ }).first()
    expect(await uncovered(tile)).toBe(true)
    await tile.click()
    await expect(saved).toBeHidden()
    await expect(page.getByText(/(Click|Tap) to place your signature/)).toBeVisible()
    await page.keyboard.press('Escape') // don't place it

    // Still up, and its Reload works.
    await outdated.getByRole('button', { name: 'Reload' }).click()
    await expect(await textInput(page, 'Full name')).toHaveValue('From tab B')
    await expect(outdated).toHaveCount(0)
  })
}

for (const [device, viewport] of [
  ['phone', { width: 390, height: 844 }],
  ['tablet', { width: 768, height: 1024 }],
] as const) {
  test(`the top bar’s menus open over a message that stays until acted on (${device})`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await gotoHome(page)
    await openPdf(page, SAMPLE_PDF)
    await fillFormField(page, 'Full name', 'Ada Lovelace')
    await expect.poll(async () => (await sampleSession(page))?.formValues['Full name']).toBe('Ada Lovelace')
    // Opened again without its saved work: a warning that stays up, just under the top bar.
    await failNextSessionRead(page)
    await dropPdf(page, SAMPLE_PDF)
    const notLoaded = page.locator('[data-sonner-toast]', { hasText: 'Your saved work on this document didn’t load' })
    await expect(notLoaded).toBeVisible()

    const settled = (el: Locator) => el.evaluate((node) => Promise.all(node.getAnimations().map((a) => a.finished)))
    // The ones that can be pressed (a disabled item lets presses through to the menu by design).
    const menuItems = (menu: Locator) => menu.getByRole('menuitem').or(menu.getByRole('menuitemradio')).and(menu.locator(':not([data-disabled])')).all()
    // Every item of the More menu, and of the zoom menu where the top bar has one, can be pressed.
    await page.getByRole('button', { name: 'More', exact: true }).click()
    let menu = page.getByRole('menu')
    await settled(menu)
    for (const item of await menuItems(menu)) expect(await uncovered(item), (await item.textContent()) ?? '').toBe(true)
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    const zoom = page.getByRole('button', { name: /^Zoom level/ }).filter({ visible: true })
    if (await zoom.count()) {
      await zoom.click()
      menu = page.getByRole('menu')
      await settled(menu)
      for (const item of await menuItems(menu)) expect(await uncovered(item), (await item.textContent()) ?? '').toBe(true)
      await page.keyboard.press('Escape')
      await expect(menu).toHaveCount(0)
    }

    // On a phone the panels open from the More menu: a tap there opens the sheet.
    if (device === 'phone') {
      await page.getByRole('button', { name: 'More', exact: true }).click()
      await page.getByRole('menuitem', { name: 'Form & items' }).click()
    } else {
      await page.getByRole('button', { name: 'Form & items' }).click()
    }
    await expect(page.getByRole('dialog', { name: 'Form and items' })).toBeVisible()
    // The warning is still up, with its way out.
    await expect(notLoaded.getByRole('button', { name: 'Reload' })).toBeVisible()
  })
}

test('typing on while the open file is opened again never reaches the copy it replaces, nor passes for another tab’s work', async ({ page }) => {
  await gotoHome(page)
  await openPdf(page, SAMPLE_PDF)
  const input = await textInput(page, 'Full name')
  await input.click()
  await input.pressSequentially('Ada')
  await expect.poll(async () => (await sampleSession(page))?.formValues['Full name']).toBe('Ada')
  const stored = (await sampleSession(page))?.formValues
  const shown = await shownValues(page)

  // Hold the new copy's load right after it has read the stored work (a slow device).
  const load = await holdNextSessionRead(page)
  await dropPdf(page, SAMPLE_PDF)
  await load.reached()
  // Keys typed meanwhile, Tab included, don't land in the copy on screen, which the new one
  // replaces (it would never show them, and would save over them), nor switch its tool. (Letters
  // only: Space or Enter would press Cancel once it is offered.)
  await page.keyboard.press('Tab')
  await page.keyboard.type('zzz')
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.type('Lovelace')
  expect(await shownValues(page)).toEqual(shown)
  expect(await page.getByRole('dialog', { name: 'Opening…' }).evaluate((card) => card.contains(document.activeElement))).toBe(true)
  await expect(page.getByRole('toolbar', { name: 'Tools' }).getByRole('button', { name: 'Select', exact: true })).toHaveAttribute('aria-pressed', 'true')
  // Past the autosave delay: a key that reached the copy on screen would be stored by now.
  await page.waitForTimeout(1000)
  expect((await sampleSession(page))?.formValues).toEqual(stored)

  await load.release()
  await expect(page.getByText('Opening…')).toHaveCount(0)
  await expect(input).toHaveValue('Ada')
  expect((await sampleSession(page))?.formValues).toEqual(stored)

  // The new copy keeps saving: its own write isn't taken for another tab's work.
  await fillFormField(page, 'Email', 'ada@example.com')
  await expect.poll(async () => (await sampleSession(page))?.formValues).toMatchObject({ 'Full name': 'Ada', Email: 'ada@example.com' })
  await expect(page.getByText('This document was changed in another tab')).toHaveCount(0)
})

test('an open that takes long can be cancelled, leaving the open document as it was', async ({ page }) => {
  await gotoHome(page)
  await openPdf(page, SAMPLE_PDF)
  const input = await textInput(page, 'Full name')
  await input.click()
  await input.pressSequentially('Ada')
  await expect.poll(async () => (await sampleSession(page))?.formValues['Full name']).toBe('Ada')
  await expect(page).toHaveTitle(/^sample-form/)

  const load = await holdNextSessionRead(page)
  await dropPdf(page, fixture('form-basic.pdf'))
  await load.reached()
  await expect(page.getByText('Opening…')).toBeVisible()
  const cancel = page.getByRole('button', { name: 'Cancel' })
  // Offered only once the open has taken a few seconds.
  await expect(cancel).toHaveCount(0)
  await cancel.click()
  await expect(page.getByText('Opening…')).toHaveCount(0)
  // Back where the user was.
  await expect(input).toBeFocused()
  await expect(input).toHaveValue('Ada')

  // The open, finishing late, doesn't replace it.
  await load.release()
  await page.waitForTimeout(1000)
  await expect(page).toHaveTitle(/^sample-form/)
  await fillFormField(page, 'Email', 'ada@example.com')
  await expect.poll(async () => (await sampleSession(page))?.formValues).toMatchObject({ 'Full name': 'Ada', Email: 'ada@example.com' })

  // Tab reaches it, and Escape cancels too, once offered.
  const again = await holdNextSessionRead(page)
  await dropPdf(page, fixture('form-basic.pdf'))
  await again.reached()
  await expect(cancel).toBeVisible()
  await page.keyboard.press('Tab')
  await expect(cancel).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(cancel).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByText('Opening…')).toHaveCount(0)
  await again.release()
  await page.waitForTimeout(1000)
  await expect(page).toHaveTitle(/^sample-form/)
  await expect(page.getByText(/is saved/)).toHaveCount(0)
})

test('cancelling an open whose pdf.js worker never answers ends that worker', async ({ page }) => {
  await gotoHome(page)
  await openPdf(page, SAMPLE_PDF)
  await fillFormField(page, 'Full name', 'Ada')
  await expect(page).toHaveTitle(/^sample-form/)

  // The next document's worker never answers (its request to open the file goes nowhere).
  await page.evaluate(() => {
    const w = window as unknown as { stuckWorker?: Worker; stuckWorkerEnded?: boolean }
    const post = Worker.prototype.postMessage
    Worker.prototype.postMessage = function (this: Worker, ...args: Parameters<Worker['postMessage']>) {
      const message = args[0] as { action?: string } | null
      if (!w.stuckWorker && message?.action === 'GetDocRequest') {
        w.stuckWorker = this
        return
      }
      return post.apply(this, args)
    } as Worker['postMessage']
    const terminate = Worker.prototype.terminate
    Worker.prototype.terminate = function (this: Worker) {
      if (this === w.stuckWorker) w.stuckWorkerEnded = true
      return terminate.call(this)
    }
  })
  await dropPdf(page, fixture('form-basic.pdf'))
  await expect(page.getByText('Opening…')).toBeVisible()
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByText('Opening…')).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => (window as unknown as { stuckWorkerEnded?: boolean }).stuckWorkerEnded ?? false), { timeout: 5000 }).toBe(true)

  // The open document is as it was, and keeps working.
  await expect(page).toHaveTitle(/^sample-form/)
  await expect(await textInput(page, 'Full name')).toHaveValue('Ada')
  await fillFormField(page, 'Email', 'ada@example.com')
  await expect.poll(async () => (await sampleSession(page))?.formValues).toMatchObject({ 'Full name': 'Ada', Email: 'ada@example.com' })
})

test('an open from the home screen that takes long can be cancelled, and tried again', async ({ page }) => {
  await gotoHome(page)
  const sample = page.getByRole('button', { name: /try a sample form/i })
  const load = await holdNextSessionRead(page)
  await sample.click()
  await load.reached()
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByText('Opening…')).toHaveCount(0)
  // Nothing waits on the open any more, even though it hasn't ended.
  await expect(sample).toBeEnabled()
  await load.release()
  await page.waitForTimeout(1000)
  await expect(sample).toBeVisible()

  await sample.click()
  await showPage(page, 0)
})

test('keys pressed while the open file is opened again never delete the box that was being typed in', async ({ page }) => {
  const sizes = await readViewSizes(SAMPLE_PDF)
  await gotoHome(page)
  await openPdf(page, SAMPLE_PDF)
  await showPage(page, 0)
  await selectTool(page, 'Text', 'T')
  await clickPagePoint(page, 1, SAMPLE_SPOTS.emergencyName, sizes[1])
  await expectEditing(page)
  await page.keyboard.type('Hello')
  await expect.poll(async () => (await sampleSession(page))?.elements.map((e) => e.text)).toEqual(['Hello'])

  const load = await holdNextSessionRead(page)
  await dropPdf(page, SAMPLE_PDF)
  await load.reached()
  // Typing ends as the open starts, which leaves the box selected.
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Delete')
  await expect(page.locator('[data-element-id]')).toHaveCount(1)
  // Past the autosave delay: a removal would be stored by now.
  await page.waitForTimeout(1000)
  expect((await sampleSession(page))?.elements).toHaveLength(1)

  await load.release()
  await expect(page.getByText('Opening…')).toHaveCount(0)
  await page.reload()
  await (await recentDocument(page, /sample-form/i)).click()
  await showPage(page, 1)
  await expect(page.locator('[data-element-id]')).toHaveCount(1)
})

test('keys pressed while a password is being tried never change the document it replaces', async ({ page }) => {
  const sizes = await readViewSizes(SAMPLE_PDF)
  await gotoHome(page)
  await openPdf(page, SAMPLE_PDF)
  await showPage(page, 0)
  await selectTool(page, 'Text', 'T')
  await clickPagePoint(page, 1, SAMPLE_SPOTS.emergencyName, sizes[1])
  await expectEditing(page)
  await page.keyboard.type('Hello')
  await page.keyboard.press('Escape') // done typing: the box stays selected
  await expect.poll(async () => (await sampleSession(page))?.elements.map((e) => e.text)).toEqual(['Hello'])
  const stored = (await sampleSession(page))?.elements

  await dropPdf(page, fixture('password.pdf'))
  const prompt = page.getByRole('dialog', { name: /password/i })
  await prompt.getByPlaceholder('Password').fill('fillflow')
  // Hold the unlocked file's load: the prompt stays up, busy, with its field disabled.
  const load = await holdNextSessionRead(page)
  await page.keyboard.press('Enter')
  await load.reached()
  for (const key of ['Control+z', 'Control+d', 'ArrowRight', 'Delete', 'Backspace', 'r']) await page.keyboard.press(key)
  await expect(page.locator('[data-element-id]')).toHaveCount(1)
  // (Hidden from the accessibility tree under the prompt.)
  await expect(page.locator('[role="toolbar"][aria-label="Tools"] button[aria-label="Select"]')).toHaveAttribute('aria-pressed', 'true')
  // Past the autosave delay: a change would be stored by now.
  await page.waitForTimeout(1000)
  expect((await sampleSession(page))?.elements).toEqual(stored)

  await load.release()
  await expect(prompt).toHaveCount(0)
  await showPage(page, 0)
  expect((await sampleSession(page))?.elements).toEqual(stored)
})

test('a file dropped while a sheet, a popover or a menu is open isn’t opened under it', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 800 })
  await gotoHome(page)
  await openPdf(page, SAMPLE_PDF)
  await showPage(page, 0)
  // An open that starts stays in progress (and the "Opening…" card up) until released.
  const load = await holdNextSessionRead(page)
  const opening = page.getByRole('dialog', { name: 'Opening…' })
  /** Drops a PDF that, with something open, isn't opened: focus stays where it is. */
  const dropIgnored = async () => {
    const focused = await page.evaluateHandle(() => document.activeElement)
    await dropPdf(page, fixture('form-basic.pdf'))
    await page.waitForTimeout(300)
    await expect(opening).toHaveCount(0)
    expect(await focused.evaluate((el) => el === document.activeElement)).toBe(true)
  }

  // The Form & items sheet, with one of its fields being typed in: keys typed on still go there.
  await page.getByRole('button', { name: 'Form & items' }).click()
  const sheet = page.getByRole('dialog', { name: 'Form and items' })
  const name = sheet.getByRole('textbox', { name: 'Full name' })
  await name.click()
  await name.pressSequentially('Ada')
  await dropIgnored()
  await page.keyboard.type('XYZ')
  await expect(name).toHaveValue('AdaXYZ')
  await expect.poll(async () => (await sampleSession(page))?.formValues['Full name']).toBe('AdaXYZ')
  await page.keyboard.press('Escape')
  await expect(sheet).toHaveCount(0)

  // A popover, and a menu.
  await page.getByRole('button', { name: 'Shapes', exact: true }).click()
  await expect(page.getByRole('button', { name: /^Rectangle/ })).toBeVisible()
  await dropIgnored()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'More', exact: true }).click()
  await expect(page.getByRole('menu')).toBeVisible()
  await dropIgnored()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)

  // With nothing open, it opens.
  await dropPdf(page, fixture('form-basic.pdf'))
  await load.reached()
  await expect(opening).toBeAttached()
  await load.release()
  await expect(page).toHaveTitle(/form-basic/)
})

test('a PDF pasted on the home screen while a menu or a confirmation is up isn’t opened under it', async ({ page }) => {
  await gotoHome(page)
  await openPdf(page, SAMPLE_PDF)
  await showPage(page, 0)
  await page.getByRole('button', { name: 'Back to home' }).click()
  /** Pastes a PDF file (as copied in the file manager) where focus is. */
  const pastePdf = async () => {
    const data = (await readFile(fixture('form-basic.pdf'))).toString('base64')
    await page.evaluate((data) => {
      const dt = new DataTransfer()
      dt.items.add(new File([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], 'form-basic.pdf', { type: 'application/pdf' }))
      const target = document.activeElement ?? document.body
      target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    }, data)
  }
  const ignored = async () => {
    await pastePdf()
    await page.waitForTimeout(500)
    await expect(page.getByRole('dialog', { name: 'Opening…' })).toHaveCount(0)
    await expect(page.locator('[data-page-index]')).toHaveCount(0)
  }

  await page.getByRole('button', { name: /^more options for sample-form/i }).click()
  await expect(page.getByRole('menu')).toBeVisible()
  await ignored()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Clear all' }).click()
  await expect(page.getByRole('alertdialog')).toBeVisible()
  await ignored()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('alertdialog')).toHaveCount(0)

  // With nothing open, it opens.
  await pastePdf()
  await expect(page).toHaveTitle(/form-basic/)
})

test('focus goes back where it was when a file dropped on the document doesn’t open', async ({ page }) => {
  await gotoHome(page)
  await openPdf(page, SAMPLE_PDF)
  const input = await textInput(page, 'Full name')
  await input.click()
  await input.pressSequentially('Ada')

  // The password prompt, cancelled.
  await dropPdf(page, fixture('password.pdf'))
  const prompt = page.getByRole('dialog', { name: /password/i })
  await prompt.getByRole('button', { name: 'Cancel' }).click()
  await expect(prompt).toHaveCount(0)
  await expect(input).toBeFocused()

  // A file that isn't a PDF after all: its error, closed.
  await dropPdf(page, 'notes.pdf', Buffer.from('Not a PDF'))
  const error = page.getByRole('dialog', { name: /couldn’t open this file/i })
  await expect(error).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(error).toHaveCount(0)
  await expect(input).toBeFocused()
  await expect(input).toHaveValue('Ada')
})

test('focus goes back where it was when the password prompt of a file opened past “Leave anyway” is cancelled', async ({ page }) => {
  await gotoHome(page)
  await openPdf(page, SAMPLE_PDF)
  await showPage(page, 0)
  await failSessionWrites(page)
  const input = await textInput(page, 'Full name')
  await input.click()
  await input.pressSequentially('Ada')
  await expect(page.getByRole('button', { name: /not saved/i })).toBeVisible()

  // The confirmation is gone before the open starts: focus is nowhere until it hands it back.
  await dropPdf(page, fixture('password.pdf'))
  await page.getByRole('button', { name: 'Leave anyway' }).focus()
  await page.keyboard.press('Enter')
  const prompt = page.getByRole('dialog', { name: /password/i })
  await expect(prompt).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(prompt).toHaveCount(0)
  await expect(input).toBeFocused()
  await expect(input).toHaveValue('Ada')
})

test('focus goes back to the menu button when the password prompt of a document opened from its menu is cancelled', async ({ page }) => {
  await gotoHome(page)
  await openPdf(page, fixture('password.pdf'))
  const prompt = page.getByRole('dialog', { name: /password/i })
  await prompt.getByPlaceholder('Password').fill('fillflow')
  await page.keyboard.press('Enter')
  await showPage(page, 0)
  await page.getByRole('button', { name: 'Back to home' }).click()

  // The open starts while focus is in the menu, which hands it back to its button as it closes.
  const more = page.getByRole('button', { name: /^more options for password/i })
  await more.focus()
  await page.keyboard.press('Enter')
  await page.getByRole('menuitem', { name: 'Open' }).focus()
  await page.keyboard.press('Enter')
  await expect(prompt).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(prompt).toHaveCount(0)
  await expect(more).toBeFocused()
})

test('saved work that can’t be read as the document opens is reported at once, and never saved over', async ({ page }) => {
  await gotoHome(page)
  await openPdf(page, SAMPLE_PDF)
  await fillFormField(page, 'Full name', 'Ada Lovelace')
  await expect.poll(async () => (await sampleSession(page))?.formValues['Full name']).toBe('Ada Lovelace')
  const notLoaded = page.getByText('Your saved work on this document didn’t load')

  // Before any work goes in, and with a way to try again.
  await failNextSessionRead(page)
  await dropPdf(page, SAMPLE_PDF)
  await expect(notLoaded).toBeVisible()
  const input = await textInput(page, 'Full name')
  await expect(input).toHaveValue('')
  await page.getByRole('button', { name: 'Reload' }).click()
  await expect(input).toHaveValue('Ada Lovelace')
  await expect(notLoaded).toHaveCount(0)

  // A change made just before the page goes away doesn't replace the work that didn't load.
  await failNextSessionRead(page)
  await dropPdf(page, SAMPLE_PDF)
  await expect(notLoaded).toBeVisible()
  await fillFormField(page, 'Email', 'ada@example.com')
  // Well inside the autosave delay: only the write made on the way out could store it.
  await page.waitForTimeout(100)
  await page.reload()
  expect((await sampleSession(page))?.formValues).toMatchObject({ 'Full name': 'Ada Lovelace', Email: '' })
})

test('on a document’s first open in a page, the warning that its saved work didn’t load isn’t hidden by a hint, which comes once the work loads', async ({ page }) => {
  await gotoHome(page)
  await openPdf(page, SAMPLE_PDF)
  await fillFormField(page, 'Full name', 'Ada Lovelace')
  await expect.poll(async () => (await sampleSession(page))?.formValues['Full name']).toBe('Ada Lovelace')
  await page.reload()
  await failNextSessionRead(page)
  await (await recentDocument(page, /sample-form/i)).click()
  await showPage(page, 0)
  const notLoaded = page.locator('[data-sonner-toast]', { hasText: 'Your saved work on this document didn’t load' })
  await expect(notLoaded).toBeAttached()
  // Past the moment the form's fields are pointed out: no hint inviting the user to type into the blank form.
  await page.waitForTimeout(1000)
  const toasts = await shownToasts(page)
  expect(toasts.filter((t) => /fillable fields/.test(t.text))).toEqual([])
  expect(toasts.find((t) => t.front)?.text).toContain('Your saved work on this document didn’t load')

  // Reloaded (the same file, so the same document), with its work this time: now the fields are pointed out.
  await notLoaded.getByRole('button', { name: 'Reload' }).click()
  await expect(await textInput(page, 'Full name')).toHaveValue('Ada Lovelace')
  await expect(notLoaded).toHaveCount(0)
  await expect(page.locator('[data-sonner-toast]', { hasText: /fillable fields found/ })).toBeVisible()
})

test('a stored file that can’t be read keeps its card and its work', async ({ page }) => {
  await gotoHome(page)
  await openPdf(page, SAMPLE_PDF)
  await fillFormField(page, 'Full name', 'Ada Lovelace')
  await expect.poll(async () => (await sampleSession(page))?.formValues['Full name']).toBe('Ada Lovelace')
  await page.getByRole('button', { name: 'Back to home' }).click()

  await page.evaluate(() => {
    const get = IDBObjectStore.prototype.get
    IDBObjectStore.prototype.get = function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['get']>) {
      if (this.name === 'files') throw new DOMException('Data lost due to missing file.', 'UnknownError')
      return get.apply(this, args)
    }
  })
  await (await recentDocument(page, /sample-form/i)).click()
  await expect(page.getByRole('dialog')).toContainText('Couldn’t open this file')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)

  expect((await sampleSession(page))?.formValues['Full name']).toBe('Ada Lovelace')
  await expect(page.locator('[data-recent-open]')).toHaveCount(1)
})

test('stored data from another build can’t stop the app from working', async ({ page }) => {
  const errors = trackPageErrors(page)
  await gotoHome(page)
  await openPdf(page, SAMPLE_PDF)
  await showPage(page, 0)
  const id = (await storedRecents(page)).find((d) => d.name === 'sample-form.pdf')?.id ?? ''
  expect(id).not.toBe('')
  await page.getByRole('button', { name: 'Back to home' }).click()

  // A recents entry without a name, and a session using a font this build doesn't have.
  await putRecord(page, 'fillflow-recents', 'recents', 'x', { id: 'x', size: 1, pageCount: 1, addedAt: 1, openedAt: 1 })
  const text = { id: 't', kind: 'text', page: 0, x: 100, y: 140, width: 50, height: 14, text: 'Script text', fontId: 'script', bold: false, fontSize: 12, color: '#111827', align: 'left', lineHeight: 1.2, letterSpacing: 0 }
  await putRecord(page, 'fillflow-sessions', 'sessions', id, {
    version: 1,
    docId: id,
    fileName: 'sample-form.pdf',
    elements: [text],
    formValues: { 'Full name': 'Ada' },
    assets: {},
    updatedAt: 5,
  })
  await page.reload()
  await (await recentDocument(page, /sample-form/i)).click()
  await showPage(page, 0)
  await expect(await textInput(page, 'Full name')).toHaveValue('Ada')
  await expect(page.locator('[data-page-index="0"]').getByText('Script text')).toBeVisible()
  expect(errors).toEqual([])
})

test('after a failed save the app never says the work is saved', async ({ page }) => {
  await gotoHome(page)
  await openPdf(page, SAMPLE_PDF)
  await showPage(page, 0)
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'sessions') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
      return put.apply(this, args)
    }
  })
  await fillFormField(page, 'Full name', 'Ada')
  const notSaved = page.getByRole('button', { name: /not saved/i })
  await expect(notSaved).toBeVisible()
  // Another change doesn't hide the failure.
  await fillFormField(page, 'Full name', 'Ada L')
  await page.waitForTimeout(200)
  await expect(notSaved).toBeVisible()

  // Dropping another PDF: the overlay and the outcome tell the truth.
  const data = (await readFile(fixture('form-basic.pdf'))).toString('base64')
  const dataTransfer = await page.evaluateHandle((data) => {
    const dt = new DataTransfer()
    dt.items.add(new File([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], 'form-basic.pdf', { type: 'application/pdf' }))
    return dt
  }, data)
  await page.dispatchEvent('body', 'dragenter', { dataTransfer })
  await page.dispatchEvent('body', 'dragover', { dataTransfer })
  await expect(page.getByText(/couldn’t be saved on this device/)).toBeVisible()
  await page.dispatchEvent('body', 'drop', { dataTransfer })
  await page.getByRole('button', { name: 'Leave anyway' }).click()
  await expect(page).toHaveTitle(/form-basic/)
  await page.waitForTimeout(500)
  await expect(page.getByText(/is saved/)).toHaveCount(0)
})

test('removing recent documents keeps keyboard focus in place', async ({ page }) => {
  await gotoHome(page)
  for (const file of [SAMPLE_PDF, fixture('form-basic.pdf'), fixture('long.pdf')]) {
    await openPdf(page, file)
    await showPage(page, 0)
    await page.getByRole('button', { name: 'Back to home' }).click()
  }
  await expect(page.locator('[data-recent-open]')).toHaveCount(3)
  const focused = () => page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.tagName)

  await page.getByRole('button', { name: /^more options for form-basic/i }).focus()
  await page.keyboard.press('Enter')
  await page.getByRole('menuitem', { name: /remove from this device/i }).focus()
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: 'Remove', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-recent-open]')).toHaveCount(2)
  await expect.poll(focused).toMatch(/^Open sample-form/)

  await page.getByRole('button', { name: 'Clear all' }).focus()
  await page.keyboard.press('Enter')
  await page.getByRole('alertdialog').getByRole('button', { name: 'Clear all' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-recent-open]')).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('aria-describedby'))).toBe('ff-dropzone-hint')
  expect(await readIndexedDb(page, 'fillflow-sessions', 'sessions')).toEqual([])
})

test('work kept for documents that dropped off the list is let go of in time, and can be deleted once the list is empty', async ({ page }) => {
  await gotoHome(page)
  await openPdf(page, SAMPLE_PDF)
  await fillFormField(page, 'Full name', 'Ada')
  await expect.poll(async () => (await sampleSession(page))?.formValues['Full name']).toBe('Ada')
  const sampleId = (await sampleSession(page))?.docId ?? ''
  await page.getByRole('button', { name: 'Back to home' }).click()

  // Work on two documents that are no longer listed: one saved lately, one long ago.
  const day = 24 * 60 * 60 * 1000
  const work = (docId: string, updatedAt: number) => ({ version: 1, docId, fileName: `${docId}.pdf`, elements: [], formValues: { Name: 'Ada' }, assets: {}, updatedAt })
  await putRecord(page, 'fillflow-sessions', 'sessions', 'lately', work('lately', Date.now() - day))
  await putRecord(page, 'fillflow-sessions', 'sessions', 'long-ago', work('long-ago', Date.now() - 100 * day))
  await page.reload()
  // The home screen lets go of the old one; the other stays (the same file opened again brings it back).
  await expect.poll(async () => (await storedSessions(page)).map((s) => s.docId).sort()).toEqual(['lately', sampleId].sort())
  const notice = page.getByText('Work from older documents is still saved on this device.')
  await expect(page.locator('[data-recent-open]')).toHaveCount(1)
  await expect(notice).toHaveCount(0)

  // Removing the last listed document still leaves a way to delete the rest.
  await page.getByRole('button', { name: /^more options for sample-form/i }).click()
  await page.getByRole('menuitem', { name: /remove from this device/i }).click()
  await page.getByRole('button', { name: 'Remove', exact: true }).click()
  await expect(page.locator('[data-recent-open]')).toHaveCount(0)
  await expect(notice).toBeVisible()
  await page.getByRole('button', { name: 'Delete it' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(notice).toHaveCount(0)
  await expect.poll(() => storedSessions(page)).toEqual([])
})

test('a slow sample download never replaces a document opened meanwhile', async ({ page }) => {
  await page.route('**/samples/sample-form.pdf', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2500))
    await route.continue()
  })
  await gotoHome(page)
  await page.getByRole('button', { name: /try a sample form/i }).click()
  await openPdf(page, fixture('form-basic.pdf'))
  await expect(page).toHaveTitle(/form-basic/)
  await page.waitForTimeout(3500)
  await expect(page).toHaveTitle(/form-basic/)
})

test('documents open on a plain-http host (no Web Crypto)', async ({ page, baseURL }) => {
  const origin = new URL(baseURL ?? 'http://localhost:5299/FillFlow/').origin
  await page.route('http://fillflow.test/**', async (route) => {
    const response = await route.fetch({ url: route.request().url().replace('http://fillflow.test', origin) })
    await route.fulfill({ response })
  })
  await page.goto('http://fillflow.test/FillFlow/')
  expect(await page.evaluate(() => isSecureContext)).toBe(false)
  await page.getByRole('button', { name: /try a sample form/i }).click()
  await showPage(page, 0)
  // Same id as Web Crypto gives the sample on a secure origin.
  await expect
    .poll(async () => (await storedRecents(page)).map((d) => d.id))
    .toEqual(['e4597c37cb83b73944bb89b07ae3e708f3cee7412872593353771eb2fed6d0cc'])
})
