/**
 * content.js — Tab Hibernator Pro Content Script
 * Tracks: activity, form input, scroll position
 */
(function () {
  'use strict';

  let hasFormInput = false;
  let lastScrollY = 0;
  let reportTimeout = null;
  let sendDebounce = null;
  let formCheckDebounce = null;
  let scrollDebounce = null;

  const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'scroll', 'touchstart'];

  function onActivity() {
    if (!reportTimeout) {
      chrome.runtime.sendMessage({ action: 'reportActivity' }).catch(() => {});
      reportTimeout = setTimeout(() => { reportTimeout = null; }, 30000);
    }
  }

  ACTIVITY_EVENTS.forEach(e => {
    document.addEventListener(e, onActivity, { passive: true, capture: true });
  });

  // ─── Battery Saver Status Reporting ──────────────────────────────────────────────
  if (navigator.getBattery) {
    navigator.getBattery().then(battery => {
      function reportBatteryStatus() {
        chrome.runtime.sendMessage({
          action: 'updateBatteryStatus',
          charging: battery.charging,
          level: battery.level
        }).catch(() => {});
      }
      reportBatteryStatus();
      battery.addEventListener('chargingchange', reportBatteryStatus);
      battery.addEventListener('levelchange', reportBatteryStatus);
    }).catch(() => {});
  }

  /**
   * Smart form detection: scans ALL form fields on the page for user-typed
   * content. This protects partially-filled forms (e.g. IRCTC booking,
   * sign-up flows) from being hibernated even when the tab isn't focused.
   *
   * Previous approach only checked document.activeElement, which resets to
   * <body> when the user switches tabs — causing hasFormInput to become false
   * and allowing hibernation to wipe unsaved form data.
   */
  const IGNORED_INPUT_TYPES = new Set([
    'checkbox','radio','submit','button','hidden','reset','image','search','range','color','file'
  ]);

  function checkFormInput() {
    // 1. Text-like <input> fields
    const inputs = document.querySelectorAll('input');
    for (const el of inputs) {
      const type = (el.type || 'text').toLowerCase();
      if (IGNORED_INPUT_TYPES.has(type)) continue;
      if (el.offsetParent === null && el.type !== 'hidden') continue;
      if ((el.value || '').trim().length > 0 && el.value !== el.defaultValue) {
        updateFormInput(true);
        return;
      }
    }

    // 2. Textareas
    const textareas = document.querySelectorAll('textarea');
    for (const el of textareas) {
      if (el.offsetParent === null) continue;
      if ((el.value || '').trim().length > 0 && el.value !== el.defaultValue) {
        updateFormInput(true);
        return;
      }
    }

    // 3. ContentEditable (Gmail compose, rich text editors)
    const editables = document.querySelectorAll('[contenteditable="true"], [contenteditable=""]');
    for (const el of editables) {
      if (el.offsetParent === null) continue;
      if ((el.innerText || '').trim().length > 0) {
        updateFormInput(true);
        return;
      }
    }

    // 4. Selects with a non-default value
    const selects = document.querySelectorAll('select');
    for (const el of selects) {
      if (el.offsetParent === null) continue;
      const defaultOption = el.querySelector('option[selected]');
      const defaultVal = defaultOption ? defaultOption.value : (el.options[0]?.value ?? '');
      if (el.value !== defaultVal) {
        updateFormInput(true);
        return;
      }
    }

    updateFormInput(false);
  }

  function updateFormInput(value) {
    if (hasFormInput !== value) { hasFormInput = value; sendUpdate(); }
  }

  // Re-check on any user input (uses its own debounce so a concurrent scroll
  // can't cancel a pending form check)
  document.addEventListener('input', () => {
    if (formCheckDebounce) clearTimeout(formCheckDebounce);
    formCheckDebounce = setTimeout(() => {
      checkFormInput();
    }, 500);
  }, { passive: true, capture: true });

  document.addEventListener('focusin', checkFormInput, { passive: true });
  document.addEventListener('focusout', () => {
    setTimeout(checkFormInput, 300);
  }, { passive: true });

  // Periodic re-check to catch dynamically added forms / SPA navigation
  setInterval(checkFormInput, 30000);

  document.addEventListener('scroll', () => {
    if (scrollDebounce) clearTimeout(scrollDebounce);
    scrollDebounce = setTimeout(() => {
      lastScrollY = window.scrollY || 0;
      sendUpdate();
    }, 500);
  }, { passive: true });

  function sendUpdate() {
    if (sendDebounce) clearTimeout(sendDebounce);
    sendDebounce = setTimeout(() => {
      chrome.runtime.sendMessage({
        action: 'updateTabData',
        scrollY: lastScrollY,
        hasFormInput: hasFormInput
      }).catch(() => {});
    }, 1000);
  }

  setTimeout(() => {
    lastScrollY = window.scrollY || 0;
    checkFormInput();
    sendUpdate();
  }, 2000);

  // ─── Command-K HUD Controller ────────────────────────────────────────────────────
  let hudContainer = null;
  let hudTabs = [];
  let filteredTabs = [];
  let selectedIndex = 0;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'toggleHUD') {
      toggleHUD();
    }
  });

  async function toggleHUD() {
    if (hudContainer) {
      closeHUD();
      return;
    }

    // Fetch suspended tabs
    try {
      hudTabs = await chrome.runtime.sendMessage({ action: 'getSuspendedTabs' }) || [];
    } catch (e) {
      hudTabs = [];
    }

    filteredTabs = [...hudTabs];
    selectedIndex = 0;

    // Create container and attach Shadow DOM
    hudContainer = document.createElement('div');
    hudContainer.id = 'tab-hibernator-hud-root';
    hudContainer.style.position = 'fixed';
    hudContainer.style.top = '0';
    hudContainer.style.left = '0';
    hudContainer.style.width = '100%';
    hudContainer.style.height = '100%';
    hudContainer.style.zIndex = '2147483647';
    hudContainer.style.pointerEvents = 'auto';

    const shadow = hudContainer.attachShadow({ mode: 'open' });

    // Inject styles and HTML
    shadow.innerHTML = `
      <style>
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        
        :host {
          --bg-color: rgba(15, 17, 23, 0.75);
          --border-color: rgba(255, 255, 255, 0.08);
          --text-primary: #e4e6ed;
          --text-secondary: #7a7f8d;
          --accent-color: #1D9E75;
          --accent-hover: #25c48f;
          --card-bg: rgba(24, 27, 35, 0.85);
        }

        .hud-overlay {
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          height: 100vh;
          background: rgba(10, 11, 15, 0.4);
          backdrop-filter: blur(16px) saturate(180%);
          -webkit-backdrop-filter: blur(16px) saturate(180%);
          display: flex;
          justify-content: center;
          align-items: flex-start;
          padding-top: 12vh;
        }

        .hud-modal {
          background: var(--card-bg);
          border: 1px solid var(--border-color);
          border-radius: 16px;
          width: 580px;
          max-width: 90%;
          box-shadow: 0 30px 60px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.05);
          overflow: hidden;
          display: flex;
          flex-direction: column;
          color: var(--text-primary);
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          animation: slideIn 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }

        @keyframes slideIn {
          from { transform: translateY(-20px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }

        .hud-header {
          display: flex;
          align-items: center;
          padding: 18px 24px;
          border-bottom: 1px solid var(--border-color);
          gap: 14px;
          position: relative;
        }

        .search-icon {
          width: 20px;
          height: 20px;
          color: var(--text-secondary);
          flex-shrink: 0;
        }

        .hud-search {
          flex-grow: 1;
          background: transparent;
          border: none;
          font-size: 16px;
          color: var(--text-primary);
          outline: none;
          font-family: inherit;
        }

        .esc-badge {
          font-size: 10px;
          padding: 4px 6px;
          background: rgba(255, 255, 255, 0.08);
          border-radius: 4px;
          color: var(--text-secondary);
          border: 1px solid var(--border-color);
          font-weight: 600;
          letter-spacing: 0.5px;
        }

        .hud-content {
          max-height: 380px;
          overflow-y: auto;
        }

        .hud-list {
          list-style: none;
        }

        .hud-item {
          padding: 14px 24px;
          display: flex;
          align-items: center;
          gap: 14px;
          cursor: pointer;
          border-bottom: 1px solid rgba(255, 255, 255, 0.02);
          transition: all 0.15s ease;
          user-select: none;
          border-left: 3px solid transparent;
        }

        .hud-item:last-child {
          border-bottom: none;
        }

        .hud-item.selected {
          background: rgba(29, 158, 117, 0.12);
          border-left-color: var(--accent-color);
        }

        .hud-item-icon {
          width: 24px;
          height: 24px;
          border-radius: 6px;
          background: rgba(255, 255, 255, 0.05);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          font-weight: bold;
          flex-shrink: 0;
          color: var(--text-secondary);
        }

        .hud-item-icon img {
          width: 100%;
          height: 100%;
          object-fit: contain;
          border-radius: 6px;
        }

        .hud-item-info {
          display: flex;
          flex-direction: column;
          gap: 4px;
          overflow: hidden;
          flex-grow: 1;
        }

        .hud-item-title {
          font-size: 14px;
          font-weight: 600;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .hud-item-url {
          font-size: 11px;
          color: var(--text-secondary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .hud-item-badge {
          font-size: 10px;
          color: var(--accent-hover);
          background: rgba(29, 158, 117, 0.1);
          padding: 3px 8px;
          border-radius: 12px;
          flex-shrink: 0;
          font-weight: 600;
        }

        .hud-item-badge.suspended {
          color: #a78bfa;
          background: rgba(139, 92, 246, 0.15);
        }

        .hud-item-badge.active {
          color: #34d399;
          background: rgba(52, 211, 153, 0.12);
        }

        .hud-empty {
          padding: 48px 24px;
          text-align: center;
        }

        .empty-icon {
          font-size: 32px;
          display: block;
          margin-bottom: 12px;
        }

        .empty-title {
          font-size: 16px;
          font-weight: 600;
          margin-bottom: 6px;
        }

        .empty-desc {
          font-size: 13px;
          color: var(--text-secondary);
        }
      </style>
      <div class="hud-overlay" id="hudOverlay">
        <div class="hud-modal" id="hudModal">
          <div class="hud-header">
            <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input type="text" class="hud-search" id="hudSearch" placeholder="Search tabs (active & suspended)..." autofocus autocomplete="off">
            <span class="esc-badge">ESC</span>
          </div>
          <div class="hud-content">
            <ul class="hud-list" id="hudList"></ul>
            <div class="hud-empty" id="hudEmpty" style="display: none;">
              <span class="empty-icon">🔍</span>
              <div class="empty-title">No tabs found</div>
              <div class="empty-desc">Try searching for a different keyword or domain.</div>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(hudContainer);

    // Setup HUD variables
    const hudSearch = shadow.getElementById('hudSearch');
    const hudOverlay = shadow.getElementById('hudOverlay');
    const hudList = shadow.getElementById('hudList');
    const hudEmpty = shadow.getElementById('hudEmpty');

    hudSearch.focus();

    // Render list initial load
    renderList(hudList, hudEmpty);

    // Click outside to close
    hudOverlay.addEventListener('click', (e) => {
      if (e.target === hudOverlay) {
        closeHUD();
      }
    });

    // Search events
    hudSearch.addEventListener('input', () => {
      const q = hudSearch.value.trim().toLowerCase();
      filteredTabs = hudTabs.filter(t => 
        (t.title || '').toLowerCase().includes(q) || 
        (t.url || '').toLowerCase().includes(q)
      );
      selectedIndex = 0;
      renderList(hudList, hudEmpty);
    });

    // Capture keyboard events
    document.addEventListener('keydown', onHUDKeyDown, true);
  }

  function escapeHTML(str) {
    return String(str).replace(/[&<>"']/g, function(m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }

  function renderList(hudList, hudEmpty) {
    hudList.innerHTML = '';
    
    if (filteredTabs.length === 0) {
      hudEmpty.style.display = 'block';
      return;
    }
    hudEmpty.style.display = 'none';

    filteredTabs.forEach((tab, index) => {
      const li = document.createElement('li');
      li.className = 'hud-item' + (index === selectedIndex ? ' selected' : '');
      
      const badgeText = tab.isSuspended 
        ? `💤 ${formatMinutesAgo(Date.now() - tab.suspendedAt)}`
        : 'Active';
      const badgeClass = tab.isSuspended ? 'hud-item-badge suspended' : 'hud-item-badge active';

      // Simple initials fallback
      const safeTitle = escapeHTML(tab.title || 'Untitled Tab');
      const safeUrl = escapeHTML(tab.url || '');
      const safeFavicon = escapeHTML(tab.favicon || '');
      const initial = (tab.title || 'U').charAt(0).toUpperCase();
      
      const iconHTML = safeFavicon
        ? `<img src="${safeFavicon}" alt="">`
        : escapeHTML(initial);

      li.innerHTML = `
        <div class="hud-item-icon">${iconHTML}</div>
        <div class="hud-item-info">
          <div class="hud-item-title">${safeTitle}</div>
          <div class="hud-item-url">${safeUrl}</div>
        </div>
        <div class="${badgeClass}">${badgeText}</div>
      `;

      // Wire the favicon error fallback in JS rather than via an inline
      // onerror so a stray quote/backslash in the title can't break the markup.
      const iconImg = li.querySelector('.hud-item-icon img');
      if (iconImg) {
        iconImg.addEventListener('error', () => {
          iconImg.replaceWith(document.createTextNode(initial));
        });
      }

      li.addEventListener('click', () => {
        wakeSelectedTab(tab.tabId);
      });

      hudList.appendChild(li);
    });
  }

  function onHUDKeyDown(e) {
    if (!hudContainer) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeHUD();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      if (filteredTabs.length > 0) {
        selectedIndex = (selectedIndex + 1) % filteredTabs.length;
        refreshSelection();
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      if (filteredTabs.length > 0) {
        selectedIndex = (selectedIndex - 1 + filteredTabs.length) % filteredTabs.length;
        refreshSelection();
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (filteredTabs.length > 0 && filteredTabs[selectedIndex]) {
        wakeSelectedTab(filteredTabs[selectedIndex].tabId);
      }
    }
  }

  function refreshSelection() {
    const shadow = hudContainer.shadowRoot;
    const items = shadow.querySelectorAll('.hud-item');
    items.forEach((item, index) => {
      if (index === selectedIndex) {
        item.classList.add('selected');
        item.scrollIntoView({ block: 'nearest' });
      } else {
        item.classList.remove('selected');
      }
    });
  }

  async function wakeSelectedTab(tabId) {
    closeHUD();
    chrome.runtime.sendMessage({ action: 'wakeAndFocusTab', tabId: tabId }).catch(() => {});
  }

  function closeHUD() {
    if (hudContainer) {
      hudContainer.remove();
      hudContainer = null;
      document.removeEventListener('keydown', onHUDKeyDown, true);
    }
  }

  function formatMinutesAgo(durationMs) {
    const mins = Math.floor(durationMs / 60000);
    if (mins < 1) return 'just now';
    if (mins === 1) return '1m ago';
    if (mins < 60) return mins + 'm ago';
    const hrs = Math.floor(mins / 60);
    if (hrs === 1) return '1h ago';
    if (hrs < 24) return hrs + 'h ago';
    return Math.floor(hrs / 24) + 'd ago';
  }
})();

