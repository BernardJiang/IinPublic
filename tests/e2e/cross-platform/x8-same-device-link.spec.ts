/**
 * X8 (nightly) — same-device linking: a browser tab and the native "app" on the SAME
 * machine (TODO item I / §10.3).
 *
 * The native/desktop "app" a browser tab links with on one machine is not a separate
 * product — it is this same `src/server` code running in embedded-node mode, serving
 * the identical web bundle on `http://127.0.0.1:<port>` (see `loopback-probe.ts`'s own
 * doc comment). This boots a REAL `dist/server/node-app/embedded-node.js` process
 * (exactly what `01-browser-and-embedded-node-peer.spec.ts` uses to stand in for an
 * Electron/Android/iOS shell) peered upstream to this worker's Gun server, then drives
 * one browser against the normal webpack dev server (the "browser" side) and a second
 * browser against the embedded node's own served origin (the "app" side) through the
 * full mutual identity-link protocol (`stage2-two-user/73-identity-link-mutual.spec.ts`
 * covers ordinary browser-to-browser linking; this is that same protocol, but the
 * responder side opens its code by navigating the loopback `#link=<code>` fragment URL
 * instead of typing/pasting it — the same URL a loopback "Link with the app on this
 * computer" button click (`window.open(loopbackLinkUrl(code), ...)`) would open).
 *
 * Not exercised here: the loopback-button *auto-discovery* itself
 * (`probeLoopbackNode()`, hardcoded to port 8080) — in this test harness port 8080 is
 * already the worker's own Gun/API server, so a same-machine reachability probe against
 * the production default port cannot be faithfully reproduced without colliding with
 * the test infrastructure's own ports. Discovery/visibility is unit-covered directly
 * (`linked-devices-dialog.test.ts`'s loopback-button-visibility cases). What this test
 * proves end-to-end instead is the mechanism the button composes with: opening a real
 * `#link=<code>` URL on a real second same-machine instance completes the full mutual
 * link, and reusing that one-time code a second time is correctly rejected.
 *
 * KNOWN GAP surfaced while building this (docs/TODO.md §I): the embedded node's default
 * hub-relay mode (`IINPUBLIC_EMBEDDED_HUB_MODE` unset → `'explicit-http'`) only relays a
 * narrow allowlist between the local node and the hub — `relayOnlyDataClasses:
 * ['discovery', 'signaling', 'presence', 'room-membership']` (`p2p-runtime.ts`).
 * `identity-link-requests/*` is not in that list, so in that (production-default) mode a
 * browser tab and an embedded-node "app" cannot actually complete a mutual link through
 * the real public hub — the same restriction also currently breaks
 * `01-browser-and-embedded-node-peer.spec.ts`'s talk-matching assertion (`clusters=0`),
 * so this is a pre-existing embedded-node/hub-relay gap, not something new to same-device
 * linking. This spec forces `IINPUBLIC_EMBEDDED_HUB_MODE=gun-peer` (a real, raw Gun peer
 * link instead of the narrow HTTP relay) purely to get a genuine second same-machine
 * instance sharing one identity graph for the test — it does NOT prove the loopback flow
 * works under the production-default relay mode. Whether `identity-link-requests` (and
 * whatever the S3 spec needs for mesh talk delivery) should join the relay allowlist, or
 * same-device linking should instead lean on LAN discovery to bypass the hub restriction
 * entirely, is an open product/architecture question — not decided here.
 */
import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as http from 'http';
import { test, expect } from '../helpers/fixtures';
import { clearGunForStage2Spec } from '../helpers/e2e-stage-pipeline';
import { afterLoad, afterSync } from '../helpers/timing';
import { gunBaseURL, webBaseURL, parallelSlot } from '../helpers/ports';
import { gotoWebApp, injectIdbClear } from '../helpers/clear-database';
import { loopbackLinkUrl } from '../../../src/web/services/loopback-probe';
import { openSettingsSection, SETTINGS_SECTION } from '../helpers/settings-nav';

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const EMBEDDED_NODE_ENTRY = path.join(repoRoot, 'dist', 'server', 'node-app', 'embedded-node.js');
const WEB_ROOT = path.join(repoRoot, 'dist', 'web');
/** Dedicated port, well outside the worker's own web/gun port band (3001+N / 8080+N). */
const EMBEDDED_NODE_PORT = 19190 + parallelSlot();

