/**
 * Mixed-browser reconnect + restart persistence slice.
 *
 * Closes the gap this directory's README has named since the first mixed-browser slice
 * landed ("A three-peer topology, reconnect, and restart persistence remain subsequent
 * slices.") — the three-peer topology shipped separately; reconnect and restart persistence
 * had not yet been exercised in a mixed-engine pairing.
 *
 * Chromium and WebKit share a matched conversation (fast-dm-setup). While chromium-alice is
 * offline, webkit-bob sends a message; bringing chromium-alice back online proves state
 * convergence through the offline-mailbox/Gun-sync path (CLAUDE.md "Direct P2P conversation
 * transport" — Gun-on-device is the source of truth, WebRTC is notify/sync only). A page
 * reload afterward proves identity and conversation history survive a simulated app restart
 * (same IndexedDB/localStorage), mirroring the established single-engine pattern in
 * stage2-two-user/40-blocklist-persist-restart.spec.ts.
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
import { openConversationViaServer } from '../helpers/conversation-e2e';
import { afterLoad, afterSync, E2E_ASSERT_TIMEOUT_MS } from '../helpers/timing';
import { WEBRTC_CHROMIUM_ARGS } from '../helpers/webrtc-chromium';

test.describe('mixed browsers: reconnect and restart persistence (Chromium <-> WebKit)', () => {
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

  test('chromium-alice disconnects, webkit-bob still sends, and state converges on reconnect', async () => {
    test.setTimeout(120_000);
    pair = await setupFastMatchedDm(chromiumBrowser!, webkitBrowser!, 'chromium-alice', 'webkit-bob');
    const { pageA, pageB, conversationId, userIdB } = pair;

    await pageA.context().setOffline(true);

    const offlineMessage = `webkit-to-offline-chromium-${Date.now()}`;
    await sendConversationMessage(pageB, conversationId, userIdB, offlineMessage);

    // No assertion of absence while offline: proving a message HASN'T arrived yet is
    // inherently racy against however fast Gun's own local write fires, and isn't the
    // behavior this gap cared about. Go straight to proving convergence once reconnected.
    await pageA.context().setOffline(false);
    await afterSync();

    await waitForMessageVisible(pageA, offlineMessage, 30_000);
  });

  test('reloading chromium-alice preserves her identity and the matched conversation', async () => {
    test.setTimeout(60_000);
    if (!pair) throw new Error('pair not set up — run after the reconnect test');
    const { pageA, userIdA, userIdB, nameB } = pair;

    const stageNameBefore = await pageA.evaluate(
      () => (window as any).__iinpublic_app?.getApp?.()?.currentUser?.stageName ?? '',
    );
    expect(stageNameBefore).toBe('chromium-alice');

    await pageA.reload({ waitUntil: 'domcontentloaded' });
    await afterLoad();

    await expect
      .poll(
        () => pageA.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.currentUser?.id ?? ''),
        { timeout: E2E_ASSERT_TIMEOUT_MS },
      )
      .toBe(userIdA);
    const stageNameAfter = await pageA.evaluate(
      () => (window as any).__iinpublic_app?.getApp?.()?.currentUser?.stageName ?? '',
    );
    expect(stageNameAfter).toBe(stageNameBefore);

    // Conversation + prior message history survive the restart (same IndexedDB-backed Gun graph).
    await openConversationViaServer(pageA, userIdA, nameB, userIdB);
    await expect(pageA.locator('#conversation-messages .message-text')).not.toHaveCount(0);
  });
});
