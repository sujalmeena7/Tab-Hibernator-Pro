import { describe, it, expect, beforeEach } from 'vitest';
import { getSettings } from '../bg/storage.js';
import { DEFAULT_SETTINGS } from '../bg/constants.js';

describe('getSettings', () => {
  beforeEach(() => { global.__setMockStore({}); });

  it('should return DEFAULT_SETTINGS if no settings exist', async () => {
    const settings = await getSettings();
    expect(settings).toEqual(DEFAULT_SETTINGS);
  });

  it('should merge existing settings with DEFAULT_SETTINGS for an upgrade path', async () => {
    global.__setMockStore({
      settings: { enabled: false, inactivityMinutes: 15, whitelist: ['example.com'] }
    });
    const settings = await getSettings();
    expect(settings.enabled).toBe(false);
    expect(settings.inactivityMinutes).toBe(15);
    expect(settings.whitelist).toEqual(['example.com']);
    expect(settings.smartMemoryEnabled).toBe(true);
    expect(settings.batterySaverOnly).toBe(false);
    expect(settings.snapshotsEnabled).toBe(false);
  });
});
