import { getTabData, addToHibernatedList, updateAnalyticsOnSuspend, getSettings, removeFromHibernatedList, getHibernatedList, updateBadge } from './storage.js';
import { isTabPaused } from './pause.js';

export const pendingScrollRestores = {};

/**
 * Resolve the effective inactivity timeout (in minutes) for a given tab URL.
 * Per-domain overrides win over the global inactivityMinutes. A value of 0
 * means "never hibernate" and signals to canSuspendTab() to skip the tab.
 *
 * @param {string} url
 * @param {object} settings
 * @returns {number} timeout in minutes (0 = never)
 */
export function getEffectiveTimeout(url, settings) {
  if (!url) return settings.inactivityMinutes || 30;
  try {
    const domain = new URL(url).hostname.replace(/^www\./, '');
    const overrides = settings.domainTimeouts || {};
    for (const [entry, mins] of Object.entries(overrides)) {
      const norm = (entry || '').trim().toLowerCase().replace(/^www\./, '');
      if (!norm) continue;
      if (domain === norm || domain.endsWith('.' + norm)) {
        return Number(mins) || 0;
      }
    }
  } catch (_) { /* invalid URL */ }
  return settings.inactivityMinutes || 30;
}

export async function checkAndHibernateTabs(settings) {
  const tabs = await chrome.tabs.query({});
  const nowMs = Date.now();
  // Read the smartMemoryEnabled value as a tier; back-compat with the legacy
  // boolean form (true -> 'balanced', false -> 'off').
  const memoryTier = (() => {
    const v = settings.smartMemoryEnabled;
    if (v === 'conservative' || v === 'balanced' || v === 'aggressive') return v;
    if (v === false) return 'off';
    return 'balanced';
  })();

  // Filter eligible tabs first to short-circuit system calls if session is quiet
  const eligibleTabs = [];
  for (const tab of tabs) {
    if (await canSuspendTab(tab, settings)) {
      eligibleTabs.push(tab);
    }
  }

  if (eligibleTabs.length === 0) return;

  // ── Memory pressure adjustment (tier-based) ─────────────────────────────────
  // 'aggressive'   → also activates on heavy tab counts even with free RAM.
  // 'balanced'     → activates on actual system memory pressure only.
  // 'conservative' → activates only in critical pressure (low ratio or low absolute free).
  // 'off'          → never adjusts thresholds.
  const tabCount = tabs.length;
  let pressureMultiplier = 1.0;  // 1.0 = no change; <1 = hibernate sooner.
  if (memoryTier !== 'off' && chrome.system && chrome.system.memory) {
    try {
      const memInfo = await chrome.system.memory.getInfo();
      if (memInfo && memInfo.capacity > 0) {
        const ratio = memInfo.availableCapacity / memInfo.capacity;
        const availableGB = memInfo.availableCapacity / (1024 * 1024 * 1024);

        if (ratio < 0.15 || availableGB < 1.0) {
          pressureMultiplier = 0.2;   // critical: 5x faster
        } else if (ratio < 0.25 || availableGB < 2.0) {
          pressureMultiplier = (memoryTier === 'conservative') ? 0.7 : 0.5;
        } else if (memoryTier === 'aggressive' && tabCount >= 20) {
          // 'aggressive' trims thresholds when the user has a lot of tabs even with free RAM
          pressureMultiplier = 0.6;
        }
      }
    } catch (e) { /* fallback to strict time if API fails */ }
  }

  for (const tab of eligibleTabs) {
    const tabData = await getTabData(tab.id);
    const lastActivity = tabData?.lastActivity || tabData?.createdAt || nowMs;
    const idleMs = nowMs - lastActivity;

    // Per-domain override (0 = never hibernate). Falls back to global default.
    const baseMinutes = getEffectiveTimeout(tab.url, settings);
    if (baseMinutes === 0) continue;
    const thresholdMs = baseMinutes * 60 * 1000 * pressureMultiplier;

    if (idleMs >= thresholdMs) {
      await suspendTab(tab);
    }
  }
}

