document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('startBtn').addEventListener('click', () => {
    // If running in Chrome Extension environment, open Dashboard and close this tab
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
      // Small delay to let the dashboard open before closing
      setTimeout(() => {
        window.close();
      }, 100);
    } else {
      // Fallback for local testing
      window.location.href = 'dashboard.html';
    }
  });
});
