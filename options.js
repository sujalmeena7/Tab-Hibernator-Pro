/**
 * options.js — Tab Hibernator Pro Settings (minimal)
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  // Inputs
  const timeoutSlider    = $('timeoutSlider');
  const timeoutValue     = $('timeoutValue');
  const timeoutUnit      = $('timeoutUnit');
  const batterySaver     = $('batterySaver');
  const showBadge        = $('showBadge');
  const restoreOnRestart = $('restoreOnRestart');
  const autoWakeOnFocus  = $('autoWakeOnFocus');
  const smartMemory      = $('smartMemoryEnabled');
  const snapshots        = $('snapshotsEnabled');
  const whitelist        = $('whitelist');
  const saveBtn          = $('saveBtn');
  const saveMsg          = $('saveMsg');
  const saveText         = $('saveText');
  const saveBar          = $('saveBar');
  const domainCount      = $('domainCount');
  const resetBtn         = $('resetBtn');

  // ── Helpers ─────────────────────────────────────────
  function formatTime(mins) {
    if (mins < 60) return { num: mins, unit: 'min' };
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (m === 0) return { num: h, unit: h === 1 ? 'hour' : 'hours' };
    return { num: h + 'h ' + m + 'm', unit: '' };
  }

  function fillFromSlider() {
    const min = +timeoutSlider.min, max = +timeoutSlider.max;
    const pct = ((+timeoutSlider.value - min) / (max - min)) * 100;
    timeoutSlider.style.setProperty('--fill', pct + '%');
  }

  function updateSliderReadout() {
    const t = formatTime(+timeoutSlider.value);
    timeoutValue.textContent = t.num;
    timeoutUnit.textContent  = t.unit;
    fillFromSlider();
    document.querySelectorAll('.chip').forEach(c => {
      c.classList.toggle('active', +c.dataset.min === +timeoutSlider.value);
    });
  }

  function updateDomainCount() {
    const n = whitelist.value.split('\n').map(s => s.trim()).filter(Boolean).length;
    domainCount.textContent = n + (n === 1 ? ' domain' : ' domains');
  }

  function sendMessage(msg) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(msg, (response) => resolve(response));
    });
  }

  // ── Settings state ──────────────────────────────────
  function currentSettings() {
    const domains = whitelist.value.split('\n').map(d => d.trim().toLowerCase()).filter(Boolean);
    return {
      inactivityMinutes: parseInt(timeoutSlider.value, 10),
      batterySaverOnly: batterySaver.checked,
      showBadge: showBadge.checked,
      whitelist: domains,
      restoreOnRestart: restoreOnRestart.checked,
      autoWakeOnFocus: autoWakeOnFocus.checked,
      smartMemoryEnabled: smartMemory.checked,
      snapshotsEnabled: snapshots.checked
    };
  }

  let lastSavedJson = '';
  let initialJson   = '';

  function isDirty() {
    return JSON.stringify(currentSettings()) !== lastSavedJson && lastSavedJson !== '';
  }

  function showSaveBar() { if (isDirty()) saveBar.classList.add('visible'); }
  function hideSaveBar() { saveBar.classList.remove('visible'); }

  function markDirty() {
    const json = JSON.stringify(currentSettings());
    if (json === initialJson) hideSaveBar();
    else showSaveBar();
  }

  async function performSave(showFeedback = true) {
    const current = await sendMessage({ action: 'getSettings' });
    const settings = currentSettings();
    if (current) settings.enabled = current.enabled;
    await sendMessage({ action: 'saveSettings', settings });

    lastSavedJson = JSON.stringify(currentSettings());
    initialJson   = lastSavedJson;
    hideSaveBar();

    if (showFeedback) {
      saveMsg.classList.add('show');
      saveText.textContent = 'Saved';
      clearTimeout(performSave._t);
      performSave._t = setTimeout(() => saveMsg.classList.remove('show'), 1800);
    }
  }

  // ── Wire up ─────────────────────────────────────────
  timeoutSlider.addEventListener('input', () => { updateSliderReadout(); markDirty(); });

  [batterySaver, showBadge, restoreOnRestart, autoWakeOnFocus, smartMemory, snapshots].forEach(el => {
    el.addEventListener('change', markDirty);
  });

  whitelist.addEventListener('input', () => { updateDomainCount(); markDirty(); });

  document.querySelectorAll('.chip').forEach(c => {
    c.addEventListener('click', () => {
      timeoutSlider.value = c.dataset.min;
      updateSliderReadout();
      markDirty();
    });
  });

  saveBtn.addEventListener('click', () => performSave(true));

  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      performSave(true);
    }
  });

  resetBtn.addEventListener('click', async () => {
    if (!confirm('Reset all settings to defaults?')) return;
    const defaults = {
      enabled: true,
      inactivityMinutes: 30,
      batterySaverOnly: false,
      showBadge: true,
      whitelist: [],
      restoreOnRestart: false,
      autoWakeOnFocus: false,
      smartMemoryEnabled: true,
      snapshotsEnabled: false
    };
    const current = await sendMessage({ action: 'getSettings' });
    if (current) defaults.enabled = current.enabled;
    await sendMessage({ action: 'saveSettings', settings: defaults });
    applySettings(defaults);
    lastSavedJson = JSON.stringify(currentSettings());
    initialJson   = lastSavedJson;
    hideSaveBar();
    saveMsg.classList.add('show');
    saveText.textContent = 'Reset to defaults';
    setTimeout(() => saveMsg.classList.remove('show'), 1800);
  });

  // ── Tabs (section switcher) ─────────────────────────
  const tabs  = document.querySelectorAll('.tab');
  const views = document.querySelectorAll('.view');

  function setView(name) {
    tabs.forEach(t => t.classList.toggle('active', t.dataset.section === name));
    views.forEach(v => v.classList.toggle('active', v.dataset.section === name));
    history.replaceState(null, '', '#' + name);
  }

  tabs.forEach(t => t.addEventListener('click', () => setView(t.dataset.section)));

  // ── Feature request form ───────────────────────────
  const featureForm   = $('featureForm');
  const featureSubmit = $('featureSubmit');

  if (featureForm) {
    featureForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const original = featureSubmit.innerHTML;
      featureSubmit.disabled = true;
      featureSubmit.innerHTML = '<span>Sending…</span>';

      try {
        const res = await fetch(featureForm.action, {
          method: 'POST',
          headers: { 'Accept': 'application/json' },
          body: new FormData(featureForm)
        });

        if (res.ok) {
          featureForm.reset();
          featureSubmit.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><polyline points="20 6 9 17 4 12"/></svg>
            <span>Sent — thanks!</span>`;
          featureSubmit.style.background = '#15936b';
          featureSubmit.style.borderColor = '#15936b';
          featureSubmit.style.boxShadow = '0 1px 2px rgba(21, 147, 107, 0.25)';
          setTimeout(() => {
            featureSubmit.innerHTML = original;
            featureSubmit.disabled = false;
            featureSubmit.style.background = '';
            featureSubmit.style.borderColor = '';
            featureSubmit.style.boxShadow = '';
          }, 2400);
        } else {
          throw new Error('Submission failed');
        }
      } catch (err) {
        featureSubmit.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <span>Couldn't send</span>`;
        setTimeout(() => {
          featureSubmit.innerHTML = original;
          featureSubmit.disabled = false;
        }, 2400);
      }
    });
  }

  // ── Apply / load ────────────────────────────────────
  function applySettings(s) {
    timeoutSlider.value     = s.inactivityMinutes || 30;
    batterySaver.checked    = s.batterySaverOnly || false;
    showBadge.checked       = s.showBadge !== false;
    restoreOnRestart.checked= s.restoreOnRestart || false;
    autoWakeOnFocus.checked = s.autoWakeOnFocus || false;
    smartMemory.checked     = s.smartMemoryEnabled !== false;
    snapshots.checked       = s.snapshotsEnabled === true;
    whitelist.value         = (s.whitelist || []).join('\n');

    updateSliderReadout();
    updateDomainCount();
  }

  // ── Init ────────────────────────────────────────────
  fillFromSlider();
  updateDomainCount();
  loadSettings();

  async function loadSettings() {
    const settings = await sendMessage({ action: 'getSettings' });
    if (settings) {
      applySettings(settings);
      lastSavedJson = JSON.stringify(currentSettings());
      initialJson   = lastSavedJson;
    }
  }

  const initialHash = (location.hash || '#general').slice(1);
  if (document.getElementById('view-' + initialHash)) setView(initialHash);
})();
