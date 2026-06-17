export async function getStashedTabs() {
  const data = await chrome.storage.local.get('stashedTabs');
  return data.stashedTabs || [];
}

export async function stashTab(tab) {
  let title = tab.title || 'Untitled';
  let url = tab.url;
  let favicon = tab.favIconUrl || '';
  
  const suspendedPrefix = chrome.runtime.getURL('suspended.html');
  if (url && url.startsWith(suspendedPrefix)) {
    const suspendedData = await chrome.storage.local.get('suspended-' + tab.id);
    const info = suspendedData['suspended-' + tab.id];
    if (info) {
      title = info.title;
      url = info.url;
      favicon = info.favicon;
    } else {
      try {
        const urlObj = new URL(tab.url);
        title = urlObj.searchParams.get('title') || title;
        url = urlObj.searchParams.get('url') || '';
        favicon = urlObj.searchParams.get('favicon') || favicon;
      } catch (e) {}
    }
  }

  if (!url || url.startsWith('chrome://') || url.startsWith('edge://')) return;

  const stashItem = {
    id: Date.now() + Math.random().toString(36).substring(2, 9),
    title,
    url,
    favicon,
    stashedAt: Date.now()
  };

  const stashedTabs = await getStashedTabs();
  stashedTabs.push(stashItem);
  await chrome.storage.local.set({ stashedTabs });
  
  await chrome.tabs.remove(tab.id);
}

export async function restoreStashedTab(stashId) {
  const stashedTabs = await getStashedTabs();
  const index = stashedTabs.findIndex(t => t.id === stashId);
  if (index !== -1) {
    const item = stashedTabs[index];
    await chrome.tabs.create({ url: item.url, active: false });
    stashedTabs.splice(index, 1);
    await chrome.storage.local.set({ stashedTabs });
  }
}

// ─── Group Stashing ───

export async function getStashedGroups() {
  const data = await chrome.storage.local.get('stashedGroups');
  return data.stashedGroups || [];
}

export async function stashTabsAsGroup(tabs, groupTitle = 'Group', groupColor = 'grey') {
  if (tabs.length === 0) return false;

  const groupStash = {
    id: Date.now() + Math.random().toString(36).substring(2, 9),
    title: groupTitle,
    color: groupColor,
    stashedAt: Date.now(),
    tabs: []
  };

  const suspendedPrefix = chrome.runtime.getURL('suspended.html');

  for (const tab of tabs) {
    let title = tab.title || 'Untitled';
    let url = tab.url;
    let favicon = tab.favIconUrl || '';

    if (url && url.startsWith(suspendedPrefix)) {
      const suspendedData = await chrome.storage.local.get('suspended-' + tab.id);
      const info = suspendedData['suspended-' + tab.id];
      if (info) {
        title = info.title;
        url = info.url;
        favicon = info.favicon;
      } else {
        try {
          const urlObj = new URL(tab.url);
          title = urlObj.searchParams.get('title') || title;
          url = urlObj.searchParams.get('url') || '';
          favicon = urlObj.searchParams.get('favicon') || favicon;
        } catch (e) {}
      }
    }

    if (url && !url.startsWith('chrome://') && !url.startsWith('edge://')) {
      groupStash.tabs.push({ url, title, favicon });
    }
  }

  if (groupStash.tabs.length > 0) {
    const stashedGroups = await getStashedGroups();
    stashedGroups.push(groupStash);
    await chrome.storage.local.set({ stashedGroups });
  }

  // Close all tabs in the group
  await chrome.tabs.remove(tabs.map(t => t.id));
  return true;
}

export async function stashCurrentGroup(activeTab) {
  if (activeTab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) return false;

  try {
    const group = await chrome.tabGroups.get(activeTab.groupId);
    const tabs = await chrome.tabs.query({ groupId: activeTab.groupId });
    
    return await stashTabsAsGroup(tabs, group.title, group.color);
  } catch (e) {
    console.error('Failed to stash group:', e);
    return false;
  }
}

export async function restoreStashedGroup(stashId) {
  const stashedGroups = await getStashedGroups();
  const index = stashedGroups.findIndex(g => g.id === stashId);
  if (index !== -1) {
    const groupItem = stashedGroups[index];
    
    if (groupItem.tabs && groupItem.tabs.length > 0) {
      const tabIds = [];
      for (const t of groupItem.tabs) {
        const newTab = await chrome.tabs.create({ url: t.url, active: false });
        tabIds.push(newTab.id);
      }
      
      try {
        const newGroupId = await chrome.tabs.group({ tabIds });
        await chrome.tabGroups.update(newGroupId, {
          title: groupItem.title,
          color: groupItem.color
        });
      } catch (e) {
        // Fallback if tabGroups API fails (e.g. grouped across multiple windows somehow)
        console.error('Could not group restored tabs', e);
      }
    }
    
    stashedGroups.splice(index, 1);
    await chrome.storage.local.set({ stashedGroups });
  }
}
