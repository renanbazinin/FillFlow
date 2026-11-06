/**
 * Writes test artifacts (PDF/PNG) to `$EXPORT_DEBUG_DIR` when that variable is set, so a
 * human can open them. No-op otherwise.
 */
export async function debugWrite(name: string, bytes: Uint8Array): Promise<void> {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
  const dir = env?.EXPORT_DEBUG_DIR
  if (!dir) return
  const fs = await import(/* @vite-ignore */ `node:${'fs'}`)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(`${dir}/${name}`, bytes)
}
