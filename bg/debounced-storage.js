/**
 * debounced-storage.js — Batches rapid chrome.storage.local writes into a
 * single flush to reduce I/O churn from high-frequency events (tab activity,
 * scroll, form checks). Critical writes (settings, whitelist) still bypass
 * the debouncer via the writeNow() escape hatch.
 *
 * @since 2.0.2
 */

const DEBOUNCE_MS = 150;

const pending = new Map();   // key -> value
let flushTimer = null;
let writeInProgress = null;

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(flush, DEBOUNCE_MS);
}

async function flush() {
  flushTimer = null;
  if (pending.size === 0) return;

  // Snapshot the current pending state, then clear. New writes that arrive
  // during the flush itself are queued for the next round.
  const batch = {};
  for (const [k, v] of pending) batch[k] = v;
  pending.clear();

  // If a write is in-flight, wait for it before issuing ours. This prevents
  // the chrome.storage.local.set call from throwing on concurrent use.
  if (writeInProgress) {
    try { await writeInProgress; } catch (_) { /* ignore */ }
  }

  writeInProgress = chrome.storage.local.set(batch)
    .catch((e) => {
      // Re-queue on failure (e.g. transient quota error) so the data isn't lost.
      for (const [k, v] of Object.entries(batch)) pending.set(k, v);
      scheduleFlush();
    })
    .finally(() => { writeInProgress = null; });
}

/**
 * Queue a key/value to be written. Multiple writes to the same key within
 * the debounce window are coalesced (last-write-wins).
 */
export function debouncedSet(key, value) {
  pending.set(key, value);
  scheduleFlush();
}

/**
 * Queue multiple keys atomically. Convenience wrapper.
 */
export function debouncedSetMany(obj) {
  for (const [k, v] of Object.entries(obj)) pending.set(k, v);
  scheduleFlush();
}

/**
 * Force a flush right now. Useful before read-after-write patterns or at
 * service-worker shutdown.
 */
export async function flushNow() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  await flush();
}
