import { chromium, Browser, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { afterSync } from '../../helpers/timing';
import {
  bootstrapUser,
  waitForIncomingTalkClusterOnLocalGun,
  waitForTabActive,
} from '../../helpers/talks-matching-flow';
import { createSimpleFlowTalk, goToChatrooms } from '../../helpers/broadcast-cancellation-helpers';
import {
  clickBroadcastUntilBulkAck,
  completeTalkInAppByAnswerIds,
  findIncomingTalkIdByTitle,
} from '../../helpers/talk-demo-ui';
import { gunBaseURL } from '../../helpers/ports';

test.describe('Pair-direct talk delivery over Gun mesh', () => {
  let browserTom: Browser;
  let browserJerry: Browser;

  test.beforeAll(async () => {
    test.setTimeout(120_000);
    browserTom = await chromium.launch({ headless: process.env.CI ? true : false });
    browserJerry = await chromium.launch({ headless: process.env.CI ? true : false });
    await clearGunForStage2Spec();
  });

  test.afterAll(async () => {
    await browserTom?.close().catch(() => {});
    await browserJerry?.close().catch(() => {});
    await clearGunForStage2Spec();
  });

  test('delivers talk to receiver local Gun without server incoming-talks inbox', async () => {
    test.setTimeout(120_000);
    const title = `Pair-direct mesh talk ${Date.now()}`;

    const tom = await bootstrapUser(browserTom, 'Tom', 'Tom P0');
    const jerry = await bootstrapUser(browserJerry, 'Jerry', 'Jerry P0');
    const pageTom = tom.page;
    const pageJerry = jerry.page;

    try {
      await expect
        .poll(() => pageTom.evaluate(() => !!window.__iinpublic_app?.getApp?.()?.isDirectTalkDeliveryEnabled?.()))
        .toBe(true);
      await expect
        .poll(() => pageJerry.evaluate(() => !!window.__iinpublic_app?.getApp?.()?.isDirectTalkDeliveryEnabled?.()))
        .toBe(true);

      await pageTom.click('.chatroom-item:has-text("Global")');
      await pageJerry.click('.chatroom-item:has-text("Global")');
      await afterSync();

      await createSimpleFlowTalk(pageTom, title, 'Yes', 'No', { sendToChatroom: false });
      await goToChatrooms(pageTom);
      await pageTom.click('.chatroom-item:has-text("Global")');
      await afterSync();
      await clickBroadcastUntilBulkAck(pageTom);

      const jerryId = await pageJerry.evaluate(() =>
        String(window.__iinpublic_app?.getApp?.()?.currentUser?.id || ''),
      );
      expect(jerryId).toBeTruthy();

      const serverInbox = await pageJerry.context().request.get(
        `${gunBaseURL()}/api/users/${encodeURIComponent(jerryId)}/incoming-talks`,
        { headers: { 'Cache-Control': 'no-cache' } },
      );
      expect(serverInbox.ok()).toBe(true);
      expect(serverInbox.headers()['x-p0-direct-talk-delivery']).toBe('1');
      const serverClusters = await serverInbox.json();
      expect(Array.isArray(serverClusters) ? serverClusters.length : -1).toBe(0);

      await waitForIncomingTalkClusterOnLocalGun(pageJerry, title, { timeout: 60_000, polling: 500 });

      await pageJerry.click('.nav-btn[data-view="talks"]');
      await waitForTabActive(pageJerry, 'talks');
      await afterSync();
      await expect(pageJerry.locator('.talk-list-item[data-role="incoming"]', { hasText: title })).toBeVisible({
        timeout: 15_000,
      });

      const talkId = await findIncomingTalkIdByTitle(pageJerry, title);
      const talkData = await pageJerry.evaluate(async (id) => {
        const app = window.__iinpublic_app?.getApp?.();
        return app?.talkService?.getTalkWithRetry?.(id, { attempts: 30, gapMs: 250 }) ?? null;
      }, talkId);
      expect(talkData).toBeTruthy();
      const matchAnswerId = String(talkData.questions?.[0]?.answers?.[0]?.id || '');
      expect(matchAnswerId).toBeTruthy();

      await completeTalkInAppByAnswerIds(pageJerry, talkId, talkData, [matchAnswerId], 'match');

      const tomId = await pageTom.evaluate(() =>
        String(window.__iinpublic_app?.getApp?.()?.currentUser?.id || ''),
      );
      const pairId = [tomId, jerryId].sort().join('__');
      await expect
        .poll(
          () =>
            pageTom.evaluate(
              async ({ p, t }) => {
                const app = window.__iinpublic_app?.getApp?.();
                const gun = app?.gunService?.getGun?.();
                if (!gun) return { pairResponses: 0, legacyResponses: 0 };
                const collect = (root: any) =>
                  new Promise<number>((resolve) => {
                    let count = 0;
                    const ref = root.map();
                    ref.once((raw: unknown, key: string) => {
                      if (raw && key && !key.startsWith('_')) count += 1;
                    });
                    setTimeout(() => {
                      try {
                        ref.off();
                      } catch {
                        /* ignore */
                      }
                      resolve(count);
                    }, 500);
                  });
                const pairResponses = await collect(gun.get('pairTalkResponses').get(p).get(t));
                const legacyResponses = await collect(gun.get(`talks/${t}`).get('responses'));
                return { pairResponses, legacyResponses };
              },
              { p: pairId, t: talkId },
            ),
          { timeout: 20_000, intervals: [500, 1000] },
        )
        .toEqual({ pairResponses: 1, legacyResponses: 0 });
    } finally {
      await tom.context.close().catch(() => {});
      await jerry.context.close().catch(() => {});
    }
  });
});
