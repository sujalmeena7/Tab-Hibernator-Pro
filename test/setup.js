import { vi } from 'vitest';

let store = {};

global.chrome = {
  storage: {
    local: {
      get: vi.fn(async (keys) => {
        if (keys === null) return { ...store };
        if (typeof keys === 'string') return { [keys]: store[keys] };
        if (Array.isArray(keys)) {
          const result = {};
          for (const k of keys) if (store[k] !== undefined) result[k] = store[k];
          return result;
        }
        if (typeof keys === 'object') {
          const result = {};
          for (const [k, defaultVal] of Object.entries(keys)) {
            result[k] = store[k] !== undefined ? store[k] : defaultVal;
          }
          return result;
        }
        return {};
      }),
      set: vi.fn(async (items) => {
        for (const [k, v] of Object.entries(items)) store[k] = v;
      }),
      remove: vi.fn(async (keys) => {
        const keysArr = Array.isArray(keys) ? keys : [keys];
        for (const k of keysArr) delete store[k];
      }),
      clear: vi.fn(async () => { store = {}; })
    }
  },
  alarms: {
    create: vi.fn(), get: vi.fn(), clear: vi.fn(),
    onAlarm: { addListener: vi.fn() }
  },
  tabs: {
    query: vi.fn(async () => []),
    get: vi.fn(), update: vi.fn(), remove: vi.fn(), create: vi.fn(),
    sendMessage: vi.fn(), captureVisibleTab: vi.fn(), group: vi.fn(),
    onUpdated: { addListener: vi.fn() },
    onActivated: { addListener: vi.fn() },
    onRemoved: { addListener: vi.fn() }
  },
  tabGroups: { TAB_GROUP_ID_NONE: -1, get: vi.fn(), update: vi.fn() },
  system: {
    memory: {
      getInfo: vi.fn(async () => ({ capacity: 16000000000, availableCapacity: 8000000000 }))
    }
  },
  runtime: {
    getURL: vi.fn((path) => `chrome-extension://mock-id/${path}`),
    onInstalled: { addListener: vi.fn() },
    onStartup: { addListener: vi.fn() },
    onMessage: { addListener: vi.fn() }
  },
  action: { setBadgeText: vi.fn(), setBadgeBackgroundColor: vi.fn() },
  commands: { onCommand: { addListener: vi.fn() } },
  scripting: { executeScript: vi.fn() }
};

global.__setMockStore = (newState) => { store = { ...newState }; };
