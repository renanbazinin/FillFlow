import { patchRecentDocument, type RecentDocument } from './db'

/** How long a patch waits for its recents entry: a first open writes it concurrently. */
export const RECENT_PATCH_ATTEMPTS = 10
export const RECENT_PATCH_RETRY_MS = 300

const pending = new Map<string, Partial<RecentDocument>>()
const draining = new Map<string, Promise<void>>()

/**
 * Merges `patch` into a document's recents entry as soon as the entry exists. Patches for the
 * same document coalesce (newer values win) and are written one at a time, so a slow first
 * write can never overwrite a newer progress count. Gives up quietly when the entry never
 * shows up (e.g. the file could not be stored). Resolves when this document's queue is empty.
 */
export function patchRecentSoon(id: string, patch: Partial<RecentDocument>): Promise<void> {
  pending.set(id, { ...pending.get(id), ...patch })
  let run = draining.get(id)
  if (!run) {
    run = drain(id)
    draining.set(id, run)
  }
  return run
}

async function drain(id: string): Promise<void> {
  let failures = 0
  try {
    while (pending.has(id) && failures < RECENT_PATCH_ATTEMPTS) {
      const patch = pending.get(id) ?? {}
      pending.delete(id)
      const written = await patchRecentDocument(id, patch).catch((err: unknown) => {
        console.warn('[storage] could not update a recent document', err)
        return false
      })
      if (written) {
        failures = 0
        continue
      }
      // Put it back under anything newer, then give the entry a moment to appear.
      pending.set(id, { ...patch, ...pending.get(id) })
      if (++failures < RECENT_PATCH_ATTEMPTS) await new Promise((r) => setTimeout(r, RECENT_PATCH_RETRY_MS))
    }
  } finally {
    // Cleared synchronously with the last step, so a new patch always starts a new run.
    pending.delete(id)
    draining.delete(id)
  }
}
