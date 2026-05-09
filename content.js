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

  /**
   * Smart form detection: only block hibernation for inputs that actually
   * contain user-typed content. Search bars and empty fields are ignored.
   */
  function checkFormInput() {
    const el = document.activeElement;
    if (!el) { updateFormInput(false); return; }
    const tag = el.tagName.toLowerCase();

    // ContentEditable elements (rich text editors, Gmail compose, etc.)
    if (el.isContentEditable) {
      const hasContent = (el.innerText || '').trim().length > 0;
      updateFormInput(hasContent);
      return;
    }

    // Textareas — only block if they have typed content
    if (tag === 'textarea') {
      updateFormInput((el.value || '').trim().length > 0);
      return;
    }

    // Input fields — filter out non-text types and search bars
    if (tag === 'input') {
      const type = (el.type || 'text').toLowerCase();
      const ignoredTypes = ['checkbox','radio','submit','button','hidden','reset','image','search','range','color','file'];
      if (ignoredTypes.includes(type)) {
        updateFormInput(false);
        return;
      }
      // Only block if the field actually has content typed in it
      updateFormInput((el.value || '').trim().length > 0);
      return;
    }

    // Select dropdowns — never block (user can re-select easily)
    updateFormInput(false);
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
