/**
 * Windows mixed-browser slice: installed Microsoft Edge and Playwright Firefox
 * run simultaneously against the same isolated worker hub.
 */
import { chromium, firefox, type Browser } from '@playwright/test';
import { test, expect } from '../helpers/fixtures';
import { clearGunForStage2Spec } from '../helpers/e2e-stage-pipeline';
import {
  setupFastMatchedDm,
  teardownFastDmPair,
  sendConversationMessage,
  waitForMessageVisible,
  type FastDmPair,
} from '../helpers/fast-dm-setup';
import { WEBRTC_CHROMIUM_ARGS } from '../helpers/webrtc-chromium';

test.describe('Windows mixed browsers: Edge <-> Firefox', () => {
  test.skip(!process.env.E2E_WINDOWS_EDGE, 'requires installed Microsoft Edge on the Windows worker');

  let edgeBrowser: Browser | undefined;
  let firefoxBrowser: Browser | undefined;
  let pair: FastDmPair | undefined;

  test.beforeAll(async ({ e2eWorkerSlot: _workerSlot }) => {
    await clearGunForStage2Spec();
    edgeBrowser = await chromium.launch({ channel: 'msedge', headless: true, args: WEBRTC_CHROMIUM_ARGS });
    firefoxBrowser = await firefox.launch({ headless: true });
  });

  test.afterAll(async () => {
    if (pair) await teardownFastDmPair(pair);
    await edgeBrowser?.close().catch(() => {});
    await firefoxBrowser?.close().catch(() => {});
    await clearGunForStage2Spec();
  });

  test('edge-alice authors, firefox-bob matches, and both directions deliver', async () => {
    test.setTimeout(120_000);
    pair = await setupFastMatchedDm(edgeBrowser!, firefoxBrowser!, 'edge-alice', 'firefox-bob');

    const { pageA, pageB, conversationId, userIdA, userIdB } = pair;
    const edgeMessage = `edge-to-firefox-${Date.now()}`;
    const firefoxMessage = `firefox-to-edge-${Date.now()}`;

    await sendConversationMessage(pageA, conversationId, userIdA, edgeMessage);
    await waitForMessageVisible(pageB, edgeMessage, 30_000);

    await sendConversationMessage(pageB, conversationId, userIdB, firefoxMessage);
    await waitForMessageVisible(pageA, firefoxMessage, 30_000);

    for (const page of [pageA, pageB]) {
      await expect(page.locator('#conversation-messages .message-text').filter({ hasText: edgeMessage })).toHaveCount(1);
      await expect(page.locator('#conversation-messages .message-text').filter({ hasText: firefoxMessage })).toHaveCount(1);
    }
  });
});
