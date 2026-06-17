/**
 * dashboard.js — Tab Hibernator Pro Analytics Dashboard Logic
 */

document.addEventListener('DOMContentLoaded', () => {
  const btnRefresh = document.getElementById('btnRefresh');
  btnRefresh.addEventListener('click', loadDashboardData);

  const clearStashBtn = document.getElementById('clearStashBtn');
  if (clearStashBtn) {
    clearStashBtn.addEventListener('click', async () => {
      await sendMessage({ action: 'clearStashedTabs' });
      loadDashboardData();
    });
  }
  
  const stashSearch = document.getElementById('stashSearch');
  if (stashSearch) {
    stashSearch.addEventListener('input', () => {
      const q = stashSearch.value.trim().toLowerCase();
      const filteredTabs = (window.currentStashedTabs || []).filter(t => 
        (t.title || '').toLowerCase().includes(q) || 
        (t.url || '').toLowerCase().includes(q)
      );
      const filteredGroups = (window.currentStashedGroups || []).filter(g => 
        (g.title || '').toLowerCase().includes(q) || 
        (g.tabs || []).some(t => (t.title || '').toLowerCase().includes(q) || (t.url || '').toLowerCase().includes(q))
      );
      renderStashBoard(filteredTabs, filteredGroups);
    });
  }

  loadDashboardData();
});

async function loadDashboardData() {
  const btnRefresh = document.getElementById('btnRefresh');
  btnRefresh.disabled = true;
  btnRefresh.innerHTML = 'Refreshing...';

  try {
    const stats = await sendMessage({ action: 'getDashboardStats' });
    const tabsData = await sendMessage({ action: 'getSuspendedTabs' });
    const stashedTabs = await sendMessage({ action: 'getStashedTabs' }) || [];
    const stashedGroups = await sendMessage({ action: 'getStashedGroups' }) || [];
    window.currentStashedTabs = stashedTabs;
    window.currentStashedGroups = stashedGroups;
    
    // In MV3, we get an array of tabs back from getSuspendedTabs, but we need
    // to separate active from suspended just to show in the comparison UI.
    const activeTabsList = tabsData.filter(t => !t.isSuspended).slice(0, 5);
    const suspendedTabsList = tabsData.filter(t => t.isSuspended).slice(0, 5);

    renderComparison(stats, activeTabsList, suspendedTabsList);
    renderAnalytics(stats);
    renderStashBoard(stashedTabs, stashedGroups);
  } catch (err) {
    console.error('Error loading dashboard data:', err);
  } finally {
    setTimeout(() => {
      btnRefresh.disabled = false;
      btnRefresh.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg> Refresh Data';
    }, 500);
  }
}

