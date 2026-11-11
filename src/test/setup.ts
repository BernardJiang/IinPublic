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

// OPEN-91 P1: the exchange log's in-memory view is module state, shared between tests in a file.
// Each test starts from an empty, unconnected view (tests seed the old localStorage blob, which
// the view imports on first read).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { resetExchangeViewForTests } = require('../web/services/exchange-view');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { resetCoreViewsForTests } = require('../web/services/core-views');
beforeEach(() => {
  resetExchangeViewForTests();
  resetCoreViewsForTests();
});

// supertest's `request(app)` binds `app.listen(0)` (every address, `::`) and then connects to
// 127.0.0.1:<port>. On macOS another process may hold 127.0.0.1 on that same port number — during
// test:all the e2e servers and browsers hold many — and the request reaches that process instead
// (404s and "socket hang up" in system-routes.test.ts). Bind 127.0.0.1 itself, where the OS only
// picks a port nobody holds there; that bind is asynchronous, so the port goes into the URL just
// before the request is sent. Node-environment suites only (jsdom suites cannot load supertest).
if (typeof window === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Test = require('supertest/lib/test');
  const serverAddress = Test.prototype.serverAddress;
  Test.prototype.serverAddress = function loopbackServerAddress(app, path) {
    if (app.address()) return serverAddress.call(this, app, path);
    this._server = app.listen(0, '127.0.0.1');
    this._loopbackPath = path;
    return `http://127.0.0.1:0${path}`;
  };
  const end = Test.prototype.end;
  Test.prototype.end = function loopbackEnd(fn) {
    const server = this._server;
    if (this._loopbackPath === undefined || !server) return end.call(this, fn);
    const send = () => {
      this.url = `http://127.0.0.1:${server.address().port}${this._loopbackPath}`;
      this._loopbackPath = undefined;
      return end.call(this, fn);
    };
    if (server.listening) return send();
    server.once('listening', send);
    server.once('error', (error) => fn?.(error));
    return this;
  };
}
