/**
 * Talk matching across chatroom boundaries after switching rooms.
 */
import { chromium, Browser } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { afterAction, afterNav, afterSync, headless } from '../../helpers/timing';
import { confirmBroadcastTagPreambleIfVisible } from '../../helpers/broadcast-preamble';
import { bootstrapUser, openIncomingTalkModal, waitForIncomingTalkClusterOnServer, waitForResponseModalClosed } from '../../helpers/talks-matching-flow';
import { waitForStatusBarMatchCountAtLeast } from '../../helpers/durable-ui';
import { createSimpleFlowTalk, goToChatrooms, waitForBroadcastBulkAckMinSent } from '../../helpers/broadcast-cancellation-helpers';

const MATCH_ANSWER = 'Yes, lets play.';
const IGNORE_ANSWER = 'No thanks.';

test.describe('Broadcast — chatroom boundary matching', () => {
  let browserTom: Browser;
  let browserJerry: Browser;

  test.beforeAll(async () => {
    await clearGunForStage2Spec();
    browserTom = await chromium.launch({
      headless,
      args: ['--window-position=0,0', '--window-size=640,1100', '--force-device-scale-factor=1'],
    });
    browserJerry = await chromium.launch({
      headless,
      args: ['--window-position=640,0', '--window-size=640,1100', '--force-device-scale-factor=1'],
    });
  });

  test.afterAll(async () => {
    await browserTom?.close().catch(() => {});
    await browserJerry?.close().catch(() => {});
    await clearGunForStage2Spec();
  });

  test('talk matching still works across chatroom boundaries (answer after switching rooms)', async () => {
    const talkTitle = `Boundary Match Talk ${Date.now()}`;
    const tomStage = 'Tom Boundary';
    const jerryStage = 'Jerry Boundary';

    const tom = await bootstrapUser(browserTom, 'Tom', tomStage);
    const jerry = await bootstrapUser(browserJerry, 'Jerry', jerryStage);
    const pageTom = tom.page;
    const pageJerry = jerry.page;

    try {
      await createSimpleFlowTalk(pageTom, talkTitle, MATCH_ANSWER, IGNORE_ANSWER);

      await goToChatrooms(pageTom);

      let broadcastDone = false;
      let lastBroadcastError: unknown;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          await pageTom.click('#broadcast-talk-btn');
          await confirmBroadcastTagPreambleIfVisible(pageTom);
          await afterAction();
          await afterSync();
          await waitForBroadcastBulkAckMinSent(pageTom, { receivers: 1, minSent: 1 }, 180_000);
          broadcastDone = true;
          break;
        } catch (error) {
          lastBroadcastError = error;
          await afterSync();
        }
      }
      if (!broadcastDone) {
        throw lastBroadcastError instanceof Error
          ? lastBroadcastError
          : new Error('Broadcast did not complete successfully after retry');
      }

      await waitForIncomingTalkClusterOnServer(pageJerry, talkTitle, { timeout: 120_000, polling: 500 });

      await pageJerry.click('.nav-btn[data-view="chatrooms"]');
      await afterNav();
      await pageJerry.locator(`.chatroom-item[data-chatroom-id="north-america"]`).click();
      await afterSync();

      await openIncomingTalkModal(pageJerry, talkTitle);
      await pageJerry
        .locator(`input.choice-radio[data-answer-text="${MATCH_ANSWER}"][data-mode="manual"]`)
        .first()
        .click();

      await waitForStatusBarMatchCountAtLeast(pageJerry, 1, 60_000);
      await waitForResponseModalClosed(pageJerry);
      await afterSync();

      await expect
        .poll(
          async () =>
            pageJerry.evaluate((stageName: string) => {
              const conversations = JSON.parse(localStorage.getItem('myConversations') || '{}');
              return Object.values(conversations).some((conversation: any) => conversation?.otherUserName === stageName);
            }, tomStage),
          { timeout: 15_000 },
        )
        .toBe(true);
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