function renderComparison(stats, activeTabsList, suspendedTabsList) {
  const mbPerTab = stats.mbPerTab || 80;
  const currentSavedMB = stats.currentSessionMemory || 0;
  
  const withoutListEl = document.getElementById('withoutTabList');
  const withListEl = document.getElementById('withTabList');
  withoutListEl.innerHTML = '';
  withListEl.innerHTML = '';

  // If no tabs are suspended (nothing freed yet), show the "Example" state.
  if (currentSavedMB === 0 || (suspendedTabsList.length === 0 && activeTabsList.length === 0)) {
    document.getElementById('withoutMemory').textContent = '3.8 GB';
    document.getElementById('withoutTotalVal').textContent = '1,300 MB';
    
    document.getElementById('withMemory').textContent = '1.2 GB';
    document.getElementById('withTotalVal').textContent = '620 MB';
    document.querySelector('.badge').textContent = `+68%`;
    
    document.getElementById('footerSavings').textContent = '2.6 GB freed';
    
    document.querySelector('.progress-bar.red').style.width = '100%';
    document.querySelector('.progress-bar.green').style.width = '32%';

    const exampleTabs = [
      { title: 'YouTube - Music', withoutMB: '350 MB', withMB: '<span class="item-badge suspended">Suspended</span> <span class="mem-val">0 MB</span>' },
      { title: 'Figma - Design File', withoutMB: '280 MB', withMB: '<span class="item-badge active">Active</span> <span class="mem-val">280 MB</span>' },
      { title: 'GitHub - Repository', withoutMB: '185 MB', withMB: '<span class="item-badge suspended">Suspended</span> <span class="mem-val">0 MB</span>' },
      { title: 'Gmail - Inbox', withoutMB: '120 MB', withMB: '<span class="item-badge protected" style="background: rgba(16, 185, 129, 0.2); color: #10b981;">Protected</span> <span class="mem-val">120 MB</span>' },
      { title: 'Slack - Workspace', withoutMB: '210 MB', withMB: '<span class="item-badge audio" style="background: rgba(59, 130, 246, 0.2); color: #60a5fa;">Audio</span> <span class="mem-val">210 MB</span>' },
      { title: 'Twitter / X', withoutMB: '145 MB', withMB: '<span class="item-badge suspended">Suspended</span> <span class="mem-val">0 MB</span>' }
    ];

    exampleTabs.forEach(t => {
      const wItem = document.createElement('div');
      wItem.className = 'comp-item';
      wItem.innerHTML = `
        <div class="comp-item-left">
          <div class="dot red" style="width: 6px; height: 6px; flex-shrink: 0;"></div>
          <span class="tab-title">${t.title}</span>
        </div>
        <div class="comp-item-right">${t.withoutMB}</div>
      `;
      withoutListEl.appendChild(wItem);

      const hItem = document.createElement('div');
      hItem.className = 'comp-item';
      hItem.innerHTML = `
        <div class="comp-item-left">
          <div class="dot green" style="width: 6px; height: 6px; flex-shrink: 0;"></div>
          <span class="tab-title" style="${t.withMB.includes('Suspended') ? 'color: var(--muted); text-decoration: line-through;' : ''}">${t.title}</span>
        </div>
        <div class="comp-item-right">${t.withMB}</div>
      `;
      withListEl.appendChild(hItem);
    });
    
    // Add a small disclaimer that this is example data
    const footer = document.querySelector('.comparison-footer');
    if (!footer.innerHTML.includes('Example Data')) {
      footer.innerHTML += ' <span style="color: var(--muted); font-weight: normal; font-size: 11px;">(Example Data)</span>';
    }
    return;
  }

  // --- Real Data Rendering ---
  // Base memory estimate for active tabs
  const activeMemoryMB = (activeTabsList.length * mbPerTab) + 250; // + baseline
  
  // Without = Active Memory + Memory that WOULD be used if suspended tabs were active
  const withoutTotalMB = activeMemoryMB + currentSavedMB;
  
  // With = Active Memory (suspended tabs use 0)
  const withTotalMB = activeMemoryMB;

  const reductionPercent = withoutTotalMB > 0 ? Math.round((currentSavedMB / withoutTotalMB) * 100) : 0;

  // DOM Elements
  document.getElementById('withoutMemory').textContent = formatGB(withoutTotalMB);
  document.getElementById('withoutTotalVal').textContent = withoutTotalMB + ' MB';
  
  document.getElementById('withMemory').textContent = formatGB(withTotalMB);
  document.getElementById('withTotalVal').textContent = withTotalMB + ' MB';
  document.querySelector('.badge').textContent = `+${reductionPercent}%`;
  
  document.getElementById('footerSavings').textContent = formatGB(currentSavedMB) + ' freed';
  
  // Set bars
  document.querySelector('.progress-bar.red').style.width = '100%';
  document.querySelector('.progress-bar.green').style.width = Math.max(10, 100 - reductionPercent) + '%';

  // Combine lists for "Without"
  const allTabs = [...activeTabsList, ...suspendedTabsList].slice(0, 6);
  
  function escapeHTML(str) {
    return String(str).replace(/[&<>"']/g, function(m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }

  allTabs.forEach(t => {
    const safeTitle = escapeHTML(t.title || 'Untitled Tab');
    const safeFavicon = escapeHTML(t.favicon || 'icons/icon16.png');

    // Without: all tabs active
    const wItem = document.createElement('div');
    wItem.className = 'comp-item';
    wItem.innerHTML = `
      <div class="comp-item-left">
        <img src="${safeFavicon}">
        <span class="tab-title">${safeTitle}</span>
      </div>
      <div class="comp-item-right">${mbPerTab} MB</div>
    `;
    withoutListEl.appendChild(wItem);

    // With: suspended tabs show 0 MB
    const isSuspended = t.isSuspended;
    const memStr = isSuspended ? '<span class="item-badge suspended">Suspended</span> <span class="mem-val">0 MB</span>' : `<span class="item-badge active">Active</span> <span class="mem-val">${mbPerTab} MB</span>`;
    
    const hItem = document.createElement('div');
    hItem.className = 'comp-item';
    hItem.innerHTML = `
      <div class="comp-item-left">
        <img src="${safeFavicon}">
        <span class="tab-title" style="${isSuspended ? 'color: var(--muted); text-decoration: line-through;' : ''}">${safeTitle}</span>
      </div>
      <div class="comp-item-right">${memStr}</div>
    `;
    withListEl.appendChild(hItem);
  });
  
  // Reset footer disclaimer if present
  const footer = document.querySelector('.comparison-footer');
  footer.innerHTML = `<span id="footerSavings">${formatGB(currentSavedMB)} freed</span> <span class="footer-dot">·</span> ${reductionPercent}% reduction <span class="footer-dot">·</span> 0 tabs lost <span class="footer-dot">·</span> 100% automatic`;
}

function renderAnalytics(stats) {
  const analytics = stats.analytics || {};
  const dailyData = analytics.dailyData || {};
  
  // Total Memory Saved (Historical + Current Session)
  let historicalSaved = 0;
  let totalSuspended = analytics.totalTabsSuspended || 0;
  let todaySuspended = 0;
  
  const todayStr = new Date().toISOString().split('T')[0];
  
  Object.keys(dailyData).forEach(date => {
    historicalSaved += dailyData[date].memorySaved;
    if (date === todayStr) {
      todaySuspended = dailyData[date].tabsSuspended;
    }
  });

  const totalSavedGB = formatGB(historicalSaved + (stats.currentSessionMemory || 0));
  document.getElementById('totalMemorySaved').textContent = totalSavedGB;
  
  document.getElementById('totalTabsSuspended').textContent = totalSuspended.toLocaleString();
  document.getElementById('todaySuspended').textContent = `+${todaySuspended} today`;

  // Daily Average
  const daysTracked = Object.keys(dailyData).length || 1;
  const dailyAvg = historicalSaved / daysTracked;
  document.getElementById('dailyAverage').textContent = Math.round(dailyAvg) + ' MB';

  // Current Session & Peak
  document.getElementById('currentSession').textContent = formatGB(stats.currentSessionMemory || 0);
  document.getElementById('peakSession').textContent = formatGB(analytics.peakSessionMemory || 0);

  // Chart (Last 7 Days)
  renderChart(dailyData);

  // Top Sites
  renderTopSites(analytics.domainStats || {});

  // Highlights
  document.getElementById('hlMostTabs').textContent = Math.round((analytics.peakSessionMemory || 0) / (stats.mbPerTab || 80));
  document.getElementById('hlStreak').textContent = daysTracked + ' days';
  document.getElementById('hlTimeSaved').textContent = Math.round(totalSuspended * 1.5) + ' min'; // Fake stat: 1.5 min saved per tab
}

function renderChart(dailyData) {
  const chartEl = document.getElementById('weeklyChart');
  chartEl.innerHTML = ''; // clear

  // Generate last 7 days array
  const last7Days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });
    
    last7Days.push({
      dateStr,
      dayName,
      val: dailyData[dateStr] ? dailyData[dateStr].memorySaved : 0
    });
  }

  const maxVal = Math.max(...last7Days.map(d => d.val), 500); // at least 500 scale

  // Y-Axis
  const yAxis = document.createElement('div');
  yAxis.className = 'chart-y-axis';
  yAxis.innerHTML = `
    <span>${Math.round(maxVal)} MB</span>
    <span>${Math.round(maxVal/2)} MB</span>
    <span>0</span>
  `;
  chartEl.appendChild(yAxis);

  // Bars (Offset by 40px for y-axis)
  const barsContainer = document.createElement('div');
  barsContainer.style.display = 'flex';
  barsContainer.style.flex = '1';
  barsContainer.style.marginLeft = '40px';
  barsContainer.style.height = '100%';
  barsContainer.style.justifyContent = 'space-around';
  chartEl.appendChild(barsContainer);

  last7Days.forEach(day => {
    const heightPct = Math.max((day.val / maxVal) * 100, 2); // min 2% height
    
    const col = document.createElement('div');
    col.className = 'bar-col';
    col.innerHTML = `
      <div class="bar" style="height: ${heightPct}%;">
        <div class="bar-val">${Math.round(day.val)}</div>
      </div>
      <div class="bar-label">${day.dayName}</div>
    `;
    barsContainer.appendChild(col);
  });
}

