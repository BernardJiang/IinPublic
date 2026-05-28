/**
 * Broadcast cancellation: creator clears all talks mid-flight (register batch delay).
 */
import { chromium, Browser } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { afterAction, afterNav, afterSync, headless } from '../../helpers/timing';
import { confirmBroadcastTagPreambleIfVisible } from '../../helpers/broadcast-preamble';
import { bootstrapUser } from '../../helpers/talks-matching-flow';
import {
  createSimpleFlowTalk,
  goToChatrooms,
  waitForBroadcastBulkAckMinSent,
} from '../../helpers/broadcast-cancellation-helpers';

test.describe('Broadcast cancellation — clear all mid-flight', () => {
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

  test('broadcast loop remains stable when creator clears all talks mid-flight', async () => {
    const talkTitles = Array.from({ length: 6 }, (_, i) => `Broadcast Abort Talk ${i + 1}`);
    const tomStage = 'Tom Abort';
    const jerryStage = 'Jerry Abort';

    const tom = await bootstrapUser(browserTom, 'Tom', tomStage);
    const jerry = await bootstrapUser(browserJerry, 'Jerry', jerryStage);
    const pageTom = tom.page;
    const pageJerry = jerry.page;

    try {
      for (const t of talkTitles) {
        await createSimpleFlowTalk(pageTom, t);
        const tid = await pageTom.evaluate((title) => {
          const raw = localStorage.getItem('myTalks');
          const myTalks = raw ? (JSON.parse(raw) as Record<string, any>) : {};
          return Object.entries(myTalks).find(([, v]) => v?.title === title)?.[0] ?? '';
        }, t);
        expect(tid).toBeTruthy();
      }

      await goToChatrooms(pageTom);

      let registerCount = 0;
      let resolveReadyToClear: (() => void) | null = null;
      const readyToClear = new Promise<void>((resolve) => {
        resolveReadyToClear = resolve;
      });

      await pageTom.route('**/api/talks/*/register-receivers-for-broadcast', async (route) => {
        registerCount += 1;
        if (registerCount === 1) {
          resolveReadyToClear?.();
          // Keep one in-flight registration open long enough for clear-all to interrupt subsequent batches.
          await new Promise((r) => setTimeout(r, 3_000));
        }
        await route.continue();
      });

      await pageTom.click('#broadcast-talk-btn');
      await confirmBroadcastTagPreambleIfVisible(pageTom);
      await afterAction();

      await readyToClear;
      await afterAction();

      await pageTom.evaluate(() => {
        localStorage.removeItem('myTalks');
        (window as any).__iinpublic_app?.getApp?.()?.uiManager?.displayTalksList?.();
      });
      await afterAction();
      await pageTom.click('.nav-btn[data-view="chatrooms"]');
      await afterNav();
      await afterSync();

      await waitForBroadcastBulkAckMinSent(pageTom, { receivers: 1, minSent: 0 });

      const talksRaw = await pageTom.evaluate(() => localStorage.getItem('myTalks'));
      expect(talksRaw).toBeNull();
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
