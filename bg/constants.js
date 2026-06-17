export const CHECK_ALARM = 'hibernation-check';
export const CHECK_PERIOD_MINUTES = 1;

export const DEFAULT_SETTINGS = {
  enabled: true,
  inactivityMinutes: 30,
  batterySaverOnly: false,
  showBadge: true,
  whitelist: [],
  restoreOnRestart: false,
  autoWakeOnFocus: false,
  smartMemoryEnabled: true,
  // Privacy: tab screenshots are opt-in. When false, no page content is captured.
  snapshotsEnabled: false
};

export const MB_PER_TAB = 80;
