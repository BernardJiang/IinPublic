/**
 * Concurrent Place visits are both counted (docs/TODO.md L1). Nearby is each phone's own list and
 * has no visit counter (§3.7), so the counter lives on Places.
 *
 * Regression gate for the shared-scalar read-modify-write this replaced: two users
 * joining the same Place at the same time each read `visitCount` = N and both wrote
 * N+1, so Gun's last-write-wins silently dropped one visit. The CRDT G-Counter gives
 * each user their own slot, so there is nothing to race on.
 *
 * Asserted against the server graph rather than the badge, because the badge renders
 * from a published aggregate that lags; the graph is the source of truth.
 */
import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { afterLoad, afterNav, afterSync, headless } from '../../helpers/timing';
import { attachE2eBrowserTabLabel } from '../../helpers/e2e-tab-title';
import { bootstrapUser } from '../../helpers/talks-matching-flow';
import { gunBaseURL } from '../../helpers/ports';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';
import { readVisitCounterState, visitTotals } from '../../../../src/shared/visit-counter';

/** Read the room's G-Counter slots straight out of the server graph. */
async function readRoomVisitTotals(roomId: string): Promise<{ visitCount: number; uniqueVisitorCount: number }> {
  const res = await fetch(`${gunBaseURL()}/api/test/export-snapshot`);
  expect(res.ok).toBeTruthy();
  const snapshot = (await res.json()) as { gunGraph?: Record<string, any> };
  const graph = snapshot.gunGraph || {};
  const prefix = `chatrooms/${roomId}/visitCounter/`;
  const slots: Record<string, unknown> = {};
  for (const [soul, node] of Object.entries(graph)) {
    if (!soul.startsWith(prefix)) continue;
    slots[soul.slice(prefix.length)] = node;
  }
  return visitTotals(readVisitCounterState(slots));
}

test.describe('Room visit counter: concurrent joins', () => {
  let browserAlice: Browser;
  let browserBob: Browser;
  let contextAlice: BrowserContext;
  let contextBob: BrowserContext;
  let pageAlice: Page;
  let pageBob: Page;
  /** The Place Alice creates; both then enter it at the same moment. */
  let roomId = '';
  const currentRoomOf = (page: Page) =>
    page.evaluate(() => String((window as any).__iinpublic_app?.getApp?.()?.currentChatroomId || ''));
  const enter = (page: Page, id: string) =>
    page.evaluate((target) => (window as any).__iinpublic_app?.getApp?.()?.uiManager?.emit('chatroomChanged', target), id);
  const goHome = async (page: Page) => {
    await page.click('#return-home-btn');
    await afterNav();
    await expect.poll(() => currentRoomOf(page), { timeout: 15_000 }).toBe('nearby-v3');
  };

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage2Spec();
    browserAlice = await chromium.launch({
      headless,
      args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=0,0', '--window-size=640,1100', '--force-device-scale-factor=1'],
    });
    browserBob = await chromium.launch({
      headless,
      args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=640,0', '--window-size=640,1100', '--force-device-scale-factor=1'],
    });
  });

  test.afterAll(async () => {
    await pageAlice?.close().catch(() => {});
    await pageBob?.close().catch(() => {});
    await contextAlice?.close().catch(() => {});
    await contextBob?.close().catch(() => {});
    await browserAlice?.close().catch(() => {});
    await browserBob?.close().catch(() => {});
    await clearGunForStage2Spec();
  });

  test('two simultaneous joins are both counted, unique = 2', async () => {
    const [alice, bob] = await Promise.all([
      bootstrapUser(browserAlice, 'Alice', 'Alice'),
      bootstrapUser(browserBob, 'Bob', 'Bob'),
    ]);
    contextAlice = alice.context;
    pageAlice = alice.page;
    contextBob = bob.context;
    pageBob = bob.page;
    attachE2eBrowserTabLabel(pageAlice, 'Alice');
    attachE2eBrowserTabLabel(pageBob, 'Bob');
    await afterLoad();

    // Alice creates a Place (her first visit), then goes back to Nearby.
    await pageAlice.click('#create-custom-chatroom-btn');
    await afterNav();
    await pageAlice.locator('[data-testid="custom-room-name-input"]').fill(`Visit Counter Place ${Date.now()}`);
    await pageAlice.locator('[data-testid="custom-room-submit-btn"]').click();
    await expect.poll(() => currentRoomOf(pageAlice), { timeout: 15_000 }).toMatch(/^place_/);
    roomId = await currentRoomOf(pageAlice);
    await goHome(pageAlice);
    await expect.poll(async () => (await readRoomVisitTotals(roomId)).visitCount, { timeout: 20_000 }).toBe(1);
    const before = await readRoomVisitTotals(roomId);

    // Both enter together — the interleaving that lost an increment under the old shared-scalar
    // counter.
    await Promise.all([enter(pageAlice, roomId), enter(pageBob, roomId)]);
    await expect.poll(() => currentRoomOf(pageAlice), { timeout: 15_000 }).toBe(roomId);
    await expect.poll(() => currentRoomOf(pageBob), { timeout: 15_000 }).toBe(roomId);
    await afterSync();

    await expect
      .poll(async () => (await readRoomVisitTotals(roomId)).visitCount, { timeout: 20_000 })
      .toBeGreaterThanOrEqual(before.visitCount + 2);
    // Two distinct users: Alice's slot and Bob's new one.
    expect((await readRoomVisitTotals(roomId)).uniqueVisitorCount).toBe(2);
  });

  test('a repeat visit by the same user raises visits but not unique visitors', async () => {
    expect(roomId).toMatch(/^place_/);
    const before = await readRoomVisitTotals(roomId);

    await goHome(pageAlice);
    await enter(pageAlice, roomId);
    await expect.poll(() => currentRoomOf(pageAlice), { timeout: 15_000 }).toBe(roomId);
    await afterSync();

    await expect
      .poll(async () => (await readRoomVisitTotals(roomId)).visitCount, { timeout: 20_000 })
      .toBeGreaterThan(before.visitCount);

    const after = await readRoomVisitTotals(roomId);
    expect(after.uniqueVisitorCount).toBe(before.uniqueVisitorCount);
  });
});
