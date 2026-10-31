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
