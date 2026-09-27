const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');
const { loadTechSupportPairSync } = require('../src/server/security/techsupport-key-custody');
const { main: runDelegateTool } = require('./techsupport-delegate-tool');

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
const DELEGATE_LABEL = 'dev:techsupport session';
const DELEGATE_TTL_DAYS = 1;

// Legacy pre-OPEN-27 storage key: a browser-root-mode session used to read the actual TechSupport
// private key from here. Nothing in this script writes it any more, but an old profile directory
// (from a build of this script that predates the rewrite below) could still have it on disk —
// explicitly erased on every launch so a stale profile can never silently re-enable root mode.
const LEGACY_ROOT_KEYPAIR_STORAGE_KEY = 'iinpublic_techsupport_keypair_v1';
const DELEGATE_OPT_IN_STORAGE_KEY = 'iinpublic_techsupport_delegate_optin_v1';

/**
 * docs/TODO.md OPEN-27: `npm run dev:techsupport` boots the *normal* web client against an
 * already-running relay (`npm run dev` / `dev:multi` in another terminal), then issues that
 * browser's own freshly-generated ordinary device identity a short-lived TechSupport delegate
 * grant — through the same local-signer CLI a real operator uses in production
 * (`techsupport-delegate-tool.js issue`) — and opts it in automatically. It used to inject the
 * actual TechSupport ROOT private key straight into the browser's localStorage; this was the last
 * place a real root private key touched a browser process at all, even in dev (production itself
 * was already hardened to reject and erase this injection). The root pair is now only ever
 * decrypted in THIS short-lived Node process, exactly like production delegate issuance already
 * works — the browser never sees `priv`/`epriv` for anything but its own ordinary device key,
 * which is no more sensitive than any other user's.
 *
 * The resulting session behaves exactly like a real opted-in delegate: it answers as itself (not
 * as the TechSupport root identity), can publish verifiable answers, and its grant simply expires
 * after DELEGATE_TTL_DAYS like any other delegate's would. `scripts/techsupport-agent.js` (a
 * separate, non-interactive tool explicitly documented as loopback/E2E-only and never run in
 * production, see `docs/IinPublic_VPS_Installation_Guide.md` §14) still uses the older root-
 * injection path for now — narrower in scope to convert and tracked separately if ever needed.
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

/** Fail fast, before ever opening a browser, if the configured vault is missing or wrong. */
function assertVaultIsUsable(techsupport) {
  const pair = loadTechSupportPairSync();
  const expectedPub = techsupport.currentTechSupportDmPub();
  if (pair.pub !== expectedPub) {
    throw new Error(
      `Configured TechSupport key's pub (${pair.pub}) does not match currentTechSupportDmPub() ` +
      `(${expectedPub}) — refusing to start. This would be silent impersonation.`,
    );
  }
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

/**
 * Waits for this browser's own ordinary device identity — never TechSupport's — to boot. Reads
 * the pub key straight from the running app instance (`gunService.getStoredPair()`) rather than
 * guessing at a localStorage key/shape: device-identity custody storage is an internal, evolving
 * implementation detail (plain localStorage historically, IndexedDB-backed custody more recently
 * per OPEN-34/OPEN-06) that this script has no business depending on directly.
 */
async function waitForOwnDeviceIdentity(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const identity = await page.evaluate(() => {
      const app = window.__iinpublic_app && window.__iinpublic_app.getApp && window.__iinpublic_app.getApp();
      const userId = app && app.currentUser && app.currentUser.id;
      const pub = app && app.gunService && app.gunService.getStoredPair && app.gunService.getStoredPair()?.pub;
      return userId && pub ? { userId, pub } : null;
    });
    if (identity) return identity;
    if (Date.now() >= deadline) throw new Error('Device identity did not boot in time');
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

(async () => {
  const techsupport = requireCompiledTechSupport();
  assertVaultIsUsable(techsupport);

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

  // Also purge a stale `iinpublic_user_id` left over from an older build of this script that
  // force-set it to the TechSupport root's own id — an ordinary identity must never resume as
  // that id once its matching private key is no longer being injected.
  await context.addInitScript(
    ({ legacyKeypairKey, userIdKey, rootUserId }) => {
      try {
        window.localStorage.removeItem(legacyKeypairKey);
        if (window.localStorage.getItem(userIdKey) === rootUserId) {
          window.localStorage.removeItem(userIdKey);
        }
      } catch {
        /* ignore */
      }
    },
    {
      legacyKeypairKey: LEGACY_ROOT_KEYPAIR_STORAGE_KEY,
      userIdKey: 'iinpublic_user_id',
      rootUserId: techsupport.TECHSUPPORT_ROOT_USER_ID,
    },
  );

  const page = context.pages()[0] || await context.newPage();
  page.on('pageerror', (err) => console.log(`[techsupport] pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log(`[techsupport] console.error: ${msg.text()}`);
  });

  await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });

  console.log('⏳ Waiting for this browser\'s own device identity to boot...');
  const { userId, pub } = await waitForOwnDeviceIdentity(page, SERVER_WAIT_MS);
  console.log(`✅ Device identity ready (userId=${userId}, pub=${pub.slice(0, 12)}…)`);

  const apiBase = await page.evaluate(() => window.__iinpublic_app.getApp().getBackendApiBase());

  // The dev relay's own self-signed cert (certs/dev-cert.pem) fails Node's default fetch()
  // verification even though it's a trusted loopback target (the browser side already tolerates
  // it via ignoreHTTPSErrors above). Scoped to this short-lived local-only process.
  if (/^https:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(apiBase)) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  }

  console.log('🔏 Issuing a short-lived TechSupport delegate grant for this device (the root key stays in this Node process and never touches the browser)...');
  await runDelegateTool([
    'issue',
    '--api-base', apiBase,
    '--delegate-user-id', userId,
    '--delegate-pub', pub,
    '--label', DELEGATE_LABEL,
    '--ttl-days', String(DELEGATE_TTL_DAYS),
  ]);

  // Opt this device in immediately so a dev session doesn't need a manual Settings toggle click
  // every time — matches persistDelegateOptIn(true) in app.ts. The live relay poll
  // (startTechSupportDelegateRelayPolling, ~5s cadence) picks up the freshly published grant on
  // its own; no reload needed.
  await page.evaluate((storageKey) => {
    try { window.localStorage.setItem(storageKey, '1'); } catch { /* ignore */ }
  }, DELEGATE_OPT_IN_STORAGE_KEY);

  console.log(`✅ TechSupport delegate-mode browser open at ${APP_URL} (userId=${userId})`);
  console.log(`   This device is a delegate, not the TechSupport root — its grant expires in ${DELEGATE_TTL_DAYS} day(s).`);

  // Keep the Node process alive so the browser stays open.
  await new Promise(() => {});
})().catch((err) => {
  console.error('❌ dev-techsupport-login error:', err.message);
  process.exit(1);
});
