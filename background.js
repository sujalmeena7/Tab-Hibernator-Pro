/**
 * background.js — Tab Hibernator Pro Service Worker
 *
 * Architecture (v2 — fixed):
 *  - ONE persistent repeating alarm: 'hibernation-check' fires every minute.
 *  - Per-tab last-activity timestamps stored in chrome.storage.local.
 *  - On each tick, every tab's idle time is compared against the timeout.
 *  - The alarm is re-created in both onInstalled and onStartup so it survives
 *    service worker restarts (the main MV3 gotcha from v1).
 */

// ─── Constants ───────────────────────────────────────────────────────────────────

const CHECK_ALARM = 'hibernation-check';   // Single global repeating alarm
const CHECK_PERIOD_MINUTES = 1;            // Check every minute

const DEFAULT_SETTINGS = {
  enabled: true,
  inactivityMinutes: 30,
  batterySaverOnly: false,
  showBadge: true,
  whitelist: [],
  restoreOnRestart: false
};

const MB_PER_TAB = 80; // Average RAM estimate per tab

// In-memory map for pending scroll restores (best-effort; lost on SW sleep — acceptable)
const pendingScrollRestores = {};

// ─── Alarm Guard Helper ───────────────────────────────────────────────────────────

/**
 * Ensure the single repeating alarm exists. Safe to call multiple times —
 * will not create a duplicate if it already exists.
 */
function ensureHibernationAlarm() {
  chrome.alarms.get(CHECK_ALARM, (existing) => {
    if (!existing) {
      chrome.alarms.create(CHECK_ALARM, {
        delayInMinutes: CHECK_PERIOD_MINUTES,
        periodInMinutes: CHECK_PERIOD_MINUTES
      });
    }
  });
}

// ─── Initialization ───────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async () => {
  // Merge defaults with any existing settings (preserves user choices on update)
  const existing = await getSettings();
  const merged = { ...DEFAULT_SETTINGS, ...existing };
  await chrome.storage.local.set({ settings: merged });

  // Stamp every open tab with a lastActivity time so we start tracking immediately
  await initAllTabTimestamps();

  // Ensure the global alarm is running
  ensureHibernationAlarm();

  updateBadge();
});

/**
 * Service workers can be killed and restarted at any time by Chrome.
 * onStartup fires on browser launch; but we also need the alarm re-registered
 * any time the SW wakes from sleep — ensureHibernationAlarm() handles that
 * idempotently.
 */
chrome.runtime.onStartup.addListener(async () => {
  const settings = await getSettings();

  if (settings.restoreOnRestart) {
    await wakeAllTabs();
  }

  // Re-stamp all open tabs
  await initAllTabTimestamps();

  // Re-register alarm in case it was cleared while browser was closed
  ensureHibernationAlarm();

  updateBadge();
});

// ─── Settings Helper ──────────────────────────────────────────────────────────────

async function getSettings() {
  const data = await chrome.storage.local.get('settings');
  return data.settings || { ...DEFAULT_SETTINGS };
}

// ─── Global Repeating Alarm Handler ──────────────────────────────────────────────

/**
 * Every minute: scan all tabs and suspend any that have been idle long enough.
 */
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== CHECK_ALARM) return;

  const settings = await getSettings();
  if (!settings.enabled) return;

  await checkAndHibernateTabs(settings);
});

/**
 * Core check: iterate all tabs, compare idle time vs. threshold, suspend eligible ones.
 */
async function checkAndHibernateTabs(settings) {
  const tabs = await chrome.tabs.query({});
  const nowMs = Date.now();
  const thresholdMs = (settings.inactivityMinutes || 30) * 60 * 1000;

  for (const tab of tabs) {
    const eligible = await canSuspendTab(tab, settings);
    if (!eligible) continue;

    // Read last-activity timestamp from storage
    const tabData = await getTabData(tab.id);
    const lastActivity = tabData?.lastActivity || tabData?.createdAt || nowMs;
    const idleMs = nowMs - lastActivity;

    if (idleMs >= thresholdMs) {
      await suspendTab(tab);
    }
  }
}

// ─── Tab Activity Stamping ────────────────────────────────────────────────────────

/**
 * Stamp every currently open tab with the current time as its lastActivity,
 * so the countdown starts from now.
 */
async function initAllTabTimestamps() {
  const tabs = await chrome.tabs.query({});
  const now = Date.now();
  const updates = {};
  for (const tab of tabs) {
    if (!tab.url) continue;
    if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) continue;
    const key = 'tabdata-' + tab.id;
    // Don't overwrite existing data — only set if missing
    const existing = await getTabData(tab.id);
    if (!existing) {
      updates[key] = { createdAt: now, lastActivity: now, scrollY: 0, hasFormInput: false };
    }
  }
  if (Object.keys(updates).length > 0) {
    await chrome.storage.local.set(updates);
  }
}

// ─── Suspension Logic ─────────────────────────────────────────────────────────────

/**
 * Check all exclusion rules. Returns true if the tab may be suspended.
 */
