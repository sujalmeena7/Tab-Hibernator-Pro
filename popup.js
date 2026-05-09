/**
 * popup.js — Tab Hibernator Pro Popup Logic
 */
(function () {
  'use strict';

  const activeTabs = document.getElementById('activeTabs');
  const hibernatedTabs = document.getElementById('hibernatedTabs');
  const memorySaved = document.getElementById('memorySaved');
  const enableCheckbox = document.getElementById('enableCheckbox');
  const hibernateAllBtn = document.getElementById('hibernateAllBtn');
  const wakeAllBtn = document.getElementById('wakeAllBtn');
  const optionsLink = document.getElementById('optionsLink');
  const container = document.querySelector('.popup-container');

  // Load stats on popup open
  loadStats();

  async function loadStats() {
    const stats = await sendMessage({ action: 'getStats' });
    if (stats) {
      activeTabs.textContent = stats.activeTabs;
      hibernatedTabs.textContent = stats.hibernatedCount;
      memorySaved.textContent = '~' + stats.mbSaved + ' MB';
      enableCheckbox.checked = stats.enabled;
      container.classList.toggle('disabled', !stats.enabled);
    }
  }

  // Toggle enable/disable
  enableCheckbox.addEventListener('change', async () => {
    const result = await sendMessage({ action: 'toggleEnabled' });
    if (result) {
      container.classList.toggle('disabled', !result.enabled);
      loadStats();
    }
  });

  // Hibernate all
  hibernateAllBtn.addEventListener('click', async () => {
    hibernateAllBtn.disabled = true;
    hibernateAllBtn.textContent = 'Hibernating...';
    await sendMessage({ action: 'hibernateAll' });
    // Brief delay to let background finish
    setTimeout(() => {
      loadStats();
      hibernateAllBtn.disabled = false;
      hibernateAllBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z"/></svg>Hibernate All';
    }, 500);
  });

  // Wake all
  wakeAllBtn.addEventListener('click', async () => {
    wakeAllBtn.disabled = true;
    wakeAllBtn.textContent = 'Waking...';
    await sendMessage({ action: 'wakeAll' });
    setTimeout(() => {
      loadStats();
      wakeAllBtn.disabled = false;
      wakeAllBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>Wake All';
    }, 500);
  });

  // Settings link
  optionsLink.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  // Buy Me a Coffee — opens in a new tab (avoids CSP issues with external images)
  document.getElementById('coffeeLink').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: 'https://buymeacoffee.com/sujalmeena7' });
  });

  // Helper
  function sendMessage(msg) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(msg, (response) => {
        resolve(response);
      });
    });
  }
})();
