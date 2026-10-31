import { afterEach, describe, expect, it, vi } from 'vitest'
import { prefersReducedMotion, scrollBehavior } from './motion'

function mockReducedMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: reduce && query === '(prefers-reduced-motion: reduce)', media: query }))
}

describe('motion preferences', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('scrolls smoothly unless the user asked for less motion', () => {
    mockReducedMotion(false)
    expect(prefersReducedMotion()).toBe(false)
    expect(scrollBehavior()).toBe('smooth')
    mockReducedMotion(true)
    expect(prefersReducedMotion()).toBe(true)
    expect(scrollBehavior()).toBe('auto')
  })

  it('treats a missing matchMedia as no preference', () => {
    vi.stubGlobal('matchMedia', undefined)
    expect(prefersReducedMotion()).toBe(false)
    expect(scrollBehavior()).toBe('smooth')
  })
})