async function canSuspendTab(tab, settings) {
  if (!settings.enabled) return false;
  if (tab.pinned) return false;
  if (tab.active) return false;
  if (tab.audible) return false;

  if (!tab.url) return false;
  const url = tab.url;

  // Skip internal/system pages
  if (url.startsWith('chrome://') || url.startsWith('edge://') ||
      url.startsWith('chrome-extension://') || url.startsWith('about:') ||
      url.startsWith('devtools://') || url.startsWith('data:')) {
    return false;
  }

  // Skip already-suspended tabs
  if (url.startsWith(chrome.runtime.getURL('suspended.html'))) return false;

  // Skip whitelisted domains
  try {
    const parsed = new URL(url);
    const domain = parsed.hostname.replace(/^www\./, '');
    const wl = settings.whitelist || [];
    if (wl.some(w => w && domain.includes(w.trim().toLowerCase()))) {
      return false;
    }
  } catch (e) {
    return false; // Unparseable URL — skip
  }

  // Skip tabs younger than 5 minutes
  const tabData = await getTabData(tab.id);
  if (tabData?.createdAt) {
    const ageMs = Date.now() - tabData.createdAt;
    if (ageMs < 5 * 60 * 1000) return false;
  }

  // Skip tabs with active form input (reported by content script)
  if (tabData?.hasFormInput) return false;

  return true;
}

/**
 * Suspend a tab: save its state, navigate to suspended.html.
 */
async function suspendTab(tab) {
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

  // Persist the suspended tab's original data
  await chrome.storage.local.set({ ['suspended-' + tab.id]: suspendedInfo });
  await addToHibernatedList(tab.id);

  // Build the local suspended page URL
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

/**
 * Wake (restore) a suspended tab back to its original URL.
 */
async function wakeTab(tabId) {
  const key = 'suspended-' + tabId;
  const data = await chrome.storage.local.get(key);
  const info = data[key];

  if (!info?.url) return;

  // Navigate back
  await chrome.tabs.update(tabId, { url: info.url });

  // Clean up
  await chrome.storage.local.remove(key);
  await removeFromHibernatedList(tabId);

  // Queue scroll restore (best-effort)
  if (info.scrollY > 0) {
    pendingScrollRestores[tabId] = info.scrollY;
  }

  // Re-stamp lastActivity so the tab's timer starts fresh
  await chrome.storage.local.set({
    ['tabdata-' + tabId]: {
      createdAt: Date.now(),
      lastActivity: Date.now(),
      scrollY: 0,
      hasFormInput: false
    }
  });

  updateBadge();
}

// ─── Scroll Restore ───────────────────────────────────────────────────────────────

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  // Restore scroll position once the page finishes loading
  if (changeInfo.status === 'complete' && pendingScrollRestores[tabId] !== undefined) {
    const scrollY = pendingScrollRestores[tabId];
    delete pendingScrollRestores[tabId];
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: (y) => window.scrollTo(0, y),
        args: [scrollY]
      });
    } catch (e) {
      // Tab may not allow scripting (e.g. PDF, protected page) — ignore
    }
  }

  // When a tab finishes loading a new real page, stamp its lastActivity
  if (changeInfo.status === 'complete') {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.url && !tab.url.startsWith('chrome://') &&
          !tab.url.startsWith('chrome-extension://') &&
          !tab.url.startsWith(chrome.runtime.getURL('suspended.html'))) {
        const key = 'tabdata-' + tabId;
        const existing = await getTabData(tabId);
        // Reset timestamp on navigation to a new URL
        await chrome.storage.local.set({
          [key]: {
            createdAt: existing?.createdAt || Date.now(),
            lastActivity: Date.now(), // navigation = activity
            scrollY: 0,
            hasFormInput: false
          }
        });
      }
    } catch (e) { /* Tab may have closed */ }
  }
});

// ─── Bulk Operations ──────────────────────────────────────────────────────────────

async function hibernateAllTabs() {
  const settings = await getSettings();
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (await canSuspendTab(tab, settings)) {
      await suspendTab(tab);
    }
  }
}

async function wakeAllTabs() {
  const ids = await getHibernatedList();
  for (const tabId of ids) {
    try {
      await wakeTab(tabId);
    } catch (e) {
      // Tab no longer exists — purge
      await chrome.storage.local.remove('suspended-' + tabId);
      await removeFromHibernatedList(tabId);
    }
  }
  updateBadge();
}

// ─── Hibernated Tabs List ─────────────────────────────────────────────────────────

async function getHibernatedList() {
  const data = await chrome.storage.local.get('hibernatedTabs');
  return data.hibernatedTabs || [];
}

async function addToHibernatedList(tabId) {
  const list = await getHibernatedList();
  if (!list.includes(tabId)) {
    list.push(tabId);
    await chrome.storage.local.set({ hibernatedTabs: list });
  }
}

async function removeFromHibernatedList(tabId) {
  const list = await getHibernatedList();
  await chrome.storage.local.set({ hibernatedTabs: list.filter(id => id !== tabId) });
}

