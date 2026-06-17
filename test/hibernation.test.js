import { describe, it, expect, beforeEach } from 'vitest';
import { canSuspendTab, wakeTab } from '../bg/hibernation.js';
import { DEFAULT_SETTINGS } from '../bg/constants.js';

describe('canSuspendTab', () => {
  beforeEach(() => { global.__setMockStore({}); });

  const baseTab = {
    id: 1,
    url: 'https://example.com',
    pinned: false,
    active: false,
    audible: false,
    status: 'complete'
  };

  it('should return false if extension is disabled', async () => {
    const result = await canSuspendTab(baseTab, { ...DEFAULT_SETTINGS, enabled: false });
    expect(result).toBe(false);
  });

  it('should return true for a normal inactive tab', async () => {
    global.__setMockStore({ 'tabdata-1': { createdAt: Date.now() - 10 * 60 * 1000 } });
    expect(await canSuspendTab(baseTab, { ...DEFAULT_SETTINGS, enabled: true })).toBe(true);
  });

  it('should return false if tab is pinned', async () => {
    global.__setMockStore({ 'tabdata-1': { createdAt: Date.now() - 10 * 60 * 1000 } });
    expect(await canSuspendTab({ ...baseTab, pinned: true }, DEFAULT_SETTINGS)).toBe(false);
  });

  it('should return false if tab is active', async () => {
    global.__setMockStore({ 'tabdata-1': { createdAt: Date.now() - 10 * 60 * 1000 } });
    expect(await canSuspendTab({ ...baseTab, active: true }, DEFAULT_SETTINGS)).toBe(false);
  });

  it('should return false if tab is playing audio', async () => {
    global.__setMockStore({ 'tabdata-1': { createdAt: Date.now() - 10 * 60 * 1000 } });
    expect(await canSuspendTab({ ...baseTab, audible: true }, DEFAULT_SETTINGS)).toBe(false);
  });

  it('should return false for chrome:// urls', async () => {
    global.__setMockStore({ 'tabdata-1': { createdAt: Date.now() - 10 * 60 * 1000 } });
    expect(await canSuspendTab({ ...baseTab, url: 'chrome://settings' }, DEFAULT_SETTINGS)).toBe(false);
  });

  it('should return false if domain is whitelisted', async () => {
    const tab = { ...baseTab, url: 'https://mail.google.com/mail' };
    global.__setMockStore({ 'tabdata-1': { createdAt: Date.now() - 10 * 60 * 1000 } });
    const settings = { ...DEFAULT_SETTINGS, whitelist: ['mail.google.com'] };
    expect(await canSuspendTab(tab, settings)).toBe(false);
  });

  it('should whitelist sub-domains of a whitelisted entry', async () => {
    const tab = { ...baseTab, url: 'https://gist.github.com/foo' };
    global.__setMockStore({ 'tabdata-1': { createdAt: Date.now() - 10 * 60 * 1000 } });
    const settings = { ...DEFAULT_SETTINGS, whitelist: ['github.com'] };
    expect(await canSuspendTab(tab, settings)).toBe(false);
  });

  it('should NOT whitelist look-alike domains via substring match', async () => {
    const tab = { ...baseTab, url: 'https://notgithub.com/foo' };
    global.__setMockStore({ 'tabdata-1': { createdAt: Date.now() - 10 * 60 * 1000 } });
    const settings = { ...DEFAULT_SETTINGS, whitelist: ['github.com'] };
    expect(await canSuspendTab(tab, settings)).toBe(true);
  });

  it('should NOT let a short whitelist entry match unrelated domains', async () => {
    const tab = { ...baseTab, url: 'https://example.com/foo' };
    global.__setMockStore({ 'tabdata-1': { createdAt: Date.now() - 10 * 60 * 1000 } });
    const settings = { ...DEFAULT_SETTINGS, whitelist: ['co'] };
    expect(await canSuspendTab(tab, settings)).toBe(true);
  });

  it('should return false if tab has unsubmitted form input', async () => {
    global.__setMockStore({
      'tabdata-1': { createdAt: Date.now() - 10 * 60 * 1000, hasFormInput: true }
    });
    expect(await canSuspendTab(baseTab, DEFAULT_SETTINGS)).toBe(false);
  });

  it('should respect batterySaverOnly setting', async () => {
    const settings = { ...DEFAULT_SETTINGS, batterySaverOnly: true };
    global.__setMockStore({
      deviceCharging: true,
      'tabdata-1': { createdAt: Date.now() - 10 * 60 * 1000 }
    });
    expect(await canSuspendTab(baseTab, settings)).toBe(false);

    global.__setMockStore({
      deviceCharging: false,
      'tabdata-1': { createdAt: Date.now() - 10 * 60 * 1000 }
    });
    expect(await canSuspendTab(baseTab, settings)).toBe(true);
  });
});

describe('wakeTab', () => {
  beforeEach(() => {
    global.__setMockStore({});
    chrome.tabs.update.mockClear();
  });

  it('should navigate using stored suspended info', async () => {
    global.__setMockStore({ 'suspended-1': { url: 'https://example.com', scrollY: 0 } });
    await wakeTab(1);
    expect(chrome.tabs.update).toHaveBeenCalledWith(1, { url: 'https://example.com' });
  });

  it('should fall back to the provided url when storage is missing (post-restart)', async () => {
    global.__setMockStore({});
    await wakeTab(99, 99, { url: 'https://restored.example.com' });
    expect(chrome.tabs.update).toHaveBeenCalledWith(99, { url: 'https://restored.example.com' });
  });

  it('should do nothing when neither storage nor fallback has a url', async () => {
    global.__setMockStore({});
    await wakeTab(5);
    expect(chrome.tabs.update).not.toHaveBeenCalled();
  });
});
