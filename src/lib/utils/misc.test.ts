import { afterEach, describe, expect, it, vi } from 'vitest'
import { bidiIsolate, sha256, sha256Hex } from './misc'

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
const utf8 = (s: string) => new TextEncoder().encode(s)

/** Deterministic pseudo-random bytes. */
function noise(length: number, seed = 1): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(length)
  let x = seed
  for (let i = 0; i < length; i++) {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0
    out[i] = x >>> 24
  }
  return out
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('sha256', () => {
  it('matches the FIPS 180-4 test vectors', () => {
    expect(hex(sha256(new Uint8Array()))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(hex(sha256(utf8('abc')))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(hex(sha256(utf8('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')))).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    )
  })

  it('gives the same digest as Web Crypto at every padding boundary', async () => {
    for (const length of [1, 55, 56, 57, 63, 64, 65, 119, 120, 128, 1000, 100_003]) {
      const bytes = noise(length, length)
      const expected = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
      expect(hex(sha256(bytes)), `${length} bytes`).toBe(hex(expected))
    }
  })

  it('hashes only the bytes of a view, not its whole buffer', () => {
    const big = noise(300)
    const view = big.subarray(17, 17 + 130)
    expect(hex(sha256(view))).toBe(hex(sha256(view.slice())))
  })
})

describe('sha256Hex', () => {
  it('falls back to the plain-JS digest where Web Crypto is missing (plain-http pages)', async () => {
    const bytes = noise(5000)
    const withSubtle = await sha256Hex(bytes)
    vi.stubGlobal('crypto', {})
    expect(await sha256Hex(bytes)).toBe(withSubtle)
    vi.stubGlobal('crypto', undefined)
    expect(await sha256Hex(bytes)).toBe(withSubtle)
  })
})

describe('bidiIsolate', () => {
  it('wraps text in first-strong isolate marks', () => {
    expect(bidiIsolate('2024 טופס')).toBe('⁨2024 טופס⁩')
  })
})
