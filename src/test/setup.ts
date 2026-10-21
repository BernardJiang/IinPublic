/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
/**
 * Global test setup for Jest
 * Sets up mocks and test environment
 */

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.GUN_PEERS = 'http://localhost:8765/gun';

// docs/TODO.md §S2 — LEDGER_RETENTION_WINDOW/MESSAGE_RETENTION_WINDOW (web-ledger-service.ts,
// gun-message-store.ts) now fall back to a storage-budget-derived cap (thousands of slots)
// instead of a small flat constant when unset. web-ledger-service.test.ts/
// gun-message-store.test.ts intentionally drive a small, specific number of events/messages
// past the retention boundary to prove pruning fires — thousands would make those tests
// dramatically slower for no added coverage. Pinned back to the suite's own long-established
// values here, via the exact same env-override mechanism the real-browser
// 30-ledger-message-pruning-e2e spec already uses (see the IINPUBLIC_E2E_* doc comments in
// both services) — this only affects the test environment; an unset production build still
// gets the real derived cap.
process.env.IINPUBLIC_E2E_LEDGER_RETENTION_WINDOW = '500';
process.env.IINPUBLIC_E2E_MESSAGE_RETENTION_WINDOW = '200';

// Newer Node releases may expose a partial localStorage global unless they are
// given --localstorage-file. Tests need the complete browser Storage contract.
if (
  typeof global.localStorage === 'undefined' ||
  typeof global.localStorage.getItem !== 'function' ||
  typeof global.localStorage.setItem !== 'function' ||
  typeof global.localStorage.removeItem !== 'function' ||
  typeof global.localStorage.clear !== 'function'
) {
  let storage = {};
  Object.defineProperty(global, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key) => storage[key] ?? null,
      setItem: (key, value) => { storage[key] = String(value); },
      removeItem: (key) => { delete storage[key]; },
      clear: () => { storage = {}; },
    },
    writable: true,
  });
}

// Mock location services for testing
// Ensure global.navigator exists in Node.js test environment
if (!global.navigator) {
  global.navigator = {
    geolocation: {
      getCurrentPosition: jest.fn((success) => {
        success({
          coords: {
            latitude: 37.7749,
            longitude: -122.4194,
            accuracy: 10
          }
        });
      }),
      watchPosition: jest.fn()
    }
  };
}

// Mock window for browser environment tests
if (typeof window === 'undefined') {
  global.window = {
    location: { href: 'http://localhost:3001' },
    document: {
      getElementById: jest.fn(() => ({
        innerHTML: '',
        addEventListener: jest.fn()
      }))
    }
  };
}
