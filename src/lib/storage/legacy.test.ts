import { afterEach, describe, expect, it, vi } from 'vitest'
import { LEGACY_IMPORTED_FLAG, LEGACY_SIGNATURE_KEY, importLegacySignature, inkBounds, padBox } from './legacy'

/** RGBA pixels of a w×h image with opaque pixels at the given points. */
function image(w: number, h: number, ink: [number, number][], alpha = 255) {
  const data = new Uint8ClampedArray(w * h * 4)
  for (const [x, y] of ink) data[(y * w + x) * 4 + 3] = alpha
  return data
}

describe('inkBounds', () => {
  it('finds the box around the ink', () => {
    expect(inkBounds(image(10, 8, [[2, 3], [7, 5], [4, 1]]), 10, 8)).toEqual({ x: 2, y: 1, width: 6, height: 5 })
  })

  it('is null for a blank or nearly transparent image', () => {
    expect(inkBounds(image(4, 4, []), 4, 4)).toBeNull()
    expect(inkBounds(image(4, 4, [[1, 1]], 5), 4, 4)).toBeNull()
  })

  it('handles a single pixel in a corner', () => {
    expect(inkBounds(image(5, 5, [[4, 4]]), 5, 5)).toEqual({ x: 4, y: 4, width: 1, height: 1 })
  })
})

describe('padBox', () => {
  it('grows the box and clamps it to the image', () => {
    expect(padBox({ x: 2, y: 3, width: 4, height: 2 }, 6, 10, 8)).toEqual({ x: 0, y: 0, width: 10, height: 8 })
    expect(padBox({ x: 20, y: 20, width: 10, height: 10 }, 5, 100, 100)).toEqual({ x: 15, y: 15, width: 20, height: 20 })
  })
})

describe('importLegacySignature', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function stubBrowser(items: Record<string, string>) {
    const store = new Map(Object.entries(items))
    vi.stubGlobal('document', {})
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    })
    return store
  }

  it('does nothing outside the browser', async () => {
    const save = vi.fn()
    expect(await importLegacySignature(save)).toBe(false)
    expect(save).not.toHaveBeenCalled()
  })

  it('runs once: skipped when already imported', async () => {
    stubBrowser({ [LEGACY_IMPORTED_FLAG]: '1', [LEGACY_SIGNATURE_KEY]: 'data:image/png;base64,AAAA' })
    const save = vi.fn()
    expect(await importLegacySignature(save)).toBe(false)
    expect(save).not.toHaveBeenCalled()
  })

  it('marks itself done when there is nothing (usable) to import', async () => {
    const store = stubBrowser({ [LEGACY_SIGNATURE_KEY]: 'not an image' })
    const save = vi.fn()
    expect(await importLegacySignature(save)).toBe(false)
    expect(store.get(LEGACY_IMPORTED_FLAG)).toBe('1')
    expect(save).not.toHaveBeenCalled()
  })

  it('skips an image that cannot be decoded, for good', async () => {
    const store = stubBrowser({ [LEGACY_SIGNATURE_KEY]: 'data:image/png;base64,broken' })
    vi.stubGlobal(
      'Image',
      class {
        src = ''
        decode() {
          return Promise.reject(new Error('EncodingError'))
        }
      },
    )
    const save = vi.fn()
    expect(await importLegacySignature(save)).toBe(false)
    expect(store.get(LEGACY_IMPORTED_FLAG)).toBe('1')
    expect(save).not.toHaveBeenCalled()
  })
})
