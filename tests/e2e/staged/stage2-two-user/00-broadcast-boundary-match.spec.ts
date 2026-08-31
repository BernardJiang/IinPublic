/**
 * Talk matching across chatroom boundaries after switching rooms.
 */
import { chromium, Browser } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { afterSync, headless } from '../../helpers/timing';
import { waitForServerConversationBetween } from '../../helpers/conversation-e2e';
import { bootstrapUser, openIncomingTalkModal, waitForIncomingTalkClusterOnServer, waitForResponseModalClosed } from '../../helpers/talks-matching-flow';
import { createSimpleFlowTalk, goToChatrooms } from '../../helpers/broadcast-cancellation-helpers';
import {
  clickBroadcastUntilBulkAck,
  waitForBroadcastableTalkIds,
  waitForDistinctGunPeersExcludingSelf,
} from '../../helpers/talk-demo-ui';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';
import { ensureChatroomList } from '../../helpers/chatroom-nav';

const MATCH_ANSWER = 'Yes, lets play.';
const IGNORE_ANSWER = 'No thanks.';

test.describe('Broadcast — chatroom boundary matching', () => {
  let browserTom: Browser;
  let browserJerry: Browser;

  test.beforeAll(async () => {
    await clearGunForStage2Spec();
    browserTom = await chromium.launch({
      headless,
      args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=0,0', '--window-size=640,1100', '--force-device-scale-factor=1'],
    });
    browserJerry = await chromium.launch({
      headless,
      args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=640,0', '--window-size=640,1100', '--force-device-scale-factor=1'],
    });
  });

  test.afterAll(async () => {
    await browserTom?.close().catch(() => {});
    await browserJerry?.close().catch(() => {});
    await clearGunForStage2Spec();
  });

  test('talk matching still works across chatroom boundaries (answer after switching rooms)', async () => {
    test.setTimeout(180_000);
    const talkTitle = `Boundary Match Talk ${Date.now()}`;
    const tomStage = 'Tom Boundary';
    const jerryStage = 'Jerry Boundary';

    const tom = await bootstrapUser(browserTom, 'Tom', tomStage);
    const jerry = await bootstrapUser(browserJerry, 'Jerry', jerryStage);
    const pageTom = tom.page;
    const pageJerry = jerry.page;
    const tomUserId = await pageTom.evaluate(() =>
      String(window.__iinpublic_app?.getApp?.()?.currentUser?.id || ''),
    );
    const jerryUserId = await pageJerry.evaluate(() =>
      String(window.__iinpublic_app?.getApp?.()?.currentUser?.id || ''),
    );
    expect(tomUserId).toBeTruthy();
    expect(jerryUserId).toBeTruthy();

    try {
      await pageTom.click('.chatroom-item:has-text("Global")');
      await pageJerry.click('.chatroom-item:has-text("Global")');
      await afterSync();

      await createSimpleFlowTalk(pageTom, talkTitle, MATCH_ANSWER, IGNORE_ANSWER, {
        sendToChatroom: false,
      });

      await goToChatrooms(pageTom);
      await pageTom.click('.chatroom-item:has-text("Global")');
      await afterSync();
      await waitForBroadcastableTalkIds(pageTom, 15_000);
      await waitForDistinctGunPeersExcludingSelf(pageTom, 1, 20_000);
      await clickBroadcastUntilBulkAck(pageTom);

      await waitForIncomingTalkClusterOnServer(pageJerry, talkTitle, { timeout: 60_000, polling: 500 });

      await ensureChatroomList(pageJerry);
      await pageJerry.locator(`.chatroom-item[data-chatroom-id="north-america"]`).click();
      await afterSync();

      await openIncomingTalkModal(pageJerry, talkTitle);
      await pageJerry
        .locator(`input.choice-radio[data-answer-text="${MATCH_ANSWER}"][data-mode="manual"]`)
        .first()
        .click();

      await waitForResponseModalClosed(pageJerry);
      await afterSync();

      // Server conversation map is durable; localStorage can lag after room switch (parallel e2e).
      await waitForServerConversationBetween(pageJerry, jerryUserId, tomUserId, 120_000);
      await expect(pageJerry.locator('#status-bar-text')).toContainText(/match/i, { timeout: 30_000 });
    } finally {
      await pageTom
        .evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.())
        .catch(() => {});
      await pageJerry
        .evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.())
        .catch(() => {});
      await tom.context?.close().catch(() => {});
      await jerry.context?.close().catch(() => {});
    }
  });
});
