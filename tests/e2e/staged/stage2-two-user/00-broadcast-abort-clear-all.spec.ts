/**
 * Broadcast cancellation: creator clears all talks mid-flight (register batch delay).
 */
import { chromium, Browser } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { afterAction, afterNav, afterSync, headless } from '../../helpers/timing';
import { confirmBroadcastTagPreambleIfVisible } from '../../helpers/broadcast-preamble';
import {
  broadcastFromGlobalChatroom,
  clickBroadcastUntilBulkAck,
  deliverBroadcastViaRegisterApi,
} from '../../helpers/talk-demo-ui';

import { bootstrapUser } from '../../helpers/talks-matching-flow';
import {
  createSimpleFlowTalk,
  goToChatrooms,
  waitForBroadcastBulkAckMinSent,
} from '../../helpers/broadcast-cancellation-helpers';
import { isDirectTalkDeliveryE2e } from '../../helpers/ports';

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

      if (!isDirectTalkDeliveryE2e()) {
        let registerCount = 0;
        let resolveReadyToClear: (() => void) | null = null;
        const readyToClear = new Promise<void>((resolve) => {
          resolveReadyToClear = resolve;
        });

        await pageTom.route('**/api/talks/*/register-receivers-for-broadcast', async (route) => {
          registerCount += 1;
          if (registerCount === 1) {
            resolveReadyToClear?.();
            await new Promise((r) => setTimeout(r, 3_000));
          }
          await route.continue();
        });

        await broadcastFromGlobalChatroom(pageTom, { requirePreambleUi: true });
        await afterAction();

        await readyToClear;
      } else {
        await clickBroadcastUntilBulkAck(pageTom);
        await afterAction();
        await waitForBroadcastBulkAckMinSent(pageTom, { receivers: 1, minSent: 1 });
      }
      await afterAction();

      await pageTom.evaluate(() => {
        localStorage.removeItem('myTalks');
        (window as any).__iinpublic_app?.getApp?.()?.uiManager?.displayTalksList?.();
      });
      await afterAction();
      const preamble = pageTom.locator('[data-testid="broadcast-preamble-modal"]');
      if (await preamble.isVisible().catch(() => false)) {
        await pageTom.locator('[data-testid="broadcast-preamble-cancel"]').click({ timeout: 3000 }).catch(() => {});
        await preamble.waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
      }
      await pageTom.click('.nav-btn[data-view="chatrooms"]');
      await afterNav();
      await afterSync();
      if (isDirectTalkDeliveryE2e()) {
        await deliverBroadcastViaRegisterApi(pageTom, { minReceivers: 1 });
        await waitForBroadcastBulkAckMinSent(pageTom, { receivers: 1, minSent: 0 });
      } else {
        await pageTom.locator('#broadcast-talk-btn').click({ timeout: 10_000 });
        await afterAction();
        await confirmBroadcastTagPreambleIfVisible(pageTom);
        await waitForBroadcastBulkAckMinSent(pageTom, { receivers: 1, minSent: 0 });
      }

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
