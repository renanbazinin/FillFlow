import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Just enough of the browser for decode.ts: <img> (reporting the natural size each test file
 * declares), createImageBitmap (which, like Chrome's, can't decode SVG) and canvases that record
 * what was drawn into them.
 */
const natural = new Map<Blob, [number, number]>()
const urls = new Map<string, Blob>()

vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
  const url = `blob:test/${urls.size}`
  urls.set(url, blob as Blob)
  return url
})
vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

class FakeImage {
  src = ''
  decoding = ''
  naturalWidth = 0
  naturalHeight = 0
  async decode() {
    ;[this.naturalWidth, this.naturalHeight] = natural.get(urls.get(this.src)!)!
  }
}
vi.stubGlobal('Image', FakeImage)

const createImageBitmap = vi.fn(async (blob: Blob) => {
  if (blob.type === 'image/svg+xml') throw new DOMException('The source image could not be decoded.', 'InvalidStateError')
  const [width, height] = natural.get(blob)!
  return { width, height, close() {} }
})
vi.stubGlobal('createImageBitmap', createImageBitmap)

interface FakeCanvas {
  width: number
  height: number
  drawn?: { source: unknown; width: number; height: number }
}
vi.stubGlobal('document', {
  // Where the interface language is set (<html lang dir>), by a module on the way.
  documentElement: {},
  createElement: () => {
    const canvas: FakeCanvas = { width: 0, height: 0 }
    const ctx = {
      drawImage: (source: unknown, _x: number, _y: number, width: number, height: number) => (canvas.drawn = { source, width, height }),
    }
    return Object.assign(canvas, { getContext: () => ctx })
  },
})

const { imageFileToCanvas, svgViewBox } = await import('./decode')

const SVG = 'image/svg+xml'

function file(type: string, size: [number, number], body = ''): Blob {
  const blob = new Blob([body], { type })
  natural.set(blob, size)
  return blob
}

async function decodeTo(blob: Blob, maxSide: number) {
  const canvas = (await imageFileToCanvas(blob, maxSide)) as unknown as FakeCanvas
  return { size: [canvas.width, canvas.height], drawn: canvas.drawn }
}

beforeEach(() => {
  createImageBitmap.mockClear()
})

describe('imageFileToCanvas', () => {
  it('redraws an SVG with its long side at the limit, however small its nominal size', async () => {
    const out = await decodeTo(file(SVG, [24, 24]), 2000)
    expect(out.size).toEqual([2000, 2000])
    // Drawn from the vector image itself, not from a bitmap frozen at 24 × 24.
    expect(out.drawn).toEqual({ source: expect.any(FakeImage), width: 2000, height: 2000 })
    expect(createImageBitmap).not.toHaveBeenCalled()
  })

  it('keeps the shape of an SVG, and shrinks huge ones', async () => {
    expect((await decodeTo(file(SVG, [160, 48]), 2400)).size).toEqual([2400, 720])
    expect((await decodeTo(file(SVG, [8000, 2000]), 2000)).size).toEqual([2000, 500])
  })

  it('takes the shape of an SVG without an intrinsic size from its viewBox', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 100"><rect width="400" height="100"/></svg>'
    expect((await decodeTo(file(SVG, [0, 0], svg), 2000)).size).toEqual([2000, 500])
    // No viewBox either: a square, as before.
    expect((await decodeTo(file(SVG, [0, 0], '<svg xmlns="http://www.w3.org/2000/svg"/>'), 2000)).size).toEqual([2000, 2000])
  })

  it('never upscales photos', async () => {
    expect((await decodeTo(file('image/png', [24, 24]), 2000)).size).toEqual([24, 24])
    expect((await decodeTo(file('image/jpeg', [4000, 3000]), 2000)).size).toEqual([2000, 1500])
    expect(createImageBitmap).toHaveBeenCalledTimes(2)
  })
})

describe('svgViewBox', () => {
  it('reads the size of the root viewBox', () => {
    expect(svgViewBox('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 100"/>')).toEqual({ width: 400, height: 100 })
    expect(svgViewBox("<?xml version='1.0'?>\n<svg\n  version='1.1'\n  viewBox='-10,-5, 32.5,8'>")).toEqual({ width: 32.5, height: 8 })
  })

  it('returns null without a usable viewBox', () => {
    expect(svgViewBox('<svg width="24" height="24"></svg>')).toBeNull()
    expect(svgViewBox('<svg viewBox="0 0 0 10"/>')).toBeNull()
    expect(svgViewBox('<svg viewBox="0 0 -4 10"/>')).toBeNull()
    expect(svgViewBox('<svg viewBox="none"/>')).toBeNull()
    expect(svgViewBox('not an svg')).toBeNull()
  })
})
