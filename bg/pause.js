/**
 * pause.js — Per-tab hibernation pause controls.
 *
 * Stores a per-tab override in chrome.storage.local under 'tabOverrides'.
 * Shape: { [tabId]: { mode: 'pause' | 'never', until?: number } }
 *   - 'pause' + until = milliseconds epoch when the pause expires.
 *   - 'pause' + until = Infinity = pause until tab is closed.
 *   - 'never' = pause permanently for this tab (until manually resumed).
 *
 * @since 2.0.2
 */

const KEY = 'tabOverrides';

export async function getTabOverrides() {
  const data = await chrome.storage.local.get(KEY);
  return data[KEY] || {};
}

export async function getTabOverride(tabId) {
  const all = await getTabOverrides();
  return all[tabId] || null;
}

export async function setTabOverride(tabId, override) {
  const all = await getTabOverrides();
  if (override === null) {
    delete all[tabId];
  } else {
    all[tabId] = override;
  }
  await chrome.storage.local.set({ [KEY]: all });
}

export async function clearTabOverride(tabId) {
  await setTabOverride(tabId, null);
}

/**
 * Returns true if the tab currently has a pause that should be respected
 * (mode='never' or 'pause' with future 'until'). Expired pauses are
 * auto-cleared as a side effect.
 */
export async function isTabPaused(tabId) {
  const o = await getTabOverride(tabId);
  if (!o) return false;
  if (o.mode === 'never') return true;
  if (o.mode === 'pause') {
    if (o.until === Infinity) return true;
    if (typeof o.until === 'number' && o.until > Date.now()) return true;
    // Expired — clean it up.
    await clearTabOverride(tabId);
    return false;
  }
  return false;
}
