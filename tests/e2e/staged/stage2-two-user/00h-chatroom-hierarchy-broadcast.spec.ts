import { chromium, Browser, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { selectTalkEditorType } from '../../helpers/talk-editor-e2e';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { afterSync, delay, headless } from '../../helpers/timing';
import { bootstrapUser, incomingClustersIncludeTitleForUser, waitForTabActive } from '../../helpers/talks-matching-flow';
import { waitForBroadcastBulkAck } from '../../helpers/broadcast-ack';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';
import { AREA_PLACES, ensureChatroomList, openAreaRoomAt } from '../../helpers/chatroom-nav';

/**
 * Rooms are Global → L1 region tiles (labeled by continent) → GPS grid cells — no country/state rooms.
 * A remote grid room is opened the way a map tap does it (`openAreaRoomAt`).
 */
async function openGrid(page: Page, place: { latitude: number; longitude: number }): Promise<string> {
  await ensureChatroomList(page);
  await afterSync();
  const roomId = await openAreaRoomAt(page, place);
  await afterSync();
  return roomId;
}

/** Wait until Gun lists exactly `peerCount` other active members in `chatroomId` (excludes self). */
async function waitForGunPeerCountInRoom(page: Page, chatroomId: string, peerCount: number): Promise<void> {
  await expect
    .poll(
      async () => {
        const count = await page.evaluate(async ({ room }) => {
          const app = (window as unknown as { __iinpublic_app?: { getApp: () => any } }).__iinpublic_app?.getApp?.();
          const me = String(app?.currentUser?.id || '').trim();
          const ids: string[] = (await app?.chatroomService?.getActiveMembers(room)) || [];
          return ids.filter((id: string) => id && id !== me).length;
        }, { room: chatroomId });
        return count === peerCount ? 'ok' : String(count);
      },
      { timeout: 90_000, intervals: [500, 1000, 2000] },
    )
    .toBe('ok');
}

async function createSimpleFlowTalk(page: Page, title: string): Promise<void> {
  await page.click('.nav-btn[data-view="talks"]');
  await waitForTabActive(page, 'talks');
  await afterSync();
  await page.click('#create-talk-btn');
  await page.waitForSelector('#talk-editor-form');
  await page.fill('#talk-title', title);
  await selectTalkEditorType(page, 'flow');
  const q = page.locator('.question-item').first();
  await q.locator('.question-text').fill('Grid room broadcast smoke?');
  await q.locator('.answer-item').nth(0).locator('.answer-text').fill('Yes');
  await q.locator('.answer-item').nth(0).locator('.answer-next').selectOption('noticed');
  await q.locator('.answer-item').nth(1).locator('.answer-text').fill('No');
  await q.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');
  await page.click('#talk-submit-btn');
  await afterSync();
}

test.describe('GPS grid room navigation and room-scoped broadcast', () => {
  let browserTom: Browser;
  let browserJerry: Browser;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage2Spec();
    browserTom = await chromium.launch({
      headless,
      slowMo: headless ? 0 : delay(50, 120),
      args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=0,0', '--window-size=640,1100', '--force-device-scale-factor=1'],
    });
    browserJerry = await chromium.launch({
      headless,
      slowMo: headless ? 0 : delay(50, 120),
      args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=640,0', '--window-size=640,1100', '--force-device-scale-factor=1'],
    });
  });

  test.beforeEach(async () => {
    await clearGunForStage2Spec();
  });

  test.afterAll(async () => {
    await browserTom?.close().catch(() => {});
    await browserJerry?.close().catch(() => {});
    await clearGunForStage2Spec();
  });

  test('Both peers in the same remote grid room; broadcast there reaches the peer', async () => {
    const tom = await bootstrapUser(browserTom, 'Tom', 'Tom');
    const jerry = await bootstrapUser(browserJerry, 'Jerry', 'Jerry');
    const pageTom = tom.page;
    const pageJerry = jerry.page;
    try {
      const room = await openGrid(pageTom, AREA_PLACES.london);
      await expect(pageTom.locator('#current-chatroom-title')).toContainText('Around London', { timeout: 20_000 });

      await openGrid(pageJerry, AREA_PLACES.london);
      await expect(pageJerry.locator('#current-chatroom-title')).toContainText('Around London', { timeout: 20_000 });

      await waitForGunPeerCountInRoom(pageTom, room, 1);
      await waitForGunPeerCountInRoom(pageJerry, room, 1);

      await createSimpleFlowTalk(pageTom, 'Grid room broadcast');

      await openGrid(pageTom, AREA_PLACES.london);
      const delivery = await pageTom.evaluate(async () => {
        const app = (window as any).__iinpublic_app?.getApp?.();
        if (!app?.deliverPendingBroadcastTalksForE2e) throw new Error('deliverPendingBroadcastTalksForE2e unavailable');
        return app.deliverPendingBroadcastTalksForE2e(1);
      });
      expect(delivery).toMatchObject({ talksSent: 1, receivers: 1 });

      await pageJerry.click('.nav-btn[data-view="talks"]');
      await waitForTabActive(pageJerry, 'talks');
      await afterSync();
      await expect(
        pageJerry.locator('.talk-list-item[data-role="incoming"]').filter({
          hasText: 'Grid room broadcast',
        }),
      ).toBeVisible({ timeout: 60_000 });
    } finally {
      await pageTom.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup()).catch(() => {});
      await pageJerry.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup()).catch(() => {});
      await tom.context.close().catch(() => {});
      await jerry.context.close().catch(() => {});
    }
  });

  test('Broadcaster in one grid room does not reach a peer in a different grid room', async () => {
    const tom = await bootstrapUser(browserTom, 'TomLDN', 'Tom');
    const jerry = await bootstrapUser(browserJerry, 'JerryTYO', 'Jerry');
    const pageTom = tom.page;
    const pageJerry = jerry.page;
    try {
      await openGrid(pageTom, AREA_PLACES.london);
      await expect(pageTom.locator('#current-chatroom-title')).toContainText('Around London', { timeout: 20_000 });

      await openGrid(pageJerry, AREA_PLACES.tokyo);
      await expect(pageJerry.locator('#current-chatroom-title')).toContainText('Around Tokyo', { timeout: 20_000 });

      await createSimpleFlowTalk(pageTom, 'Grid-room-only isolation');

      // Re-enter the room explicitly, then use the E2E delivery path directly — the click-based
      // broadcast helper re-clicks the Chatrooms tab and can fall back to Global.
      await openGrid(pageTom, AREA_PLACES.london);
      const delivery = await pageTom.evaluate(async () => {
        const app = (window as any).__iinpublic_app?.getApp?.();
        return app.deliverPendingBroadcastTalksForE2e(0, { skipDeliveryAcks: true });
      });
      // Tom is the only Gun member in the London grid room; Jerry is in the Tokyo one (FR-BM-7).
      expect(delivery).toMatchObject({ receivers: 0 });
      await waitForBroadcastBulkAck(pageTom, { talksSent: 1, receivers: 0 });

      const jerryId = await pageJerry.evaluate(
        () =>
          (
            window as unknown as {
              __iinpublic_app?: { getApp: () => { currentUser?: { id: string } } };
            }
          ).__iinpublic_app?.getApp?.()?.currentUser?.id || '',
      );
      expect(jerryId.length).toBeGreaterThan(0);

      await expect
        .poll(
          async () =>
            (await incomingClustersIncludeTitleForUser(pageJerry, jerryId, 'Grid-room-only isolation'))
              ? 'found'
              : 'absent',
          {
            timeout: 25_000,
            intervals: [500],
            message: 'peer in another grid room must not get IN registration from this broadcast',
          },
        )
        .toBe('absent');
    } finally {
      await pageTom.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup()).catch(() => {});
      await pageJerry.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup()).catch(() => {});
      await tom.context.close().catch(() => {});
      await jerry.context.close().catch(() => {});
    }
  });

  test('Room tree shows continent-labeled region tiles but no country rooms; an area room opens by coordinates', async () => {
    const tom = await bootstrapUser(browserTom, 'TomGrid', 'Tom');
    const pageTom = tom.page;
    try {
      await ensureChatroomList(pageTom);
      // Continents stay as the visible hierarchy; no country/state/city rows.
      for (const [tile, label] of [['tile_1_2_1', 'North America'], ['tile_1_3_3', 'Europe'], ['tile_1_2_6', 'Asia']]) {
        await expect(pageTom.locator(`.chatroom-item[data-chatroom-id="${tile}"][data-level="1"]`)).toContainText(label);
      }
      for (const continentRoom of ['north-america', 'europe', 'asia']) {
        await expect(pageTom.locator(`.chatroom-item[data-chatroom-id="${continentRoom}"]`)).toHaveCount(0);
      }
      for (const named of ['usa', 'california', 'germany', 'japan']) {
        await expect(pageTom.locator(`.chatroom-item[data-chatroom-id="${named}"]`)).toHaveCount(0);
      }
      await openGrid(pageTom, AREA_PLACES.tokyo);
      await expect(pageTom.locator('#current-chatroom-title')).toContainText('📍 Around Tokyo', { timeout: 20_000 });
      await expect(pageTom.locator('#current-chatroom-status')).toBeVisible();
    } finally {
      await pageTom.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup()).catch(() => {});
      await tom.context.close().catch(() => {});
    }
  });
});
