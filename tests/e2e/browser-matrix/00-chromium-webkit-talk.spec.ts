/**
 * First mixed-browser P2P matrix slice.
 *
 * Chromium and WebKit run simultaneously against the same isolated worker hub.
 * Chromium authors a one-question matching Talk, WebKit answers it, and the
 * resulting direct thread carries a message in both directions. The explicit
 * peer names make failures and artifacts attributable to a browser engine.
 */
import { chromium, webkit, type Browser } from '@playwright/test';
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

test.describe('mixed browsers: Chromium <-> WebKit', () => {
  let chromiumBrowser: Browser | undefined;
  let webkitBrowser: Browser | undefined;
  let pair: FastDmPair | undefined;

  test.beforeAll(async ({ e2eWorkerSlot: _workerSlot }) => {
    await clearGunForStage2Spec();
    chromiumBrowser = await chromium.launch({ headless: true, args: WEBRTC_CHROMIUM_ARGS });
    webkitBrowser = await webkit.launch({ headless: true });
  });

  test.afterAll(async () => {
    if (pair) await teardownFastDmPair(pair);
    await chromiumBrowser?.close().catch(() => {});
    await webkitBrowser?.close().catch(() => {});
    await clearGunForStage2Spec();
  });

  test('chromium-alice authors, webkit-bob matches, and both directions deliver', async () => {
    test.setTimeout(120_000);
    pair = await setupFastMatchedDm(
      chromiumBrowser!,
      webkitBrowser!,
      'chromium-alice',
      'webkit-bob',
    );

    const { pageA, pageB, conversationId, userIdA, userIdB } = pair;
    const chromiumMessage = `chromium-to-webkit-${Date.now()}`;
    const webkitMessage = `webkit-to-chromium-${Date.now()}`;

    await sendConversationMessage(pageA, conversationId, userIdA, chromiumMessage);
    await waitForMessageVisible(pageB, chromiumMessage, 30_000);

    await sendConversationMessage(pageB, conversationId, userIdB, webkitMessage);
    await waitForMessageVisible(pageA, webkitMessage, 30_000);

    for (const page of [pageA, pageB]) {
      await expect(page.locator('#conversation-messages .message-text').filter({ hasText: chromiumMessage })).toHaveCount(1);
      await expect(page.locator('#conversation-messages .message-text').filter({ hasText: webkitMessage })).toHaveCount(1);
    }
  });
});
