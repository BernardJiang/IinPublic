const { chromium } = require('playwright');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const { ensureTechSupportBootstrap } = require('./scripts/dev-techsupport-bootstrap');

// Mirror webpack.config.js dev TLS detection: with certs present the dev server
// serves https on 3001, so the readiness probe and page URLs must use https too.
const devKeyPath = process.env.TLS_KEY_PATH || path.resolve(__dirname, 'certs/dev-key.pem');
const devCertPath = process.env.TLS_CERT_PATH || path.resolve(__dirname, 'certs/dev-cert.pem');
const devTlsEnabled =
  process.env.DISABLE_HMR !== 'true' && fs.existsSync(devKeyPath) && fs.existsSync(devCertPath);
const APP_URL = `${devTlsEnabled ? 'https' : 'http'}://localhost:${process.env.PORT || 3001}`;
const API_BASE = process.env.DEV_MULTI_API_BASE || 'http://localhost:8080';
const SERVER_WAIT_MS = 60_000;
const USER_COUNT = Math.max(1, parseInt(process.env.DEV_MULTI_USERS || '3', 10) || 3);
const WINDOW_WIDTH = 620;
const WINDOW_HEIGHT = 900;
const WINDOW_GAP = 10;
const USER_DATA_ROOT = path.join(__dirname, 'user_data');
const RESET_PROFILES = process.env.DEV_MULTI_RESET_PROFILES === '1'
  || process.env.DEV_MULTI_RESET_PROFILES === 'true';

function waitForServer(url, timeoutMs) {
  const client = url.startsWith('https') ? https : http;
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    function retry() {
      if (Date.now() >= deadline) {
        reject(new Error(`Server not ready after ${timeoutMs}ms (${url})`));
      } else {
        setTimeout(poll, 500);
      }
    }
    function poll() {
      const req = client.get(url, { rejectUnauthorized: false }, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', retry);
      // Don't hang forever on a stalled connection (e.g. webpack mid-compile).
      req.setTimeout(5000, () => req.destroy(new Error('probe timeout')));
    }
    poll();
  });
}

(async () => {
  console.log(`🚀 Launching ${USER_COUNT} isolated browser instances...`);
  if (RESET_PROFILES) {
    fs.rmSync(USER_DATA_ROOT, { recursive: true, force: true });
    console.log('🧹 Removed dev:multi browser profiles for a clean three-user run.');
  }

  // Launch browsers first — before the server is ready — so windows open immediately.
  const contexts = await Promise.all(
    Array.from({ length: USER_COUNT }, (_, index) => {
      const userName = `user_${String.fromCharCode(97 + index)}`;
      const x = index * (WINDOW_WIDTH + WINDOW_GAP);
      return chromium.launchPersistentContext(path.join(USER_DATA_ROOT, userName), {
        headless: false,
        ignoreHTTPSErrors: true, // self-signed dev cert
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
  await ensureTechSupportBootstrap(API_BASE, {
    preferSnapshotImport: process.env.DEV_MULTI_BOOTSTRAP_IMPORT === '1',
    allowSnapshotImport: process.env.DEV_MULTI_BOOTSTRAP_IMPORT === '1',
  });
  console.log(`✅ Server ready with TechSupport bootstrap — navigating ${USER_COUNT} browsers.`);

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