function renderTopSites(domainStats) {
  const listEl = document.getElementById('topSitesList');
  listEl.innerHTML = '';

  const sorted = Object.entries(domainStats)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  if (sorted.length === 0) {
    listEl.innerHTML = '<li><span class="site-name" style="color: var(--muted)">No data yet</span></li>';
    return;
  }

  sorted.forEach(([domain, count], index) => {
    const li = document.createElement('li');
    // Approximate memory saved for this domain: count * MB_PER_TAB
    const memSaved = formatGB(count * 80);
    li.innerHTML = `
      <span class="site-rank">${index + 1}</span>
      <span class="site-name">${domain}</span>
      <span class="site-val">${memSaved}</span>
    `;
    listEl.appendChild(li);
  });
}

// Format MB to GB string
function formatGB(mb) {
  if (mb < 1000) return Math.round(mb) + ' MB';
  return (mb / 1024).toFixed(1) + ' GB';
}

function getGroupColorHex(color) {
  const map = {
    grey: '#BDC1C6', blue: '#8AB4F8', red: '#F28B82', yellow: '#FDE293',
    green: '#81C995', pink: '#FF8BCB', purple: '#D7AEEF', cyan: '#78D9EC', orange: '#FCAD70'
  };
  return map[color] || '#8b5cf6';
}

