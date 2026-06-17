import { DEFAULT_SETTINGS, MB_PER_TAB } from './constants.js';

export async function getSettings() {
  const data = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
}

export async function getHibernatedList() {
  const data = await chrome.storage.local.get('hibernatedTabs');
  return data.hibernatedTabs || [];
}

export async function addToHibernatedList(tabId) {
  const list = await getHibernatedList();
  if (!list.includes(tabId)) {
    list.push(tabId);
    await chrome.storage.local.set({ hibernatedTabs: list });
  }
}

export async function removeFromHibernatedList(tabId) {
  const list = await getHibernatedList();
  await chrome.storage.local.set({ hibernatedTabs: list.filter(id => id !== tabId) });
}

export async function getTabData(tabId) {
  const key = 'tabdata-' + tabId;
  const data = await chrome.storage.local.get(key);
  return data[key] || null;
}

export async function updateBadge() {
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

export async function garbageCollectStorage() {
  try {
    const tabs = await chrome.tabs.query({});
    const activeTabIds = new Set(tabs.map(t => t.id));
    const allData = await chrome.storage.local.get(null);
    const keysToRemove = [];

    for (const key of Object.keys(allData)) {
      if (key.startsWith('tabdata-')) {
        const id = parseInt(key.replace('tabdata-', ''), 10);
        if (!activeTabIds.has(id)) {
          keysToRemove.push(key);
        }
      } else if (key.startsWith('suspended-')) {
        const id = parseInt(key.replace('suspended-', ''), 10);
        if (!activeTabIds.has(id)) {
          keysToRemove.push(key);
        }
      } else if (key.startsWith('snapshot-')) {
        const id = parseInt(key.replace('snapshot-', ''), 10);
        if (!activeTabIds.has(id)) {
          keysToRemove.push(key);
        }
      }
    }

    if (keysToRemove.length > 0) {
      await chrome.storage.local.remove(keysToRemove);
    }
    
    const hibernatedList = await getHibernatedList();
    const updatedList = hibernatedList.filter(id => activeTabIds.has(id));
    if (hibernatedList.length !== updatedList.length) {
      await chrome.storage.local.set({ hibernatedTabs: updatedList });
    }
  } catch (e) {
    // Fail-safe
  }
}

export async function initAllTabTimestamps() {
  const tabs = await chrome.tabs.query({});
  const now = Date.now();
  const updates = {};
  for (const tab of tabs) {
    if (!tab.url) continue;
    if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) continue;
    const key = 'tabdata-' + tab.id;
    const existing = await getTabData(tab.id);
    if (!existing) {
      updates[key] = { createdAt: now, lastActivity: now, scrollY: 0, hasFormInput: false };
    }
  }
  if (Object.keys(updates).length > 0) {
    await chrome.storage.local.set(updates);
  }
}

export async function updateAnalyticsOnSuspend(url) {
  try {
    const parsed = new URL(url);
    const domain = parsed.hostname.replace(/^www\./, '');
    const dateStr = new Date().toISOString().split('T')[0];

    const data = await chrome.storage.local.get('analytics');
    const analytics = data.analytics || {
      totalTabsSuspended: 0,
      dailyData: {},
      domainStats: {},
      peakSessionMemory: 0
    };

    analytics.totalTabsSuspended = (analytics.totalTabsSuspended || 0) + 1;
    
    if (!analytics.dailyData[dateStr]) {
      analytics.dailyData[dateStr] = { memorySaved: 0, tabsSuspended: 0 };
    }
    analytics.dailyData[dateStr].tabsSuspended += 1;
    analytics.dailyData[dateStr].memorySaved += MB_PER_TAB;

    analytics.domainStats[domain] = (analytics.domainStats[domain] || 0) + 1;

    const list = await getHibernatedList();
    const currentMemory = (list.length) * MB_PER_TAB; 
    if (currentMemory > (analytics.peakSessionMemory || 0)) {
      analytics.peakSessionMemory = currentMemory;
    }

    await chrome.storage.local.set({ analytics });
  } catch(e) {
    // Ignore invalid urls
  }
}

/**
 * Re-establishes id-keyed state for tabs currently showing the suspended
 * page. Tab ids are not stable across browser restarts, so after a restart
 * the `suspended-<id>` / `hibernatedTabs` entries reference dead ids and get
 * garbage-collected. This scans live suspended tabs, recreates any missing
 * `suspended-<newId>` record from the URL params embedded in the page, and
 * rebuilds the hibernated list with the current ids — so waking and the
 * badge keep working after a restart.
 */
export async function reconcileSuspendedTabs() {
  try {
    const tabs = await chrome.tabs.query({});
    const suspendedPrefix = chrome.runtime.getURL('suspended.html');
    const toSet = {};
    const currentIds = [];

    for (const tab of tabs) {
      if (!tab.url || !tab.url.startsWith(suspendedPrefix)) continue;
      currentIds.push(tab.id);

      const existing = await chrome.storage.local.get('suspended-' + tab.id);
      if (existing['suspended-' + tab.id]?.url) continue;

      try {
        const params = new URL(tab.url).searchParams;
        const url = params.get('url');
        if (!url) continue;
        toSet['suspended-' + tab.id] = {
          url,
          title: params.get('title') || 'Untitled',
          favicon: params.get('favicon') || '',
          scrollY: 0,
          suspendedAt: parseInt(params.get('suspendedAt'), 10) || Date.now(),
          tabId: tab.id
        };
      } catch (e) { /* skip malformed */ }
    }

    if (Object.keys(toSet).length > 0) {
      await chrome.storage.local.set(toSet);
    }

    const existingList = await getHibernatedList();
    const merged = Array.from(new Set([...existingList, ...currentIds]))
      .filter(id => currentIds.includes(id));
    await chrome.storage.local.set({ hibernatedTabs: merged });
  } catch (e) {
    // Fail-safe — reconciliation is best effort
  }
}
