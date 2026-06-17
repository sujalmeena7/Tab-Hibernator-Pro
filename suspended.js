/**
 * suspended.js — Handles the suspended tab page
 * Reads URL params to display original tab info and restores when the user
 * clicks "Wake this tab" or presses Enter / Space.
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
    // Bypasses local file favicon restrictions using standard _favicon API
    const displayFavicon = url ? 'chrome-extension://' + chrome.runtime.id + '/_favicon/?pageUrl=' + encodeURIComponent(url) + '&size=32' : favicon;
    img.src = displayFavicon;
    img.alt = '';
    img.onerror = function () {
      this.replaceWith(createFallback(title));
    };
    iconWrap.appendChild(img);
  } else {
    iconWrap.appendChild(createFallback(title));
  }

  /**
   * Apply a premium neon fallback gradient when brand color extraction is
   * skipped or fails — uses a teal/violet default palette.
   */
  function applyFallbackGradient() {
    document.documentElement.style.setProperty('--mesh-color-1', '29, 158, 117');   // teal
    document.documentElement.style.setProperty('--mesh-color-2', '139, 92, 246');   // violet
    document.body.classList.add('mesh-bg');
  }

  // Fetch snapshot first, fallback to dominant brand colors
  chrome.storage.local.get(`snapshot-${tabId}`, (data) => {
    const snapshotUrl = data[`snapshot-${tabId}`];
    if (snapshotUrl) {
      document.body.classList.add('snapshot-bg');
      document.body.style.backgroundImage = `url(${snapshotUrl})`;
      document.getElementById('snapshotOverlay').style.display = 'block';
    } else if (url) {
      const meshImg = new Image();
      meshImg.crossOrigin = 'anonymous';
      meshImg.src = 'chrome-extension://' + chrome.runtime.id + '/_favicon/?pageUrl=' + encodeURIComponent(url) + '&size=32';
      meshImg.onload = function () {
        try {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          canvas.width = 16;
          canvas.height = 16;
          ctx.drawImage(meshImg, 0, 0, 16, 16);
          const data = ctx.getImageData(0, 0, 16, 16).data;
          
          const colors = [];
          for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i+1];
            const b = data[i+2];
            const a = data[i+3];
            
            if (a < 150) continue; // Skip transparency
            const brightness = (r * 299 + g * 587 + b * 114) / 1000;
            if (brightness < 30 || brightness > 225) continue; // Skip too dark or too light (grays/white)
            
            colors.push({ r, g, b });
          }
          
          if (colors.length > 0) {
            // Saturation-based scoring to select colorful accents over dull grays
            colors.forEach(c => {
              const max = Math.max(c.r, c.g, c.b);
              const min = Math.min(c.r, c.g, c.b);
              c.sat = max === 0 ? 0 : (max - min) / max;
            });
            
            colors.sort((a, b) => b.sat - a.sat);
            
            const primary = colors[0];
            // Find a distinct second color
            let secondary = colors.find(c => {
              const dist = Math.sqrt(
                Math.pow(c.r - primary.r, 2) +
                Math.pow(c.g - primary.g, 2) +
                Math.pow(c.b - primary.b, 2)
              );
              return dist > 70;
            });
            
            if (!secondary) {
              secondary = {
                r: Math.max(0, 255 - primary.r),
                g: Math.max(0, 255 - primary.g),
                b: Math.max(0, 255 - primary.b)
              };
            }
            
            // Apply colors to CSS custom properties
            document.documentElement.style.setProperty('--mesh-color-1', `${primary.r}, ${primary.g}, ${primary.b}`);
            document.documentElement.style.setProperty('--mesh-color-2', `${secondary.r}, ${secondary.g}, ${secondary.b}`);
            document.body.classList.add('mesh-bg');
          } else {
            // No usable colors extracted — apply premium teal/violet fallback
            applyFallbackGradient();
          }
        } catch (e) {
          // Canvas failed — apply premium teal/violet fallback
          applyFallbackGradient();
        }
      };
      meshImg.onerror = function () {
        // Favicon load failed — apply premium teal/violet fallback
        applyFallbackGradient();
      };
    } else {
      // No URL available — apply premium teal/violet fallback
      applyFallbackGradient();
    }
  });

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

  // Wake button — the intentional, deliberate way to restore the tab
  document.getElementById('wakeBtn').addEventListener('click', () => {
    if (!isNaN(tabId)) {
      // Pass the original url so the background can still wake the tab even if
      // its id-keyed storage was cleared (e.g. after a browser restart).
      chrome.runtime.sendMessage({ action: 'wakeTab', tabId: tabId, url: url });
    } else if (url) {
      // Fallback: navigate directly if no valid tabId
      window.location.href = url;
    }
  });

  // Keyboard shortcut: Enter or Space also triggers wake
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      document.getElementById('wakeBtn').click();
    }
  });
})();