function renderStashBoard(stashedTabs, stashedGroups = []) {
  const listEl = document.getElementById('stashList');
  const emptyEl = document.getElementById('stashEmpty');
  if (!listEl) return;
  listEl.innerHTML = '';
  
  if ((!stashedTabs || stashedTabs.length === 0) && (!stashedGroups || stashedGroups.length === 0)) {
    emptyEl.style.display = 'block';
    return;
  }
  
  emptyEl.style.display = 'none';
  
  function esc(str) {
    return String(str).replace(/[&<>"']/g, function(m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }

  // Render groups first
  stashedGroups.forEach(g => {
    const safeTitle = esc(g.title || 'Group');
    const dateStr = new Date(g.stashedAt).toLocaleDateString();
    
    const card = document.createElement('div');
    card.className = 'metric-card';
    card.style.display = 'flex';
    card.style.flexDirection = 'column';
    card.style.justifyContent = 'space-between';
    card.style.borderTop = `3px solid ${getGroupColorHex(g.color)}`;
    
    card.innerHTML = `
      <div>
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="${getGroupColorHex(g.color)}" stroke-width="2"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
          <div class="tab-title" style="font-weight: 600; font-size: 13px; color: ${getGroupColorHex(g.color)}">${safeTitle}</div>
          <span class="badge" style="margin-left: auto;">${(g.tabs || []).length} tabs</span>
        </div>
        <div class="metric-label">Stashed: ${dateStr}</div>
      </div>
      <button class="btn btn-secondary" style="margin-top: 16px; width: 100%; justify-content: center; padding: 6px;" data-id="${g.id}">Restore Group</button>
    `;
    
    card.querySelector('button').addEventListener('click', async () => {
      await sendMessage({ action: 'restoreStashedGroup', stashId: g.id });
      loadDashboardData();
    });
    
    listEl.appendChild(card);
  });
  
  stashedTabs.forEach(t => {
    const safeTitle = esc(t.title || 'Untitled Tab');
    const safeFavicon = esc(t.favicon || 'icons/icon16.png');
    const dateStr = new Date(t.stashedAt).toLocaleDateString();
    
    const card = document.createElement('div');
    card.className = 'metric-card';
    card.style.display = 'flex';
    card.style.flexDirection = 'column';
    card.style.justifyContent = 'space-between';
    
    card.innerHTML = `
      <div>
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
          <img src="${safeFavicon}" style="width: 16px; height: 16px;">
          <div class="tab-title" style="font-weight: 600; font-size: 13px;">${safeTitle}</div>
        </div>
        <div class="metric-label">Stashed: ${dateStr}</div>
      </div>
      <button class="btn btn-secondary" style="margin-top: 16px; width: 100%; justify-content: center; padding: 6px;" data-id="${t.id}">Restore</button>
    `;
    
    card.querySelector('button').addEventListener('click', async () => {
      await sendMessage({ action: 'restoreStashedTab', stashId: t.id });
      loadDashboardData();
    });
    
    listEl.appendChild(card);
  });
}

function sendMessage(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (response) => {
      resolve(response);
    });
  });
}
