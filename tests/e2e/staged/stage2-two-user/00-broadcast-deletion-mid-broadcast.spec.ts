/**
 * Talk deletion by creator mid-broadcast (register batch delay).
 */
import { chromium, Browser } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { afterAction, afterNav, afterSync, headless } from '../../helpers/timing';
import { confirmBroadcastTagPreambleIfVisible } from '../../helpers/broadcast-preamble';
import { clickBroadcastUntilBulkAck } from '../../helpers/talk-demo-ui';
import { isDirectTalkDeliveryE2e } from '../../helpers/ports';

import { bootstrapUser, waitForIncomingTalkClusterOnServer, incomingClustersIncludeTitleForUser } from '../../helpers/talks-matching-flow';
import {
  createSimpleFlowTalk,
  getCurrentUserId,
  goToChatrooms,
  waitForBroadcastBulkAckMinSent,
} from '../../helpers/broadcast-cancellation-helpers';
test.describe('Broadcast cancellation — talk deletion mid-flight', () => {
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

  test('talk deletion by creator mid-broadcast cancels remaining talk delivery', async () => {
    const talkTitles = Array.from({ length: 6 }, (_, i) => `Deletion Cancel Talk ${i + 1}`);
    const tomStage = 'Tom DelCancel';
    const jerryStage = 'Jerry DelCancel';

    const tom = await bootstrapUser(browserTom, 'Tom', tomStage);
    const jerry = await bootstrapUser(browserJerry, 'Jerry', jerryStage);

    const pageTom = tom.page;
    const pageJerry = jerry.page;

    try {
      const talkIds: string[] = [];
      for (const t of talkTitles) {
        await createSimpleFlowTalk(pageTom, t);
        const tid = await pageTom.evaluate((title) => {
          const raw = localStorage.getItem('myTalks');
          const myTalks = raw ? (JSON.parse(raw) as Record<string, any>) : {};
          return Object.entries(myTalks).find(([, v]) => v?.title === title)?.[0] ?? '';
        }, t);
        expect(tid).toBeTruthy();
        talkIds.push(tid);
      }

      await goToChatrooms(pageTom);

      const talkIdToDelete = talkIds[5];

      let registerCount = 0;
      let resolveReadyToDelete: (() => void) | null = null;
      const readyToDelete = new Promise<void>((resolve) => {
        resolveReadyToDelete = resolve;
      });

      if (!isDirectTalkDeliveryE2e()) {
        await pageTom.route('**/api/talks/*/register-receivers-for-broadcast', async (route) => {
          registerCount += 1;
          if (registerCount === 5) {
            resolveReadyToDelete?.();
            await new Promise((r) => setTimeout(r, 10_000));
          }
          await route.continue();
        });
        const { broadcastFromGlobalChatroom } = await import('../../helpers/talk-demo-ui');
        await broadcastFromGlobalChatroom(pageTom, { requirePreambleUi: true });
      } else {
        await pageTom.route('**/api/talks/*/register-receivers-for-broadcast', async (route) => {
          registerCount += 1;
          if (registerCount === 5) {
            resolveReadyToDelete?.();
            await new Promise((r) => setTimeout(r, 10_000));
          }
          await route.continue();
        });
        await clickBroadcastUntilBulkAck(pageTom);
      }
      await afterAction();

      await readyToDelete;
      await afterAction();

      await pageTom.evaluate((talkId) => {
        const raw = localStorage.getItem('myTalks');
        const myTalks = raw ? JSON.parse(raw) : {};
        delete myTalks[talkId];
        localStorage.setItem('myTalks', JSON.stringify(myTalks));
        (window as any).__iinpublic_app?.getApp?.()?.uiManager?.displayTalksList?.();
      }, talkIdToDelete);
      await afterAction();
      await pageTom.click('.nav-btn[data-view="chatrooms"]');
      await afterNav();
      await afterSync();

      await waitForBroadcastBulkAckMinSent(pageTom, { receivers: 1, minSent: 1 });

      await waitForIncomingTalkClusterOnServer(pageJerry, talkTitles[4], { timeout: 60_000, polling: 500 });

      const jerryId = await getCurrentUserId(pageJerry);
      await expect
        .poll(
          async () => incomingClustersIncludeTitleForUser(pageJerry, jerryId, talkTitles[5]),
          { timeout: 35_000, intervals: [500], message: 'talk 6 should be cancelled mid-broadcast' },
        )
        .toBe(false);
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
