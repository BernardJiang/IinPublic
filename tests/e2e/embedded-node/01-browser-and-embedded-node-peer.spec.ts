/**
 * S3 — Cross-platform native clients (embedded-node model).
 *
 * Boots a REAL `dist/server/node-app/embedded-node.js` process — exactly what
 * every desktop/mobile shell runs — peered upstream to this worker's Gun
 * server, then drives one browser against the normal webpack dev server
 * (the "browser peer") and a second browser against the embedded node's own
 * served origin (the "embedded-node desktop peer", standing in for an
 * Electron/Android/iOS shell's WebView). Both peers join the same chatroom,
 * exchange a talk to match, and the test asserts the direct-P2P WebRTC
 * DataChannel opens between them — proving the embedded node's reused web
 * SPA + upstream hub peering produces a fully working P2P peer, not just a
 * server that boots and serves static files.
 *
 * Acceptance criteria:
 * 1. The embedded-node process boots, peers upstream to the worker's Gun
 *    server, and serves the SPA on its own loopback port.
 * 2. A browser peer (normal dev-server origin) and the embedded-node peer
 *    (embedded-node origin) can see each other as Gun peers, exchange a
 *    talk, and match.
 * 3. After matching, both sides open a direct-p2p conversation and the
 *    WebRTC DataChannel reaches `connected` (reusing
 *    tests/e2e/helpers/p2p-transport-e2e.ts, same helper the all-browser
 *    P2P specs use).
 *
 * See tests/e2e/embedded-node/README.md for why this lives outside the
 * normal per-worker port-pair model and how to run it.
 */
import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as http from 'http';
import { test, expect } from '../helpers/fixtures';
import { clearGunForStage2Spec } from '../helpers/e2e-stage-pipeline';
import { afterSync, afterNav, afterLoad, E2E_ASSERT_TIMEOUT_MS } from '../helpers/timing';
import { WEBRTC_CHROMIUM_ARGS } from '../helpers/webrtc-chromium';
import { gunBaseURL, gunPort, parallelSlot } from '../helpers/ports';
import { gotoWebApp, injectIdbClear } from '../helpers/clear-database';
import { attachFilteredConsoleLog } from '../helpers/e2e-console';
import { ensureWindowFitsViewport } from '../helpers/browser-window';
import { attachE2eBrowserTabLabel } from '../helpers/e2e-tab-title';
import {
  bootstrapUser,
  openIncomingTalkModal,
  waitForResponseModalClosed,
  pinStableE2eLocation,
  expectTechSupportGreetingReceived,
} from '../helpers/talks-matching-flow';
import {
  createSimpleFlowTalk,
  goToChatrooms,
} from '../helpers/broadcast-cancellation-helpers';
import { clickBroadcastUntilBulkAck, waitForDistinctGunPeersExcludingSelf } from '../helpers/talk-demo-ui';
import { prepareDirectP2PConversation, waitForDirectP2PChannel } from '../helpers/p2p-transport-e2e';

const MATCH_ANSWER = 'Yes match';
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const EMBEDDED_NODE_ENTRY = path.join(repoRoot, 'dist', 'server', 'node-app', 'embedded-node.js');
const WEB_ROOT = path.join(repoRoot, 'dist', 'web');
/** One dedicated port per worker, well outside the worker web/gun port bands (3001+N / 8080+N). */
const EMBEDDED_NODE_PORT = 19090 + parallelSlot();

function embeddedNodeBaseURL(): string {
  return `http://127.0.0.1:${EMBEDDED_NODE_PORT}`;
}

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

/**
 * Bootstraps a user against an arbitrary base URL — same steps as
 * `bootstrapUser` in talks-matching-flow.ts, which hardcodes
 * `webAppURLStableChatroom()`. Here the page is served by the embedded-node
 * process instead of the worker's webpack dev server.
 */
async function bootstrapUserOnOrigin(
  browser: Browser,
  label: string,
  stageName: string,
  baseURL: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    viewport: { width: 640, height: 1000 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  attachFilteredConsoleLog(page, label);
  await injectIdbClear(page);
  const params = new URLSearchParams({
    e2e_capacity: '50',
    e2e_fifo: 'false',
    e2e_p0_talks: '1',
    e2e_mesh_talks: '1',
  });
  await gotoWebApp(page, `${baseURL}/?${params.toString()}`);
  await ensureWindowFitsViewport(page, 640, 1000);
  await afterLoad();
  await page.click('.nav-btn[data-view="settings"]');
  await afterNav();
  await page.waitForSelector('#settings-stage-name-input');
  await page.fill('#settings-stage-name-input', stageName);
  await page.locator('#settings-stage-name-input').blur();
  await afterNav();
  await expect
    .poll(
      () => page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.currentUser?.stageName ?? ''),
      { timeout: E2E_ASSERT_TIMEOUT_MS },
    )
    .toBe(stageName);
  await page.click('.nav-btn[data-view="chatrooms"]');
  await afterNav();
  await pinStableE2eLocation(page);
  await expectTechSupportGreetingReceived(page);
  attachE2eBrowserTabLabel(page, label);
  return { context, page };
}

