const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const DIST_TECHSUPPORT_MODULE = path.join(ROOT, 'dist', 'server', 'shared', 'techsupport.js');

// Mirror webpack.config.js / launch-browsers.js dev TLS detection.
const devKeyPath = process.env.TLS_KEY_PATH || path.resolve(ROOT, 'certs/dev-key.pem');
const devCertPath = process.env.TLS_CERT_PATH || path.resolve(ROOT, 'certs/dev-cert.pem');
const devTlsEnabled =
  process.env.DISABLE_HMR !== 'true' && fs.existsSync(devKeyPath) && fs.existsSync(devCertPath);
const APP_URL = `${devTlsEnabled ? 'https' : 'http'}://localhost:${process.env.PORT || 3001}`;
const SERVER_WAIT_MS = 60_000;
const USER_DATA_DIR = path.join(ROOT, 'user_data', 'techsupport-operator');

/**
 * K3 (docs/TODO.md): `npm run dev:techsupport` — boots the *normal* web client in TechSupport
 * mode against an already-running relay (`npm run dev` / `dev:multi` in another terminal). This
 * is deliberately NOT a special client: it is the same app, the same transports, just
 * authenticated with the canonical TechSupport DM keypair instead of a freshly generated device
 * pair, so every message it sends verifies for real receivers (K2/K6 signature checks).
 *
 * The private key never touches the web bundle or the relay. It is read from disk by this Node
 * process and injected into the fresh browser context's localStorage via Playwright
 * `addInitScript`, before the page (and therefore the app's boot code) ever runs — the same
 * "disk → Node → browser" channel `launch-browsers.js` already uses for dev:multi profiles.
 */
function requireCompiledTechSupport() {
  try {
    return require(DIST_TECHSUPPORT_MODULE);
  } catch (err) {
    console.log('[dev-techsupport-login] dist/server/shared missing — running `npm run build:server` once...');
    execFileSync('npm', ['run', 'build:server'], { stdio: 'inherit', cwd: ROOT });
    return require(DIST_TECHSUPPORT_MODULE);
  }
}

function loadPair(techsupport) {
  let pair;
  const keyFilePath = process.env.TECHSUPPORT_KEY_FILE;
  if (keyFilePath) {
    pair = JSON.parse(fs.readFileSync(keyFilePath, 'utf8'));
  } else if (process.env.TECHSUPPORT_SEA_PAIR_JSON) {
    pair = JSON.parse(process.env.TECHSUPPORT_SEA_PAIR_JSON);
  } else {
    throw new Error(
      'Set TECHSUPPORT_SEA_PAIR_JSON (see .env.local) or TECHSUPPORT_KEY_FILE (path to the key file) ' +
      'before running dev:techsupport.',
    );
  }
  if (!pair || !pair.pub || !pair.priv || !pair.epub || !pair.epriv) {
    throw new Error('TechSupport key is missing pub/epub/priv/epriv.');
  }
  const expectedPub = techsupport.currentTechSupportDmPub();
  if (pair.pub !== expectedPub) {
    throw new Error(
      `TechSupport key's pub (${pair.pub}) does not match currentTechSupportDmPub() ` +
      `(${expectedPub}) — refusing to start. This would be silent impersonation.`,
    );
  }
  return pair;
}

function waitForServer(url, timeoutMs) {
  const client = url.startsWith('https') ? https : http;
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    function retry() {
      if (Date.now() >= deadline) reject(new Error(`Server not ready after ${timeoutMs}ms (${url})`));
      else setTimeout(poll, 500);
    }
    function poll() {
      const req = client.get(url, { rejectUnauthorized: false }, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', retry);
      req.setTimeout(5000, () => req.destroy(new Error('probe timeout')));
    }
    poll();
  });
}

(async () => {
  const techsupport = requireCompiledTechSupport();
  const pair = loadPair(techsupport);

  console.log(`⏳ Waiting for dev server at ${APP_URL}...`);
  await waitForServer(APP_URL, SERVER_WAIT_MS);

  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
    ignoreHTTPSErrors: true,
    viewport: { width: 720, height: 960 },
    args: ['--window-position=0,0', '--window-size=720,960', '--force-device-scale-factor=1'],
  });

  process.once('SIGINT', async () => { await context.close(); process.exit(130); });
  process.once('SIGTERM', async () => { await context.close(); process.exit(143); });

  // Injected before navigation, so the app's very first boot (ensureKeypairAndAuth,
  // initializeUser) already sees the canonical id + pair — never a randomly generated one.
  await context.addInitScript(
    ({ userId, keypairStorageKey, pairJson }) => {
      window.localStorage.setItem('iinpublic_user_id', userId);
      window.localStorage.setItem(keypairStorageKey, pairJson);
    },
    {
      userId: techsupport.TECHSUPPORT_ROOT_USER_ID,
      keypairStorageKey: 'iinpublic_techsupport_keypair_v1',
      pairJson: JSON.stringify(pair),
    },
  );

  const page = context.pages()[0] || await context.newPage();
  page.on('pageerror', (err) => console.log(`[techsupport] pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log(`[techsupport] console.error: ${msg.text()}`);
  });

  await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  console.log(`✅ TechSupport-mode browser open at ${APP_URL} (pub=${pair.pub.slice(0, 12)}…)`);

  // Keep the Node process alive so the browser stays open.
  await new Promise(() => {});
})().catch((err) => {
  console.error('❌ dev-techsupport-login error:', err.message);
  process.exit(1);
});
