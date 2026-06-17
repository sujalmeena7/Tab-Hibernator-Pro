import { getTabData, addToHibernatedList, updateAnalyticsOnSuspend, getSettings, removeFromHibernatedList, getHibernatedList, updateBadge } from './storage.js';

export const pendingScrollRestores = {};

export async function checkAndHibernateTabs(settings) {
  const tabs = await chrome.tabs.query({});
  const nowMs = Date.now();
  let thresholdMs = (settings.inactivityMinutes || 30) * 60 * 1000;

  // Filter eligible tabs first to short-circuit system calls if session is quiet
  const eligibleTabs = [];
  for (const tab of tabs) {
    if (await canSuspendTab(tab, settings)) {
      eligibleTabs.push(tab);
    }
  }

  if (eligibleTabs.length === 0) return;

  if (settings.smartMemoryEnabled && chrome.system && chrome.system.memory) {
    try {
      const memInfo = await chrome.system.memory.getInfo();
      if (memInfo && memInfo.capacity > 0) {
        const ratio = memInfo.availableCapacity / memInfo.capacity;
        const availableGB = memInfo.availableCapacity / (1024 * 1024 * 1024);
        
        if (ratio < 0.15 || availableGB < 1.0) {
          // Critical: low ratio OR low absolute free RAM -> 5x faster hibernation
          thresholdMs = thresholdMs * 0.2;
        } else if (ratio < 0.25 || availableGB < 2.0) {
          // Tight: low ratio OR low absolute free RAM -> 2x faster hibernation
          thresholdMs = thresholdMs * 0.5;
        }
      }
    } catch (e) {
      // Fallback to strict time if API fails
    }
  }

  for (const tab of eligibleTabs) {

    const tabData = await getTabData(tab.id);
    const lastActivity = tabData?.lastActivity || tabData?.createdAt || nowMs;
    const idleMs = nowMs - lastActivity;

    if (idleMs >= thresholdMs) {
      await suspendTab(tab);
    }
  }
}

export async function canSuspendTab(tab, settings, isManual = false) {
  if (!settings.enabled && !isManual) return false;

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
