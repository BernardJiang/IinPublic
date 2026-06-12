/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
/**
 * Global test setup for Jest
 * Sets up mocks and test environment
 */

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.GUN_PEERS = 'http://localhost:8765/gun';

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
