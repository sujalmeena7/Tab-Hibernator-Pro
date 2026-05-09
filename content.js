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

  function checkFormInput() {
    const el = document.activeElement;
    if (!el) { updateFormInput(false); return; }
    const tag = el.tagName.toLowerCase();
    const isInput = (tag === 'input' && !['checkbox','radio','submit','button','hidden','reset','image'].includes(el.type))
      || tag === 'textarea' || tag === 'select' || el.isContentEditable;
    updateFormInput(isInput);
  }

  function updateFormInput(value) {
    if (hasFormInput !== value) { hasFormInput = value; sendUpdate(); }
  }

  document.addEventListener('focusin', checkFormInput, { passive: true });
  document.addEventListener('focusout', () => {
    setTimeout(checkFormInput, 100);
  }, { passive: true });

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
})();
