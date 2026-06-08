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
import { isMeshTalkDeliveryE2e } from '../../helpers/ports';

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
      await expect
        .poll(() => pageTom.evaluate(() => !!window.__iinpublic_app?.getApp?.()?.isMeshTalkDeliveryEnabled?.()))
        .toBe(true);
      await expect
        .poll(() => pageJerry.evaluate(() => !!window.__iinpublic_app?.getApp?.()?.isMeshTalkDeliveryEnabled?.()))
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

      await waitForIncomingTalkClusterOnLocalGun(pageJerry, title, { timeout: 60_000, polling: 500 });

      const meshMode = isMeshTalkDeliveryE2e();
      const directDeliveryGraph = await pageJerry.evaluate(async (receiverId) => {
        const app = window.__iinpublic_app?.getApp?.();
        const gun = app?.gunService?.getGun?.();
        if (!gun) {
          return {
            offerCount: 0,
            offersWithBody: 0,
            ownerIndexCount: 0,
            legacyIndexCount: 0,
            announcementCount: 0,
            legacyRoomTalkCount: 0,
          };
        }
        const collect = (root: any) =>
          new Promise<any[]>((resolve) => {
            const rows: any[] = [];
            const ref = root.map();
            ref.once((raw: unknown, key: string) => {
              if (raw && key && !key.startsWith('_')) rows.push(raw);
            });
            setTimeout(() => {
              try {
                ref.off();
              } catch {
                /* ignore */
              }
              resolve(rows);
            }, 500);
          });
        const offers = await collect(gun.get('peerTalkOffers').get(receiverId));
        const ownerIndex = await collect(gun.get('ownerIncomingTalkIndex').get(receiverId));
        const legacyIndex = await collect(gun.get('incomingTalksByUser').get(receiverId));
        const announcements = await collect(gun.get('chatrooms').get('global').get('announcements'));
        const legacyRoomTalks = await collect(gun.get('chatrooms').get('global').get('talks'));
        return {
          offerCount: offers.length,
          offersWithBody: offers.filter((offer) => !!offer?.talkData).length,
          ownerIndexCount: ownerIndex.length,
          legacyIndexCount: legacyIndex.length,
          announcementCount: announcements.length,
          legacyRoomTalkCount: legacyRoomTalks.length,
        };
      }, jerryId);
      if (meshMode) {
        expect(directDeliveryGraph.offerCount).toBe(0);
        expect(directDeliveryGraph.offersWithBody).toBe(0);
        expect(directDeliveryGraph.announcementCount).toBe(0);
      } else {
        expect(directDeliveryGraph.offerCount).toBeGreaterThan(0);
        expect(directDeliveryGraph.offersWithBody).toBe(0);
        expect(directDeliveryGraph.announcementCount).toBeGreaterThan(0);
      }
      expect(directDeliveryGraph.ownerIndexCount).toBeGreaterThan(0);
      expect(directDeliveryGraph.legacyIndexCount).toBe(0);
      expect(directDeliveryGraph.legacyRoomTalkCount).toBe(0);

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
                if (!gun) return { pairResponses: 0, legacyResponses: 0, encryptedResponses: 0, plaintextLeaks: 0 };
                const collect = (root: any) =>
                  new Promise<any[]>((resolve) => {
                    const rows: any[] = [];
                    const ref = root.map();
                    ref.once((raw: unknown, key: string) => {
                      if (raw && key && !key.startsWith('_')) rows.push(raw);
                    });
                    setTimeout(() => {
                      try {
                        ref.off();
                      } catch {
                        /* ignore */
                      }
                      resolve(rows);
                    }, 500);
                  });
                const pairResponses = await collect(gun.get('pairTalkResponses').get(p).get(t));
                const legacyResponses = await collect(gun.get(`talks/${t}`).get('responses'));
                const plaintextLeaks = pairResponses.filter((row) => {
                  const raw = JSON.stringify(row);
                  return Boolean(row?.answers || row?.responderName || row?.authorName || raw.includes('Yes'));
                }).length;
                return {
                  pairResponses: pairResponses.length,
                  legacyResponses: legacyResponses.length,
                  encryptedResponses: pairResponses.filter(
                    (row) => row?.encryption === 'sea-ecdh-v1' && typeof row?.payloadCiphertext === 'string',
                  ).length,
                  plaintextLeaks,
                };
              },
              { p: pairId, t: talkId },
            ),
          { timeout: 20_000, intervals: [500, 1000] },
        )
        .toEqual(
          meshMode
            ? { pairResponses: 0, legacyResponses: 0, encryptedResponses: 0, plaintextLeaks: 0 }
            : { pairResponses: 1, legacyResponses: 0, encryptedResponses: 1, plaintextLeaks: 0 },
        );
    } finally {
      await tom.context.close().catch(() => {});
      await jerry.context.close().catch(() => {});
    }
  });
});