test.describe('S3 embedded-node: browser peer <-> embedded-node desktop peer', () => {
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

    embeddedNodeDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iinpublic-embedded-e2e-'));
    embeddedNodeProcess = spawn(
      process.execPath,
      [EMBEDDED_NODE_ENTRY],
      {
        env: {
          ...process.env,
          IINPUBLIC_EMBEDDED_NODE: '1',
          IINPUBLIC_PLATFORM: 'ubuntu',
          IINPUBLIC_LOCAL_PORT: String(EMBEDDED_NODE_PORT),
          PORT: String(EMBEDDED_NODE_PORT),
          // Peer upstream to THIS worker's Gun server (not the real public hub) —
          // same mechanism a desktop/mobile shell uses to dial the production
          // hub, just pointed at the worker's test server so both peers share
          // one chatroom/talk graph.
          IINPUBLIC_HUB_GUN_URL: `${gunBaseURL()}/gun`,
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
        console.error(`[embedded-node e2e] process exited early (code=${code} sig=${sig})\n${embeddedNodeOutput.slice(-4000)}`);
      }
    });

    try {
      await waitForHttpHealth(EMBEDDED_NODE_PORT);
    } catch (err) {
      throw new Error(`${(err as Error).message}\n--- embedded-node output ---\n${embeddedNodeOutput.slice(-4000)}`);
    }

    browserOnDevServer = await chromium.launch({ headless: true, args: [...WEBRTC_CHROMIUM_ARGS] });
    browserOnEmbeddedNode = await chromium.launch({ headless: true, args: [...WEBRTC_CHROMIUM_ARGS] });
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

  test('browser peer and embedded-node peer match on a talk and open a direct-P2P DataChannel', async () => {
    test.setTimeout(300_000);
    const title = `Embedded-node P2P test ${Date.now()}`;

    // Tom: ordinary browser peer on the worker's webpack dev server (the
    // baseline "any browser" path).
    const tom = await bootstrapUser(browserOnDevServer, 'Tom', 'Tom DevServer');
    // Jerry: served by the embedded-node process — stands in for the WebView
    // in an Electron/Android/iOS shell loading the reused SPA from its local
    // node (see docs/design/S3-embedded-node-shell.md).
    const jerry = await bootstrapUserOnOrigin(
      browserOnEmbeddedNode,
      'Jerry',
      'Jerry EmbeddedNode',
      embeddedNodeBaseURL(),
    );
    const pageTom: Page = tom.page;
    const pageJerry: Page = jerry.page;

    try {
      await pageTom.click('.chatroom-item:has-text("Global")');
      await pageJerry.click('.chatroom-item:has-text("Global")');
      await afterSync();

      // Tom creates and broadcasts a simple flow talk from the dev-server origin.
      await createSimpleFlowTalk(pageTom, title, MATCH_ANSWER, 'No mismatch', {
        sendToChatroom: false,
      });
      await goToChatrooms(pageTom);
      await pageTom.click('.chatroom-item:has-text("Global")');
      await afterSync();

      // Wait for the dev-server browser to see at least one other Gun peer —
      // with the embedded-node fix, that now includes Jerry's browser, relayed
      // through worker-gun <-> embedded-node-gun <-> Jerry's-browser-gun.
      await waitForDistinctGunPeersExcludingSelf(pageTom, 1, 60_000);
      await clickBroadcastUntilBulkAck(pageTom);
      await afterSync();

      // Jerry (embedded-node peer) answers via the UI — match answer triggers a match.
      await openIncomingTalkModal(pageJerry, title);
      await pageJerry
        .locator(`input.choice-radio[data-answer-text="${MATCH_ANSWER}"][data-mode="manual"]`)
        .first()
        .click();
      await waitForResponseModalClosed(pageJerry);
      await afterSync();

      const tomUserId: string = await pageTom.evaluate(
        () => (window as any).__iinpublic_app?.getApp?.()?.currentUser?.id ?? '',
      );
      const jerryUserId: string = await pageJerry.evaluate(
        () => (window as any).__iinpublic_app?.getApp?.()?.currentUser?.id ?? '',
      );
      expect(tomUserId).toBeTruthy();
      expect(jerryUserId).toBeTruthy();

      // Open conversations on both sides and wait for the direct-P2P WebRTC
      // DataChannel to connect — this is the assertion that matters: the
      // embedded-node peer is not just a static file server, it's a real
      // participant in the WebRTC mesh.
      const conversationId = await prepareDirectP2PConversation(
        pageTom,
        pageJerry,
        tomUserId,
        jerryUserId,
        'Jerry EmbeddedNode',
        'Tom DevServer',
      );

      await waitForDirectP2PChannel(pageTom, conversationId);
      await waitForDirectP2PChannel(pageJerry, conversationId);
    } finally {
      await pageTom.close().catch(() => {});
      await pageJerry.close().catch(() => {});
    }
  });
});
