import { 
  CHECK_ALARM, CHECK_PERIOD_MINUTES, DEFAULT_SETTINGS, MB_PER_TAB 
} from './bg/constants.js';

import {
  garbageCollectStorage, getSettings, initAllTabTimestamps, updateBadge, getTabData, getHibernatedList, reconcileSuspendedTabs
} from './bg/storage.js';

import { updateTabSnapshot } from './bg/snapshot.js';

import { debouncedSetMany } from './bg/debounced-storage.js';

import { getTabOverride, setTabOverride, clearTabOverride } from './bg/pause.js';

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

// ─── Right-Click Context Menu: Pause Hibernation ──────────────────────────────────

const CTX_PREFIX = 'thp-pause-';

function buildContextMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: CTX_PREFIX + 'parent',
      title: 'Tab Hibernator',
      contexts: ['all']
    });
    chrome.contextMenus.create({
      id: CTX_PREFIX + '15m',
      parentId: CTX_PREFIX + 'parent',
      title: 'Pause for 15 minutes',
      contexts: ['all']
    });
    chrome.contextMenus.create({
      id: CTX_PREFIX + '1h',
      parentId: CTX_PREFIX + 'parent',
      title: 'Pause for 1 hour',
      contexts: ['all']
    });
    chrome.contextMenus.create({
      id: CTX_PREFIX + 'session',
      parentId: CTX_PREFIX + 'parent',
      title: 'Pause until I close this tab',
      contexts: ['all']
    });
    chrome.contextMenus.create({
      id: CTX_PREFIX + 'forever',
      parentId: CTX_PREFIX + 'parent',
      title: 'Never hibernate this tab',
      contexts: ['all']
    });
    chrome.contextMenus.create({
      id: CTX_PREFIX + 'resume',
      parentId: CTX_PREFIX + 'parent',
      title: 'Resume hibernation',
      contexts: ['all']
    });
  });
}

function applyPauseFromMenuId(menuItemId, tabId) {
  if (menuItemId === CTX_PREFIX + 'resume') {
    return clearTabOverride(tabId);
  }
  if (menuItemId === CTX_PREFIX + '15m') {
    return setTabOverride(tabId, { mode: 'pause', until: Date.now() + 15 * 60 * 1000 });
  }
  if (menuItemId === CTX_PREFIX + '1h') {
    return setTabOverride(tabId, { mode: 'pause', until: Date.now() + 60 * 60 * 1000 });
  }
  if (menuItemId === CTX_PREFIX + 'session') {
    return setTabOverride(tabId, { mode: 'pause', until: Infinity });
  }
  if (menuItemId === CTX_PREFIX + 'forever') {
    return setTabOverride(tabId, { mode: 'never' });
  }
  return Promise.resolve();
}

// Rebuild the menu on install, update, and browser start so it survives
// service-worker restarts.
chrome.runtime.onInstalled.addListener(buildContextMenu);
chrome.runtime.onStartup.addListener(buildContextMenu);

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab || !tab.id) return;
  if (!info.menuItemId.startsWith(CTX_PREFIX)) return;

  await applyPauseFromMenuId(info.menuItemId, tab.id);

  // Show a tiny confirmation so the user knows their click did something.
  const after = await getTabOverride(tab.id);
  let message = '';
  if (info.menuItemId === CTX_PREFIX + 'resume') {
    message = 'Hibernation resumed for this tab';
  } else if (after?.mode === 'never') {
    message = 'This tab will never be hibernated';
  } else if (after?.until === Infinity) {
    message = 'Paused until you close this tab';
  } else if (after?.until) {
    const mins = Math.max(1, Math.round((after.until - Date.now()) / 60000));
    message = `Paused for ${mins} minute${mins === 1 ? '' : 's'}`;
  }
  if (message) {
    // Mark the tab so the user can see the pause is active (tab-level badge).
    try {
      await chrome.action.setBadgeText({ tabId: tab.id, text: '⏸' });
      await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#d97706' });
    } catch (_) { /* tab-level badge may not be supported everywhere */ }

    // Inject a small in-page toast so the user sees the result immediately.
    // We skip chrome:// pages and the extension's own pages where injection fails.
    if (tab.url && !tab.url.startsWith('chrome://') &&
        !tab.url.startsWith('chrome-extension://') &&
        !tab.url.startsWith('about:') && tab.id) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: showPauseToast,
          args: [message]
        });
      } catch (_) { /* page may not allow injection (e.g. chrome web store) */ }
    }
  }
});

/**
 * Injected into the page to render a small ephemeral toast confirming the pause.
 * Runs in the page's isolated world; uses Shadow DOM so it can't be styled by
 * the host page. Self-destructs after a few seconds.
 */
function showPauseToast(message) {
  const host = document.createElement('div');
  host.id = 'tab-hibernator-toast-host';
  host.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:2147483647;pointer-events:none;';
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      .toast {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 10px 14px;
        background: rgba(17, 17, 24, 0.92);
        color: #f4f5f9;
        font: 600 13px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        letter-spacing: -0.01em;
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 10px;
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.4);
        backdrop-filter: blur(12px) saturate(180%);
        -webkit-backdrop-filter: blur(12px) saturate(180%);
        opacity: 0;
        transform: translateY(8px) scale(0.96);
        animation: thp-in 0.22s cubic-bezier(0.16, 1, 0.3, 1) forwards,
                   thp-out 0.25s cubic-bezier(0.4, 0, 0.2, 1) 2.4s forwards;
      }
      .dot {
        width: 8px; height: 8px;
        border-radius: 50%;
        background: #d97706;
        box-shadow: 0 0 10px #d97706;
        flex-shrink: 0;
      }
      @keyframes thp-in {
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      @keyframes thp-out {
        to { opacity: 0; transform: translateY(4px) scale(0.98); }
      }
    </style>
    <div class="toast"><span class="dot"></span><span></span></div>
  `;
  shadow.querySelector('.toast span:last-child').textContent = message;

  // Clean up after the animation finishes.
  setTimeout(() => host.remove(), 2800);
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
        debouncedSetMany({
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
  debouncedSetMany({
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
  // Clear per-tab pause override + tab-level pause badge.
  await clearTabOverride(tabId);
  try { await chrome.action.setBadgeText({ tabId, text: '' }); } catch (_) {}
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
        debouncedSetMany({
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
        debouncedSetMany({
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