// ─── Tab Data ─────────────────────────────────────────────────────────────────────

async function getTabData(tabId) {
  const key = 'tabdata-' + tabId;
  const data = await chrome.storage.local.get(key);
  return data[key] || null;
}

// ─── Badge ────────────────────────────────────────────────────────────────────────

async function updateBadge() {
  const settings = await getSettings();
  const list = await getHibernatedList();
  const count = list.length;

  if (!settings.enabled) {
    chrome.action.setBadgeText({ text: 'OFF' });
    chrome.action.setBadgeBackgroundColor({ color: '#888888' });
  } else if (settings.showBadge && count > 0) {
    chrome.action.setBadgeText({ text: count.toString() });
    chrome.action.setBadgeBackgroundColor({ color: '#1D9E75' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

// ─── Tab Event Listeners ──────────────────────────────────────────────────────────

/**
 * When the user switches to a tab, stamp it as active (reset its idle clock).
 */
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const key = 'tabdata-' + activeInfo.tabId;
  const existing = await getTabData(activeInfo.tabId);
  await chrome.storage.local.set({
    [key]: {
      createdAt: existing?.createdAt || Date.now(),
      lastActivity: Date.now(), // user is looking at this tab
      scrollY: existing?.scrollY || 0,
      hasFormInput: existing?.hasFormInput || false
    }
  });
});

/**
 * When a tab is closed, clean up all its stored data.
 */
chrome.tabs.onRemoved.addListener(async (tabId) => {
  await chrome.storage.local.remove(['tabdata-' + tabId, 'suspended-' + tabId]);
  await removeFromHibernatedList(tabId);
  updateBadge();
});

// ─── Message Handling ─────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse);
  return true; // Keep channel open for async response
});

async function handleMessage(message, sender) {
  switch (message.action) {

    // ── Content script: user activity ──
    case 'reportActivity': {
      if (sender.tab) {
        const key = 'tabdata-' + sender.tab.id;
        const existing = await getTabData(sender.tab.id);
        await chrome.storage.local.set({
          [key]: {
            createdAt: existing?.createdAt || Date.now(),
            lastActivity: Date.now(), // reset the idle clock
            scrollY: existing?.scrollY || 0,
            hasFormInput: existing?.hasFormInput || false
          }
        });
      }
      return { success: true };
    }

    // ── Content script: tab data update (scroll, form) ──
    case 'updateTabData': {
      if (sender.tab) {
        const key = 'tabdata-' + sender.tab.id;
        const existing = await getTabData(sender.tab.id);
        await chrome.storage.local.set({
          [key]: {
            createdAt: existing?.createdAt || Date.now(),
            lastActivity: existing?.lastActivity || Date.now(),
            scrollY: message.scrollY ?? existing?.scrollY ?? 0,
            hasFormInput: message.hasFormInput ?? existing?.hasFormInput ?? false
          }
        });
      }
      return { success: true };
    }

    // ── Popup: stats ──
    case 'getStats': {
      const tabs = await chrome.tabs.query({});
      const hibernatedList = await getHibernatedList();
      const settings = await getSettings();
      const hibernatedCount = hibernatedList.length;
      return {
        totalTabs: tabs.length,
        activeTabs: tabs.length - hibernatedCount,
        hibernatedCount,
        mbSaved: hibernatedCount * MB_PER_TAB,
        enabled: settings.enabled
      };
    }

    // ── Popup: toggle extension on/off ──
    case 'toggleEnabled': {
      const settings = await getSettings();
      settings.enabled = !settings.enabled;
      await chrome.storage.local.set({ settings });

      if (settings.enabled) {
        // Re-stamp all tabs so timers restart cleanly
        await initAllTabTimestamps();
        ensureHibernationAlarm();
      } else {
        // Stop the alarm while disabled
        await chrome.alarms.clear(CHECK_ALARM);
      }

      updateBadge();
      return { enabled: settings.enabled };
    }

    // ── Popup: bulk actions ──
    case 'hibernateAll': {
      await hibernateAllTabs();
      return { success: true };
    }

    case 'wakeAll': {
      await wakeAllTabs();
      return { success: true };
    }

    // ── Suspended page: wake single tab ──
    case 'wakeTab': {
      if (message.tabId) {
        await wakeTab(message.tabId);
      }
      return { success: true };
    }

    // ── Options page ──
    case 'getSettings': {
      return await getSettings();
    }

    case 'saveSettings': {
      const newSettings = message.settings;
      // Preserve the current enabled state so options page can't accidentally disable
      const current = await getSettings();
      newSettings.enabled = current.enabled;
      await chrome.storage.local.set({ settings: newSettings });

      // Re-stamp all tabs so the new timeout takes effect from now
      await initAllTabTimestamps();

      // Ensure alarm is running (it may have been cleared if previously disabled)
      if (newSettings.enabled) {
        ensureHibernationAlarm();
      }

      updateBadge();
      return { success: true };
    }

    default:
      return { error: 'Unknown action: ' + message.action };
  }
}
