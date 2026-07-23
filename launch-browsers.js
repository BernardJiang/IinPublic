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
const API_BASE = process.env.DEV_MULTI_API_BASE
  || `${devTlsEnabled ? 'https' : 'http'}://localhost:8080`;
const SERVER_WAIT_MS = 60_000;
const USER_COUNT = Math.max(1, parseInt(process.env.DEV_MULTI_USERS || '3', 10) || 3);
// Distinct stage names per browser window so the users are tellable apart.
// Overridable via DEV_MULTI_NAMES="Adam,Bob,Carol". Beyond the list we fall back to "User N".
const USER_NAMES = (process.env.DEV_MULTI_NAMES || 'Adam,Bob,Carol,Dave,Erin,Frank')
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean);
const nameForIndex = (index) => USER_NAMES[index] || `User ${index + 1}`;
// Launch one extra window logged in as the TechSupport root so a human can answer
// other users as TechSupport. On by default; disable with DEV_MULTI_TECHSUPPORT=0.
const LAUNCH_TECHSUPPORT = process.env.DEV_MULTI_TECHSUPPORT !== '0'
  && process.env.DEV_MULTI_TECHSUPPORT !== 'false';
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

// Module-scoped so the top-level error handler can also close the windows —
// otherwise a crash after launch (e.g. server-not-ready) orphaned the windows,
// leaving stale extra browsers open on the next run.
let contexts = [];

(async () => {
  // One window spec per browser: the TechSupport driver (optional) first, then the users.
  const specs = [];
  if (LAUNCH_TECHSUPPORT) {
    specs.push({ profile: 'techsupport', label: 'techsupport', stageName: 'TechSupport', query: '?devRole=techsupport' });
  }
  for (let i = 0; i < USER_COUNT; i += 1) {
    const stageName = nameForIndex(i);
    specs.push({
      profile: `user_${String.fromCharCode(97 + i)}`,
      label: `user_${String.fromCharCode(97 + i)}`,
      stageName,
      query: `?devUser=${encodeURIComponent(stageName)}`,
    });
  }

  console.log(`🚀 Launching ${specs.length} isolated browser instances (${specs.map((s) => s.stageName).join(', ')})...`);
  if (RESET_PROFILES) {
    fs.rmSync(USER_DATA_ROOT, { recursive: true, force: true });
    console.log('🧹 Removed dev:multi browser profiles for a clean run.');
  }

  // Launch browsers first — before the server is ready — so windows open immediately.
  contexts = await Promise.all(
    specs.map((spec, index) => {
      const x = index * (WINDOW_WIDTH + WINDOW_GAP);
      return chromium.launchPersistentContext(path.join(USER_DATA_ROOT, spec.profile), {
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
  console.log(`✅ Server ready with TechSupport bootstrap — navigating ${specs.length} browsers.`);

  await Promise.all(
    contexts.map(async (context, index) => {
      const spec = specs[index];
      const page = context.pages()[0] || await context.newPage();
      page.on('pageerror', (err) => console.log(`[${spec.label}] pageerror: ${err.message}`));
      page.on('console', (msg) => {
        if (msg.type() === 'error') console.log(`[${spec.label}] console.error: ${msg.text()}`);
      });
      const url = `${APP_URL}/${spec.query}`;
      try {
        const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        console.log(`[${spec.label}] goto -> name="${spec.stageName}" url=${page.url()} status=${resp ? resp.status() : 'null'}`);
      } catch (err) {
        console.log(`[${spec.label}] goto FAILED: ${err.message}`);
      }
    }),
  );

  console.log(`✅ Live and isolated: ${specs.map((s) => s.stageName).join(', ')}.`);

  // Keep the Node process alive so the browsers stay open
  await new Promise(() => {});
})().catch(async (err) => {
  console.error('❌ launch-browsers error:', err.message);
  // Close any windows we already opened so a crash doesn't orphan browsers.
  await Promise.allSettled(contexts.map((context) => context.close()));
  process.exit(1);
});
