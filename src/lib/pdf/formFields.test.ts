import { afterEach, expect, it, vi } from 'vitest'

const tooltips = vi.hoisted(() => ({ loads: 0 }))
vi.mock('./forms/tooltips', () => {
  tooltips.loads++
  return { readFieldTooltips: async () => new Map<string, string>() }
})

afterEach(() => {
  vi.unstubAllGlobals()
})

it('loads what reads the labels of fields once the page has settled, and only while online', async () => {
  const idle: (() => void)[] = []
  let online = false
  const win = new EventTarget()
  vi.stubGlobal('window', win)
  vi.stubGlobal('navigator', {
    get onLine() {
      return online
    },
  })
  vi.stubGlobal('requestIdleCallback', (cb: () => void) => void idle.push(cb))
  await import('./formFields')
  expect(idle).toHaveLength(1)
  // Offline as the page settles: not then (some browsers never fetch a module again once it failed)…
  idle[0]()
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(tooltips.loads).toBe(0)
  // …but once the connection is back.
  online = true
  win.dispatchEvent(new Event('online'))
  await vi.waitFor(() => expect(tooltips.loads).toBe(1))
})
