/**
 * options.js — Tab Hibernator Pro Settings Logic
 */
(function () {
  'use strict';

  const timeoutSlider = document.getElementById('timeoutSlider');
  const timeoutValue = document.getElementById('timeoutValue');
  const batterySaver = document.getElementById('batterySaver');
  const showBadge = document.getElementById('showBadge');
  const restoreOnRestart = document.getElementById('restoreOnRestart');
  const whitelist = document.getElementById('whitelist');
  const saveBtn = document.getElementById('saveBtn');
  const saveStatus = document.getElementById('saveStatus');

  // Format minutes for display
  function formatTime(mins) {
    if (mins < 60) return mins + ' min';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (m === 0) return h + (h === 1 ? ' hour' : ' hours');
    return h + 'h ' + m + 'm';
  }

  // Update slider label in real time
  timeoutSlider.addEventListener('input', () => {
    timeoutValue.textContent = formatTime(parseInt(timeoutSlider.value, 10));
  });

  // Load settings on page open
  loadSettings();

  async function loadSettings() {
    const settings = await sendMessage({ action: 'getSettings' });
    if (settings) {
      timeoutSlider.value = settings.inactivityMinutes || 30;
      timeoutValue.textContent = formatTime(settings.inactivityMinutes || 30);
      batterySaver.checked = settings.batterySaverOnly || false;
      showBadge.checked = settings.showBadge !== false;
      restoreOnRestart.checked = settings.restoreOnRestart || false;
      whitelist.value = (settings.whitelist || []).join('\n');
    }
  }

  // Save settings
  saveBtn.addEventListener('click', async () => {
    const whitelistDomains = whitelist.value
      .split('\n')
      .map(d => d.trim().toLowerCase())
      .filter(d => d.length > 0);

    const settings = {
      enabled: true, // preserve enabled state from existing
      inactivityMinutes: parseInt(timeoutSlider.value, 10),
      batterySaverOnly: batterySaver.checked,
      showBadge: showBadge.checked,
      whitelist: whitelistDomains,
      restoreOnRestart: restoreOnRestart.checked
    };

    // Preserve current enabled state
    const current = await sendMessage({ action: 'getSettings' });
    if (current) {
      settings.enabled = current.enabled;
    }

    await sendMessage({ action: 'saveSettings', settings: settings });

    // Show confirmation
    saveStatus.textContent = '✓ Settings saved';
    saveStatus.classList.add('visible');
    setTimeout(() => {
      saveStatus.classList.remove('visible');
    }, 2500);
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