export async function canSuspendTab(tab, settings, isManual = false) {
  if (!settings.enabled && !isManual) return false;

  // Per-tab pause (right-click "Pause hibernation" override).
  if (!isManual && await isTabPaused(tab.id)) return false;

  if (!isManual && settings.batterySaverOnly) {
    const batData = await chrome.storage.local.get('deviceCharging');
    if (batData.deviceCharging === true) return false;
  }

  if (tab.pinned) return false;
  if (tab.active) return false;
  if (tab.audible) return false;
  if (tab.status === 'loading') return false;

  if (!tab.url) return false;
  const url = tab.url;

  if (url.startsWith('chrome://') || url.startsWith('edge://') ||
      url.startsWith('chrome-extension://') || url.startsWith('about:') ||
      url.startsWith('devtools://') || url.startsWith('data:')) {
    return false;
  }

  if (url.startsWith(chrome.runtime.getURL('suspended.html'))) return false;

  try {
    const parsed = new URL(url);
    const domain = parsed.hostname.replace(/^www\./, '');
    const wl = settings.whitelist || [];
    // Match on exact host or proper sub-domain suffix only. Substring matching
    // (the previous behaviour) was both over-broad (e.g. "co" matched almost
    // everything) and unsafe (e.g. "github.com" matched "notgithub.com.evil").
    const isWhitelisted = wl.some(w => {
      const entry = (w || '').trim().toLowerCase().replace(/^www\./, '');
      if (!entry) return false;
      return domain === entry || domain.endsWith('.' + entry);
    });
    if (isWhitelisted) return false;

    // Per-domain "never hibernate" override (timeout = 0). Distinct from the
    // whitelist so users can configure: whitelist = never hibernate OR
    // override timeout, but not both for the same domain.
    const overrides = settings.domainTimeouts || {};
    for (const [entry, mins] of Object.entries(overrides)) {
      const norm = (entry || '').trim().toLowerCase().replace(/^www\./, '');
      if (!norm) continue;
      if (domain === norm || domain.endsWith('.' + norm)) {
        if (Number(mins) === 0) return false;
        break;
      }
    }
  } catch (e) {
    return false;
  }

  const tabData = await getTabData(tab.id);

  if (!isManual && tabData?.createdAt) {
    const ageMs = Date.now() - tabData.createdAt;
    if (ageMs < 5 * 60 * 1000) return false;
  }

  if (tabData?.hasFormInput) return false;

  return true;
}

export async function suspendTab(tab) {
  const tabData = await getTabData(tab.id);
  const scrollY = tabData?.scrollY || 0;
  const favicon = tab.favIconUrl || '';

  const suspendedInfo = {
    url: tab.url,
    title: tab.title || 'Untitled',
    favicon: favicon,
    scrollY: scrollY,
    suspendedAt: Date.now(),
    tabId: tab.id
  };

  await chrome.storage.local.set({ ['suspended-' + tab.id]: suspendedInfo });
  await addToHibernatedList(tab.id);
  await updateAnalyticsOnSuspend(tab.url);

  const params = new URLSearchParams({
    tabId: tab.id.toString(),
    title: suspendedInfo.title,
    url: suspendedInfo.url,
    favicon: suspendedInfo.favicon,
    suspendedAt: suspendedInfo.suspendedAt.toString()
  });

  const suspendedUrl = chrome.runtime.getURL('suspended.html') + '?' + params.toString();
  await chrome.tabs.update(tab.id, { url: suspendedUrl });

  updateBadge();
}

export async function wakeTab(storedTabId, targetTabId = null, fallback = null) {
  const actualTargetId = targetTabId || storedTabId;
  const key = 'suspended-' + storedTabId;
  const data = await chrome.storage.local.get(key);
  let info = data[key];

  // Fallback: after a browser restart, tab ids change and id-keyed storage
  // may have been garbage-collected. The caller can supply the original url
  // (read from the suspended page's URL params) so the wake still works.
  if (!info?.url && fallback?.url) {
    info = { url: fallback.url, scrollY: fallback.scrollY || 0 };
  }

  if (!info?.url) return;

  await chrome.tabs.update(actualTargetId, { url: info.url });

  await chrome.storage.local.remove([key, 'tabdata-' + storedTabId, 'snapshot-' + storedTabId]);
  await removeFromHibernatedList(storedTabId);

  if (info.scrollY > 0) {
    pendingScrollRestores[actualTargetId] = info.scrollY;
  }

  await chrome.storage.local.set({
    ['tabdata-' + actualTargetId]: {
      createdAt: Date.now(),
      lastActivity: Date.now(),
      scrollY: 0,
      hasFormInput: false
    }
  });

  updateBadge();
}

export async function hibernateAllTabs() {
  const settings = await getSettings();
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (await canSuspendTab(tab, settings, true)) {
      await suspendTab(tab);
    }
  }
}

export async function wakeAllTabs() {
  const ids = await getHibernatedList();
  for (const tabId of ids) {
    try {
      await wakeTab(tabId);
    } catch (e) {
      await chrome.storage.local.remove(['suspended-' + tabId, 'snapshot-' + tabId]);
      await removeFromHibernatedList(tabId);
    }
  }
  updateBadge();
}
