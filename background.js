import { 
  CHECK_ALARM, CHECK_PERIOD_MINUTES, DEFAULT_SETTINGS, MB_PER_TAB 
} from './bg/constants.js';

import {
  garbageCollectStorage, getSettings, initAllTabTimestamps, updateBadge, getTabData, getHibernatedList, reconcileSuspendedTabs
} from './bg/storage.js';

import { updateTabSnapshot } from './bg/snapshot.js';

import {
  checkAndHibernateTabs, wakeTab, hibernateAllTabs, wakeAllTabs, pendingScrollRestores, suspendTab
} from './bg/hibernation.js';

import {
  getStashedTabs, stashTab, restoreStashedTab,
  getStashedGroups, stashCurrentGroup, restoreStashedGroup, stashTabsAsGroup
} from './bg/stash.js';

// ─── Alarm Guard Helper ───────────────────────────────────────────────────────────

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

chrome.runtime.onInstalled.addListener(async (details) => {
  const existing = await getSettings();
  const merged = { ...DEFAULT_SETTINGS, ...existing };
  await chrome.storage.local.set({ settings: merged });

  await initAllTabTimestamps();
  await garbageCollectStorage();
  await reconcileSuspendedTabs();
  ensureHibernationAlarm();
  updateBadge();

  // Show changelog on any version change (was hardcoded to 2.0.0).
  if (details.reason === 'install' || details.reason === 'update') {
    const currentVersion = chrome.runtime.getManifest().version;
    const store = await chrome.storage.local.get('lastChangelogVersion');
    if (store.lastChangelogVersion !== currentVersion) {
      await chrome.storage.local.set({ lastChangelogVersion: currentVersion });
      chrome.tabs.create({ url: chrome.runtime.getURL('changelog.html') });
    }
  }
});

chrome.runtime.onStartup.addListener(async () => {
  const settings = await getSettings();
  if (settings.restoreOnRestart) {
    await wakeAllTabs();
  }
  await initAllTabTimestamps();
  await garbageCollectStorage();
  await reconcileSuspendedTabs();
  ensureHibernationAlarm();
  updateBadge();
});

// ─── Global Repeating Alarm Handler ──────────────────────────────────────────────

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== CHECK_ALARM) return;
  const settings = await getSettings();
  if (!settings.enabled) return;
  await checkAndHibernateTabs(settings);
});

// ─── Scroll Restore & Snapshot Triggers ──────────────────────────────────────────

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
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
      // Ignore
    }
  }

  if (changeInfo.status === 'complete') {
    if (tab && tab.active) {
      const settings = await getSettings();
      if (settings.snapshotsEnabled) {
        updateTabSnapshot(tab.windowId, tabId);
      }
    }
    try {
      const t = tab || await chrome.tabs.get(tabId);
      if (t.url && !t.url.startsWith('chrome://') &&
          !t.url.startsWith('chrome-extension://') &&
          !t.url.startsWith(chrome.runtime.getURL('suspended.html'))) {
        const key = 'tabdata-' + tabId;
        const existing = await getTabData(tabId);
        // Only treat a finished load as fresh activity for the active tab.
        // Otherwise auto-refreshing background tabs would never become eligible.
        const lastActivity = t.active
          ? Date.now()
          : (existing?.lastActivity || existing?.createdAt || Date.now());
        await chrome.storage.local.set({
          [key]: {
            createdAt: existing?.createdAt || Date.now(),
            lastActivity,
            scrollY: 0,
            hasFormInput: false
          }
        });
      }
    } catch (e) { }
  }
});

// ─── Tab Event Listeners ──────────────────────────────────────────────────────────

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const key = 'tabdata-' + activeInfo.tabId;
  const existing = await getTabData(activeInfo.tabId);
  await chrome.storage.local.set({
    [key]: {
      createdAt: existing?.createdAt || Date.now(),
      lastActivity: Date.now(),
      scrollY: existing?.scrollY || 0,
      hasFormInput: existing?.hasFormInput || false
    }
  });

  try {
    const settings = await getSettings();
    if (settings.snapshotsEnabled) {
      updateTabSnapshot(activeInfo.windowId, activeInfo.tabId);
    }
    if (settings.autoWakeOnFocus) {
      const tab = await chrome.tabs.get(activeInfo.tabId);
      const suspendedPrefix = chrome.runtime.getURL('suspended.html');
      if (tab.url && tab.url.startsWith(suspendedPrefix)) {
        const urlObj = new URL(tab.url);
        const storedTabId = parseInt(urlObj.searchParams.get('tabId'), 10) || activeInfo.tabId;
        const fallback = { url: urlObj.searchParams.get('url') || '' };
        await wakeTab(storedTabId, activeInfo.tabId, fallback);
      }
    }
  } catch (e) {}
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await chrome.storage.local.remove(['tabdata-' + tabId, 'suspended-' + tabId, 'snapshot-' + tabId]);
  const list = await getHibernatedList();
  await chrome.storage.local.set({ hibernatedTabs: list.filter(id => id !== tabId) });
  updateBadge();
});

