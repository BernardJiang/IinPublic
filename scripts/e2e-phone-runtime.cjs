// Preload (`node --require scripts/e2e-phone-runtime.cjs ...`) that makes desktop Node look like
// the Node runtime inside the Android app (nodejs-mobile, Node 18): there is no global WebCrypto
// (`globalThis.crypto`), only `require('crypto')`. Code that reaches for `crypto.subtle` without
// a fallback works on desktop and in every browser test, then fails on phones — the 2026-10-13
// "can't create a room" bug. The phone-path E2E suite (tests/e2e/phone-path/) starts its
// embedded nodes with this preload so that class of bug fails in CI instead of on a phone.
'use strict';

function hideGlobal(name) {
  try {
    delete globalThis[name];
  } catch {
    // fall through to the defineProperty below
  }
  if (typeof globalThis[name] !== 'undefined') {
    Object.defineProperty(globalThis, name, { value: undefined, configurable: true, writable: true });
  }
}

hideGlobal('crypto');

if (process.env.E2E_PHONE_RUNTIME_QUIET !== '1') {
  // eslint-disable-next-line no-console
  console.log(`[e2e-phone-runtime] globalThis.crypto hidden (typeof crypto = ${typeof globalThis.crypto})`);
}
