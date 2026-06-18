export const CHECK_ALARM = 'hibernation-check';
export const CHECK_PERIOD_MINUTES = 1;

export const DEFAULT_SETTINGS = {
  enabled: true,
  inactivityMinutes: 30,
  batterySaverOnly: false,
  showBadge: true,
  whitelist: [],
  // Per-domain timeout overrides (minutes). Domain key without leading "www."
  // Maps to a positive integer that replaces the global inactivityMinutes.
  // Special value 0 means "never hibernate" (alternative to whitelist).
  domainTimeouts: {},
  restoreOnRestart: false,
  autoWakeOnFocus: false,
  smartMemoryEnabled: 'balanced',  // 'conservative' | 'balanced' | 'aggressive'
  // Privacy: tab screenshots are opt-in. When false, no page content is captured.
  snapshotsEnabled: false
};

export const MB_PER_TAB = 80;
