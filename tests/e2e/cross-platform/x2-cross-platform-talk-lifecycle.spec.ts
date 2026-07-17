/**
 * X2 (P0 merge gate) — cross-platform talk lifecycle + thread replies both ways.
 *
 * A talk is answered to a match across two clients on the shared hub, then each
 * client sends a DM the other must receive — proving the full lifecycle and
 * bidirectional thread replies survive the cross-client path.
 */
import { chromium, Browser } from '@playwright/test';
import { test, expect } from '../helpers/fixtures';
import { clearGunForStage2Spec } from '../helpers/e2e-stage-pipeline';
import { headless } from '../helpers/timing';
import {
  setupFastMatchedDm,
  teardownFastDmPair,
  FastDmPair,
  sendConversationMessage,
  waitForMessageVisible,
} from '../helpers/fast-dm-setup';
import { WEBRTC_CHROMIUM_ARGS } from '../helpers/webrtc-chromium';

test.describe('X2: cross-platform talk lifecycle + thread replies', () => {
  let browserA: Browser;
  let browserB: Browser;
  let pair: FastDmPair | undefined;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage2Spec();
    browserA = await chromium.launch({ headless, args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=0,0', '--window-size=900,1100'] });
    browserB = await chromium.launch({ headless, args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=900,0', '--window-size=900,1100'] });
  });

  test.afterAll(async () => {
    if (pair) await teardownFastDmPair(pair);
    await browserA?.close().catch(() => {});
    await browserB?.close().catch(() => {});
    await clearGunForStage2Spec();
  });

  test('match created, then a reply lands on each side', async () => {
    pair = await setupFastMatchedDm(browserA, browserB, 'X2-Web', 'X2-App');
    const { pageA, pageB, conversationId, userIdA, userIdB } = pair;

    // A → B.
    await sendConversationMessage(pageA, conversationId, userIdA, 'from-web-to-app');
    await waitForMessageVisible(pageB, 'from-web-to-app', 20_000);

    // B → A.
    await sendConversationMessage(pageB, conversationId, userIdB, 'from-app-to-web');
    await waitForMessageVisible(pageA, 'from-app-to-web', 20_000);

    // Both messages are present on both sides.
    for (const page of [pageA, pageB]) {
      await expect(page.locator('#conversation-messages .message-text').filter({ hasText: 'from-web-to-app' })).toHaveCount(1);
      await expect(page.locator('#conversation-messages .message-text').filter({ hasText: 'from-app-to-web' })).toHaveCount(1);
    }
  });
});
