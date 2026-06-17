let snapshotDebounce = {};

export async function updateTabSnapshot(windowId, tabId) {
  if (snapshotDebounce[windowId]) clearTimeout(snapshotDebounce[windowId]);
  
  snapshotDebounce[windowId] = setTimeout(async () => {
    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 10 });
      if (dataUrl) {
        const allData = await chrome.storage.local.get(null);
        const snapshotKeys = Object.keys(allData).filter(k => k.startsWith('snapshot-'));
        
        if (snapshotKeys.length >= 50) {
          const snapshotsWithTime = [];
          for (const k of snapshotKeys) {
            const tId = k.replace('snapshot-', '');
            const tabData = allData['tabdata-' + tId];
            snapshotsWithTime.push({ key: k, time: tabData ? tabData.lastActivity : 0 });
          }
          snapshotsWithTime.sort((a, b) => b.time - a.time);
          const keysToDelete = snapshotsWithTime.slice(49).map(x => x.key);
          if (keysToDelete.length > 0) {
            await chrome.storage.local.remove(keysToDelete);
          }
        }
        
        await chrome.storage.local.set({ [`snapshot-${tabId}`]: dataUrl });
      }
    } catch (e) {
      // Ignore errors (e.g. internal pages, devtools, or window closed)
    }
  }, 800); // 800ms delay to allow render
}