function waitForHttpHealth(port: number, deadlineMs = 20_000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.get({ host: '127.0.0.1', port, path: '/health', timeout: 1500 }, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode < 500) resolve();
        else retry();
      });
      req.on('error', retry);
      req.on('timeout', () => { req.destroy(); retry(); });
    };
    const retry = () => {
      if (Date.now() - start > deadlineMs) {
        reject(new Error(`embedded-node did not become healthy on port ${port} within ${deadlineMs}ms`));
        return;
      }
      setTimeout(tryOnce, 300);
    };
    tryOnce();
  });
}

async function bootstrapDeviceOnOrigin(browser: Browser, baseURL: string): Promise<{
  context: BrowserContext;
  page: Page;
}> {
  const context = await browser.newContext({ viewport: { width: 760, height: 960 } });
  const page = await context.newPage();
  await injectIdbClear(page);
  await gotoWebApp(page, baseURL);
  await afterLoad();
  return { context, page };
}

async function openIdentityDevices(page: Page): Promise<void> {
  await page.locator('.nav-btn[data-view="settings"]').click();
  await openSettingsSection(page, SETTINGS_SECTION.linkedDevices);
  await page.locator('[data-testid="settings-linked-devices-btn"]').click();
  await expect(page.locator('[data-testid="linked-devices-page"]')).toBeVisible();
}

