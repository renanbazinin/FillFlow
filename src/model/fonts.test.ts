import { afterEach, describe, expect, it, vi } from 'vitest'
import { FONTS, cssFontFamily, fontDef, fontFileUrl, isFontLoaded, loadFont } from './fonts'
import type { FontId } from './types'

/** A font id written by some other build (a rollback, a stale tab). */
const unknown = 'script' as FontId

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('unknown font ids', () => {
  it('fall back to the default font instead of throwing', () => {
    expect(fontDef(unknown)).toBe(FONTS.sans)
    expect(fontDef('serif')).toBe(FONTS.serif)
    expect(cssFontFamily(unknown)).toBe(cssFontFamily('sans'))
    expect(fontFileUrl(unknown, true)).toBe(fontFileUrl('sans', true))
    expect(fontFileUrl(unknown, false)).toBe(fontFileUrl('sans', false))
  })

  it('load the default face (once) rather than aborting an open', async () => {
    const faces: { family: string; weight?: string }[] = []
    vi.stubGlobal(
      'FontFace',
      class {
        constructor(family: string, _src: string, desc: { weight?: string }) {
          faces.push({ family, weight: desc.weight })
        }
        load() {
          return Promise.resolve(this)
        }
      },
    )
    vi.stubGlobal('document', { fonts: { add: () => {}, check: () => true } })
    await expect(loadFont(unknown, true)).resolves.toBeUndefined()
    await loadFont('sans', true)
    expect(faces).toEqual([{ family: FONTS.sans.cssFamily, weight: '700' }])
    expect(isFontLoaded(unknown, true)).toBe(true)
  })
})

describe('the face that typed text and form fields start in', () => {
  it('is loaded once the page has settled, and only while online', async () => {
    const idle: (() => void)[] = []
    const faces: { family: string; weight?: string }[] = []
    let online = false
    const win = new EventTarget()
    vi.stubGlobal('window', win)
    vi.stubGlobal('navigator', {
      get onLine() {
        return online
      },
    })
    vi.stubGlobal('requestIdleCallback', (cb: () => void) => void idle.push(cb))
    vi.stubGlobal(
      'FontFace',
      class {
        constructor(family: string, _src: string, desc: { weight?: string }) {
          faces.push({ family, weight: desc.weight })
        }
        load() {
          return Promise.resolve(this)
        }
      },
    )
    // documentElement: the interface language (src/i18n, which names the fonts) sets <html lang dir>.
    vi.stubGlobal('document', { fonts: { add: () => {} }, documentElement: {} })
    vi.resetModules()
    await import('./fonts')
    expect(idle).toHaveLength(1)
    // Offline as the page settles: not then (a face that fails to load isn't tried again)…
    idle[0]()
    expect(faces).toEqual([])
    // …but once the connection is back.
    online = true
    win.dispatchEvent(new Event('online'))
    expect(faces).toEqual([{ family: FONTS.sans.cssFamily, weight: '400' }])
  })
})
