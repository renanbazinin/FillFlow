/**
 * Node test environment for code that measures text: a fake 2D canvas whose glyphs are all
 * half an em wide (50px at the 100px measuring size). Import before anything that measures.
 */
const fakeContext = {
  font: '',
  fontKerning: 'auto',
  measureText: (text: string) => ({ width: [...text].length * 50 }),
}

const g = globalThis as unknown as { document?: unknown }
if (typeof g.document === 'undefined') {
  g.document = {
    createElement: () => ({ getContext: () => fakeContext }),
  }
}

/** Width in points of `text` at `fontSize` with the fake measurer (no letter spacing). */
export function fakeWidth(text: string, fontSize: number): number {
  return [...text].length * fontSize * 0.5
}
