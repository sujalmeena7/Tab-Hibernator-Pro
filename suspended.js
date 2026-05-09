/**
 * suspended.js — Handles the suspended tab page
 * Reads URL params to display original tab info and restores on click.
 */
(function () {
  'use strict';

  const params = new URLSearchParams(window.location.search);
  const tabId = parseInt(params.get('tabId'), 10);
  const title = params.get('title') || 'Untitled';
  const url = params.get('url') || '';
  const favicon = params.get('favicon') || '';
  const suspendedAt = parseInt(params.get('suspendedAt'), 10) || Date.now();

  // Set page title
  document.title = '💤 ' + title;

  // Display title
  document.getElementById('pageTitle').textContent = title;

  // Display URL
  document.getElementById('pageUrl').textContent = url;

  // Display favicon or fallback
  const iconWrap = document.getElementById('iconWrap');
  if (favicon) {
    const img = document.createElement('img');
    img.src = favicon;
    img.alt = '';
    img.onerror = function () {
      this.replaceWith(createFallback(title));
    };
    iconWrap.appendChild(img);
  } else {
    iconWrap.appendChild(createFallback(title));
  }

  function createFallback(t) {
    const div = document.createElement('div');
    div.className = 'fallback-icon';
    div.textContent = t.charAt(0).toUpperCase();
    return div;
  }

  // Time ago updater
  function updateTimeAgo() {
    const mins = Math.floor((Date.now() - suspendedAt) / 60000);
    const el = document.getElementById('timeAgo');
    let text;
    if (mins < 1) text = 'Hibernated just now';
    else if (mins === 1) text = 'Hibernated 1 minute ago';
    else if (mins < 60) text = 'Hibernated ' + mins + ' minutes ago';
    else {
      const hrs = Math.floor(mins / 60);
      text = hrs === 1 ? 'Hibernated 1 hour ago' : 'Hibernated ' + hrs + ' hours ago';
    }
    el.innerHTML = '<span class="dot"></span>' + text;
  }

  updateTimeAgo();
  setInterval(updateTimeAgo, 60000);

  // Wake button
  document.getElementById('wakeBtn').addEventListener('click', () => {
    if (!isNaN(tabId)) {
      chrome.runtime.sendMessage({ action: 'wakeTab', tabId: tabId });
    } else if (url) {
      // Fallback: navigate directly
      window.location.href = url;
    }
  });

  // Also wake on clicking anywhere on the page (except the button handles itself)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      document.getElementById('wakeBtn').click();
    }
  });
})();
