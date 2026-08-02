import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { afterAction, afterSync, headless } from '../../helpers/timing';
import {
  bootstrapUser,
  resetTalksMatchingSession,
  finalCleanupPages,
  waitForTabActive,
  incomingClustersIncludeTitleForUser,
} from '../../helpers/talks-matching-flow';
import {
  createAdultTalk,
  enterGlobalChatroom,
  getCurrentUserId,
  serverVouchAgeVerified,
} from '../../helpers/reputation-e2e-helpers';
import { clickBroadcastUntilBulkAck } from '../../helpers/talk-demo-ui';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';

test.describe('Reputation system — vouch threshold', () => {
  let browserTom: Browser;
  let browserJerry: Browser;
  let contextTom: BrowserContext | undefined;
  let contextJerry: BrowserContext | undefined;
  let pageTom: Page | undefined;
  let pageJerry: Page | undefined;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
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

  test.beforeEach(async () => {
    await resetTalksMatchingSession(
      { tom: pageTom, jerry: pageJerry },
      { tom: contextTom, jerry: contextJerry },
      clearGunForStage2Spec,
    );
    pageTom = pageJerry = undefined;
    contextTom = contextJerry = undefined;
  });

  test.afterAll(async () => {
    await finalCleanupPages(
      { tom: pageTom, jerry: pageJerry },
      { tom: contextTom, jerry: contextJerry },
    );
    await browserTom?.close().catch(() => {});
    await browserJerry?.close().catch(() => {});
    await clearGunForStage2Spec();
  });

  test('vouch votes accumulate to threshold (delivery flips at 3)', async () => {
    const tom = await bootstrapUser(browserTom, 'Tom', 'Tom');
    contextTom = tom.context;
    pageTom = tom.page;
    await afterSync();
    const jerry = await bootstrapUser(browserJerry, 'Jerry', 'Jerry');
    contextJerry = jerry.context;
    pageJerry = jerry.page;
    await afterSync();

    await enterGlobalChatroom(pageTom!);
    await enterGlobalChatroom(pageJerry!);

    const jerryUserId = await getCurrentUserId(pageJerry!);
    const adultTitles: string[] = [];

    for (let i = 1; i <= 3; i += 1) {
      await serverVouchAgeVerified(pageTom!, jerryUserId);
      await afterSync();

      const adultTitle = `E2E Adult Vote Step ${i} (${Date.now()})`;
      adultTitles.push(adultTitle);
      await createAdultTalk(pageTom!, adultTitle);

      await clickBroadcastUntilBulkAck(pageTom!, { minSent: i < 3 ? 0 : 1 });
      await afterAction();
      await waitForTabActive(pageTom!, 'chatrooms');

      const delivered = async (): Promise<boolean> =>
        incomingClustersIncludeTitleForUser(pageJerry!, jerryUserId, adultTitle);

      if (i < 3) {
        await expect
          .poll(delivered, { timeout: 10_000, intervals: [500] })
          .toBe(false);
      } else {
        await expect
          .poll(
            async () => {
              for (const title of adultTitles) {
                if (await incomingClustersIncludeTitleForUser(pageJerry!, jerryUserId, title)) {
                  return 'ok';
                }
              }
              return 'waiting';
            },
            { timeout: 20_000, intervals: [500, 1000] },
          )
          .toBe('ok');
      }
    }
  });
});