// ─── Message Handling ─────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse);
  return true;
});

async function handleMessage(message, sender) {
  switch (message.action) {
    case 'updateBatteryStatus': {
      if (message.charging !== undefined) {
        await chrome.storage.local.set({ deviceCharging: message.charging });
      }
      return { success: true };
    }
    case 'reportActivity': {
      if (sender.tab) {
        const key = 'tabdata-' + sender.tab.id;
        const existing = await getTabData(sender.tab.id);
        await chrome.storage.local.set({
          [key]: {
            createdAt: existing?.createdAt || Date.now(),
            lastActivity: Date.now(),
            scrollY: existing?.scrollY || 0,
            hasFormInput: existing?.hasFormInput || false
          }
        });
      }
      return { success: true };
    }
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
    case 'getStats': {
      const tabs = await chrome.tabs.query({});
      const settings = await getSettings();
      // Count tabs actually parked on the suspended page rather than the
      // persisted list, which can drift (e.g. across restarts).
      const suspendedPrefix = chrome.runtime.getURL('suspended.html');
      const hibernatedCount = tabs.filter(t => t.url && t.url.startsWith(suspendedPrefix)).length;
      return {
        totalTabs: tabs.length,
        activeTabs: tabs.length - hibernatedCount,
        hibernatedCount,
        mbSaved: hibernatedCount * MB_PER_TAB,
        enabled: settings.enabled
      };
    }
    case 'getDashboardStats': {
      const data = await chrome.storage.local.get('analytics');
      const list = await getHibernatedList();
      const currentMemory = list.length * MB_PER_TAB;
      return {
        analytics: data.analytics || {},
        currentSessionMemory: currentMemory,
        mbPerTab: MB_PER_TAB
      };
    }
    case 'toggleEnabled': {
      const settings = await getSettings();
      settings.enabled = !settings.enabled;
      await chrome.storage.local.set({ settings });
      if (settings.enabled) {
        await initAllTabTimestamps();
        ensureHibernationAlarm();
      } else {
        await chrome.alarms.clear(CHECK_ALARM);
      }
      updateBadge();
      return { enabled: settings.enabled };
    }
    case 'hibernateAll': {
      await hibernateAllTabs();
      return { success: true };
    }
    case 'wakeAll': {
      await wakeAllTabs();
      return { success: true };
    }
    case 'wakeTab': {
      if (message.tabId) {
        const fallback = message.url ? { url: message.url } : null;
        await wakeTab(message.tabId, sender.tab?.id, fallback);
      }
      return { success: true };
    }
    case 'getSuspendedTabs': {
      const tabs = await chrome.tabs.query({});
      const results = [];
      const suspendedPrefix = chrome.runtime.getURL('suspended.html');
      for (const tab of tabs) {
        if (sender.tab && tab.id === sender.tab.id) continue;
        const isSuspended = tab.url && tab.url.startsWith(suspendedPrefix);
        if (isSuspended) {
          const key = 'suspended-' + tab.id;
          const data = await chrome.storage.local.get(key);
          const info = data[key];
          if (info) {
            results.push({
              tabId: tab.id,
              title: info.title || 'Untitled Tab',
              url: info.url || '',
              favicon: info.favicon || '',
              isSuspended: true,
              suspendedAt: info.suspendedAt || Date.now()
            });
          } else {
            try {
              const urlObj = new URL(tab.url);
              const params = new URLSearchParams(urlObj.search);
              results.push({
                tabId: tab.id,
                title: params.get('title') || 'Untitled Tab',
                url: params.get('url') || '',
                favicon: params.get('favicon') || '',
                isSuspended: true,
                suspendedAt: parseInt(params.get('suspendedAt'), 10) || Date.now()
              });
            } catch (e) {}
          }
        } else {
          if (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') ||
              tab.url.startsWith('chrome-extension://') || tab.url.startsWith('about:'))) {
            continue;
          }
          results.push({
            tabId: tab.id,
            title: tab.title || 'Untitled Tab',
            url: tab.url || '',
            favicon: tab.favIconUrl || '',
            isSuspended: false,
            suspendedAt: null
          });
        }
      }
      return results;
    }
    case 'wakeAndFocusTab': {
      if (message.tabId) {
        try {
          const tab = await chrome.tabs.get(message.tabId);
          const suspendedPrefix = chrome.runtime.getURL('suspended.html');
          if (tab.url && tab.url.startsWith(suspendedPrefix)) {
            await wakeTab(message.tabId);
          }
          await chrome.tabs.update(message.tabId, { active: true });
          await chrome.windows.update(tab.windowId, { focused: true });
        } catch (e) {}
      }
      return { success: true };
    }
    case 'getSettings': {
      return await getSettings();
    }
    case 'saveSettings': {
      const newSettings = message.settings;
      const current = await getSettings();
      newSettings.enabled = current.enabled;
      await chrome.storage.local.set({ settings: newSettings });
      await initAllTabTimestamps();
      if (newSettings.enabled) {
        ensureHibernationAlarm();
      }
      updateBadge();
      return { success: true };
    }
    
    // ── Deep Sleep Stashing ──
    case 'stashCurrentTab': {
      if (sender.tab) {
        await stashTab(sender.tab);
      } else {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (activeTab) await stashTab(activeTab);
      }
      return { success: true };
    }
    case 'stashCurrentGroup': {
      if (sender.tab && sender.tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
        await stashCurrentGroup(sender.tab);
      } else {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (activeTab && activeTab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
          await stashCurrentGroup(activeTab);
        }
      }
      return { success: true };
    }
    case 'stashAllSuspended': {
      const tabs = await chrome.tabs.query({});
      const suspendedPrefix = chrome.runtime.getURL('suspended.html');
      
      const suspendedTabs = tabs.filter(tab => tab.url && tab.url.startsWith(suspendedPrefix));
      
      const tabsByGroup = {};
      const individualTabs = [];
      
      for (const tab of suspendedTabs) {
        if (tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
          if (!tabsByGroup[tab.groupId]) tabsByGroup[tab.groupId] = [];
          tabsByGroup[tab.groupId].push(tab);
        } else {
          individualTabs.push(tab);
        }
      }
      
      const groupIds = Object.keys(tabsByGroup);
      if (groupIds.length > 0) {
        await Promise.allSettled(groupIds.map(async (groupId) => {
          const groupTabs = tabsByGroup[groupId];
          try {
            const groupInfo = await chrome.tabGroups.get(parseInt(groupId, 10));
            await stashTabsAsGroup(groupTabs, groupInfo.title, groupInfo.color);
          } catch (e) {
            // Fallback: If we can't find the group info, stash them individually
            for (const t of groupTabs) {
               individualTabs.push(t);
            }
          }
        }));
      }
      
      for (const tab of individualTabs) {
        await stashTab(tab);
      }
      return { success: true };
    }
    case 'getStashedTabs': {
      return await getStashedTabs();
    }
    case 'restoreStashedTab': {
      if (message.stashId) {
        await restoreStashedTab(message.stashId);
      }
      return { success: true };
    }
    case 'getStashedGroups': {
      return await getStashedGroups();
    }
    case 'restoreStashedGroup': {
      if (message.stashId) {
        await restoreStashedGroup(message.stashId);
      }
      return { success: true };
    }
    case 'clearStashedTabs': {
      await chrome.storage.local.set({ stashedTabs: [], stashedGroups: [] });
      return { success: true };
    }
    
    // ── Check if active tab is in a group ──
    case 'checkActiveTabGroup': {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return { 
        inGroup: activeTab && activeTab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE 
      };
    }

    default:
      return { error: 'Unknown action: ' + message.action };
  }
}

// ─── Keyboard Shortcuts HUD Trigger ──────────────────────────────────────────────
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'toggle-quick-hud') {
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (activeTab && activeTab.id) {
        const url = activeTab.url || '';
        if (url.startsWith('chrome://') || url.startsWith('chrome-extension://') ||
            url.startsWith('edge://') || url.startsWith('about:')) {
          return;
        }
        await chrome.tabs.sendMessage(activeTab.id, { action: 'toggleHUD' });
      }
    } catch (e) {}
  }
});