test.describe('X8: same-device link (app <-> browser)', () => {
  let browserOnDevServer: Browser;
  let browserOnEmbeddedNode: Browser;
  let embeddedNodeProcess: ChildProcessWithoutNullStreams;
  let embeddedNodeOutput = '';
  let embeddedNodeDataDir: string;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    test.setTimeout(300_000);

    if (!fs.existsSync(EMBEDDED_NODE_ENTRY)) {
      throw new Error(
        `Missing build artifact: ${EMBEDDED_NODE_ENTRY} — run "npm run build:server" first.`,
      );
    }
    if (!fs.existsSync(WEB_ROOT)) {
      throw new Error(`Missing build artifact: ${WEB_ROOT} — run "npm run build:web" first.`);
    }

    await clearGunForStage2Spec();

    embeddedNodeDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iinpublic-x8-embedded-e2e-'));
    // BUG FOUND while building this spec: `resolveUpstreamHubPeers` (http-bootstrap.ts)
    // short-circuits to `[]` whenever `E2E_GUN_MEMORY_ONLY`/`DEV_GUN_FRESH` is set, BEFORE
    // it even looks at hubRelayMode — those flags exist so the *worker's own* Gun server
    // stays isolated between parallel test runs, but a naive `...process.env` spread also
    // leaks them into this spawned embedded-node child, silently zeroing its upstream
    // peers regardless of IINPUBLIC_HUB_GUN_URL/IINPUBLIC_EMBEDDED_HUB_MODE. The embedded
    // node has its own isolated on-device dir (embeddedNodeDataDir, a fresh tmpdir cleaned
    // up in afterAll) and doesn't need that isolation — so those two are explicitly
    // stripped here. (`01-browser-and-embedded-node-peer.spec.ts` has the same leak via
    // the same `...process.env` pattern — currently fails the same way, `clusters=0`.)
    const embeddedNodeEnv: NodeJS.ProcessEnv = { ...process.env };
    delete embeddedNodeEnv.E2E_GUN_MEMORY_ONLY;
    delete embeddedNodeEnv.DEV_GUN_FRESH;
    embeddedNodeProcess = spawn(
      process.execPath,
      [EMBEDDED_NODE_ENTRY],
      {
        env: {
          ...embeddedNodeEnv,
          // tls-mode.ts's plaintext-test escape is normally keyed off
          // E2E_GUN_MEMORY_ONLY too — deliberately stripped above, so this local-only
          // loopback listener needs its own explicit plain-HTTP opt-in instead.
          TLS_DISABLE: '1',
          IINPUBLIC_EMBEDDED_NODE: '1',
          IINPUBLIC_PLATFORM: 'ubuntu',
          IINPUBLIC_LOCAL_PORT: String(EMBEDDED_NODE_PORT),
          PORT: String(EMBEDDED_NODE_PORT),
          // Peer upstream to THIS worker's Gun server (not the real public hub) — same
          // mechanism a desktop/mobile shell uses to dial the production hub, just pointed
          // at the worker's test server so both same-device sides share one identity graph.
          IINPUBLIC_HUB_GUN_URL: `${gunBaseURL()}/gun`,
          // KNOWN GAP (see file header): the production DEFAULT relay mode
          // ('explicit-http') only relays a narrow allowlist that does not include
          // identity-link-requests, so it cannot carry this test's mutual-link handshake.
          // Forcing a real raw Gun peer link here is a test-only workaround, not a claim
          // that same-device linking works under the production-default relay mode.
          IINPUBLIC_EMBEDDED_HUB_MODE: 'gun-peer',
          IINPUBLIC_WEB_ROOT: WEB_ROOT,
          IINPUBLIC_DATA_DIR: embeddedNodeDataDir,
          IINPUBLIC_LOOPBACK_ONLY: '1',
        },
      },
    );
    embeddedNodeProcess.stdout.on('data', (d) => { embeddedNodeOutput += d.toString(); });
    embeddedNodeProcess.stderr.on('data', (d) => { embeddedNodeOutput += d.toString(); });
    embeddedNodeProcess.on('exit', (code, sig) => {
      if (code !== null && code !== 0) {
        // eslint-disable-next-line no-console
        console.error(`[x8 e2e] embedded-node process exited early (code=${code} sig=${sig})\n${embeddedNodeOutput.slice(-4000)}`);
      }
    });

    try {
      await waitForHttpHealth(EMBEDDED_NODE_PORT);
    } catch (err) {
      throw new Error(`${(err as Error).message}\n--- embedded-node output ---\n${embeddedNodeOutput.slice(-4000)}`);
    }

    browserOnDevServer = await chromium.launch({ headless: true });
    browserOnEmbeddedNode = await chromium.launch({ headless: true });
  });

  test.afterAll(async () => {
    await browserOnDevServer?.close().catch(() => {});
    await browserOnEmbeddedNode?.close().catch(() => {});
    try { embeddedNodeProcess?.kill('SIGTERM'); } catch { /* already gone */ }
    await clearGunForStage2Spec().catch(() => {});
    if (embeddedNodeDataDir) {
      fs.rmSync(embeddedNodeDataDir, { recursive: true, force: true });
    }
  });

  test('loopback #link= fragment on a real second same-machine instance completes mutual linking; reused code fails', async () => {
    test.setTimeout(120_000);

    // "Browser" side: ordinary webpack dev-server origin.
    const browserSide = await bootstrapDeviceOnOrigin(browserOnDevServer, webBaseURL());
    // "App" side context: served by the real embedded-node process — stands in for the
    // desktop/mobile shell's WebView loading the reused SPA from its local node. No initial
    // page/navigation here — the real "Link with the app on this computer" affordance opens
    // the loopback URL via `window.open(...)`, i.e. a brand-new tab's FIRST navigation, which
    // is what actually boots the app and runs its once-per-boot URL-fragment auto-detect
    // (checkForPendingIdentityLinkFragment, app.ts). A same-tab `page.goto()` to a URL that
    // differs only in its hash is a same-document fragment navigation in Chromium — it does
    // not reload the document or rerun boot — so each loopback open below uses a fresh page.
    const appContext = await browserOnEmbeddedNode.newContext({ viewport: { width: 760, height: 960 } });

    try {
      // Browser generates and shows a link code (the ordinary "Link a device" flow).
      await openIdentityDevices(browserSide.page);
      await browserSide.page.locator('[data-testid="link-a-device-btn"]').click();
      await expect(browserSide.page.locator('[data-testid="link-device-start-confirm"]')).toContainText('publicly reveal');
      await browserSide.page.locator('[data-testid="confirm-generate-link-code"]').click();
      const code = (await browserSide.page.locator('[data-testid="link-device-code"]').textContent()) || '';
      expect(code).not.toBe('');

      // App side: a fresh tab's first navigation goes straight to the loopback link URL —
      // exactly what the "Link with the app on this computer" button's window.open produces.
      const appPage = await appContext.newPage();
      await injectIdbClear(appPage);
      await gotoWebApp(appPage, loopbackLinkUrl(code, EMBEDDED_NODE_PORT));
      await afterLoad();
      await expect(appPage.locator('[data-testid="enter-link-code-input"]')).toHaveValue(code);
      await expect(appPage.locator('[data-testid="enter-link-peer-preview"]')).toContainText('publicly reveal');
      await appPage.locator('[data-testid="enter-link-code-submit"]').click();
      await expect(appPage.locator('[data-testid="linked-device-row"]')).toContainText(
        'Waiting for approval',
        { timeout: 20_000 },
      );

      // Browser discovers the app's signed request and must still explicitly approve it.
      // Generous retry budget: the request travels an extra hop here (app's own Gun ->
      // embedded-node's upstream peering -> the worker's Gun server) compared to the plain
      // two-browser-on-one-Gun-instance case stage2/73 covers, so real-time sync can take
      // noticeably longer to converge.
      const check = browserSide.page.locator('[data-testid="link-device-check-request"]');
      await expect(check).toBeVisible();
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await check.click();
        const approve = browserSide.page.locator('[data-testid="approve-link-request"]');
        await expect.poll(async () =>
          (await approve.isVisible().catch(() => false)) || (await check.isEnabled().catch(() => false)),
        { timeout: 12_000 }).toBe(true);
        if (await approve.isVisible().catch(() => false)) break;
        await browserSide.page.waitForTimeout(1000);
      }
      await expect(browserSide.page.locator('[data-testid="approve-link-request"]')).toBeVisible({ timeout: 20_000 });
      await browserSide.page.locator('[data-testid="approve-link-request"]').click();
      await expect(browserSide.page.locator('[data-testid="link-device-code-modal"]')).toHaveCount(0);
      await expect(browserSide.page.locator('[data-testid="linked-device-row"]')).toContainText('Linked');

      // App independently verifies both graph signatures before changing its own row.
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await appPage.locator('[data-testid="refresh-linked-devices"]').click();
        if ((await appPage.locator('[data-testid="linked-device-row"]').textContent())?.includes('Linked')) break;
        await appPage.waitForTimeout(500);
      }
      await expect(appPage.locator('[data-testid="linked-device-row"]')).toContainText('Linked');
      await afterSync();

      // The same one-time loopback URL cannot be reused: opening it again (a fresh tab, same
      // as the first time) re-opens the prefilled dialog, but submitting the already-consumed
      // code is rejected.
      const appPageRetry = await appContext.newPage();
      await gotoWebApp(appPageRetry, loopbackLinkUrl(code, EMBEDDED_NODE_PORT), 30_000);
      await afterLoad();
      await expect(appPageRetry.locator('[data-testid="enter-link-code-input"]')).toHaveValue(code);
      await appPageRetry.locator('[data-testid="enter-link-code-submit"]').click();
      await expect(appPageRetry.locator('[data-testid="enter-link-code-error"]')).toContainText('already linked');
      await appPageRetry.close().catch(() => {});
    } finally {
      await browserSide.page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
      await browserSide.context.close().catch(() => {});
      await appContext.close().catch(() => {});
    }
  });
});
