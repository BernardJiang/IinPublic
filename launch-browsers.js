const { chromium } = require('playwright');
const http = require('http');
const path = require('path');

const APP_URL = `http://localhost:${process.env.PORT || 3001}`;
const SERVER_WAIT_MS = 60_000;

function waitForServer(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    function poll() {
      http.get(url, (res) => {
        res.resume();
        resolve();
      }).on('error', () => {
        if (Date.now() >= deadline) {
          reject(new Error(`Server not ready after ${timeoutMs}ms`));
        } else {
          setTimeout(poll, 500);
        }
      });
    }
    poll();
  });
}

(async () => {
  console.log('🚀 Launching isolated browser instances...');

  // Launch both browsers first — before the server is ready — so both windows open immediately
  const [contextA, contextB] = await Promise.all([
    chromium.launchPersistentContext(path.join(__dirname, 'user_data/user_a'), {
      headless: false,
      viewport: { width: 780, height: 900 },
      args: ['--window-position=0,0', '--window-size=780,900', '--force-device-scale-factor=1'],
    }),
    chromium.launchPersistentContext(path.join(__dirname, 'user_data/user_b'), {
      headless: false,
      viewport: { width: 780, height: 900 },
      args: ['--window-position=790,0', '--window-size=780,900', '--force-device-scale-factor=1'],
    }),
  ]);

  console.log(`⏳ Waiting for dev server at ${APP_URL}...`);
  await waitForServer(APP_URL, SERVER_WAIT_MS);
  console.log('✅ Server ready — navigating both browsers.');

  const pageA = contextA.pages()[0];
  const pageB = contextB.pages()[0];
  await Promise.all([
    pageA.goto(APP_URL),
    pageB.goto(APP_URL),
  ]);

  console.log('✅ User A and User B are live and isolated.');

  // Keep the Node process alive so the browsers stay open
  await new Promise(() => {});
})().catch((err) => {
  console.error('❌ launch-browsers error:', err.message);
  process.exit(1);
});
