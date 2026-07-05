const { chromium } = require('playwright');
const http = require('http');
const path = require('path');

const APP_URL = `http://localhost:${process.env.PORT || 3001}`;
const SERVER_WAIT_MS = 60_000;
const USER_COUNT = Math.max(1, parseInt(process.env.DEV_MULTI_USERS || '3', 10) || 3);
const WINDOW_WIDTH = 620;
const WINDOW_HEIGHT = 900;
const WINDOW_GAP = 10;

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
  console.log(`🚀 Launching ${USER_COUNT} isolated browser instances...`);

  // Launch browsers first — before the server is ready — so windows open immediately.
  const contexts = await Promise.all(
    Array.from({ length: USER_COUNT }, (_, index) => {
      const userName = `user_${String.fromCharCode(97 + index)}`;
      const x = index * (WINDOW_WIDTH + WINDOW_GAP);
      return chromium.launchPersistentContext(path.join(__dirname, 'user_data', userName), {
        headless: false,
        viewport: { width: WINDOW_WIDTH, height: WINDOW_HEIGHT },
        args: [
          `--window-position=${x},0`,
          `--window-size=${WINDOW_WIDTH},${WINDOW_HEIGHT}`,
          '--force-device-scale-factor=1',
        ],
      });
    }),
  );

  const closeAll = async () => {
    await Promise.allSettled(contexts.map((context) => context.close()));
  };
  process.once('SIGINT', async () => {
    await closeAll();
    process.exit(130);
  });
  process.once('SIGTERM', async () => {
    await closeAll();
    process.exit(143);
  });

  console.log(`⏳ Waiting for dev server at ${APP_URL}...`);
  await waitForServer(APP_URL, SERVER_WAIT_MS);
  console.log(`✅ Server ready — navigating ${USER_COUNT} browsers.`);

  await Promise.all(
    contexts.map(async (context) => {
      const page = context.pages()[0] || await context.newPage();
      return page.goto(APP_URL);
    }),
  );

  console.log(`✅ Users ${Array.from({ length: USER_COUNT }, (_, i) => String.fromCharCode(65 + i)).join(', ')} are live and isolated.`);

  // Keep the Node process alive so the browsers stay open
  await new Promise(() => {});
})().catch((err) => {
  console.error('❌ launch-browsers error:', err.message);
  process.exit(1);
});
