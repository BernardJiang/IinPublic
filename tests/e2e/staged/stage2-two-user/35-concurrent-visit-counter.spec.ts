/**
 * Concurrent room visits are both counted (docs/TODO.md L1).
 *
 * Regression gate for the shared-scalar read-modify-write this replaced: two users
 * joining the same room at the same time each read `visitCount` = N and both wrote
 * N+1, so Gun's last-write-wins silently dropped one visit. The CRDT G-Counter gives
 * each user their own slot, so there is nothing to race on.
 *
 * Asserted against the server graph rather than the badge, because the badge renders
 * from a published aggregate that lags; the graph is the source of truth.
 */
import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { afterLoad, afterSync, headless } from '../../helpers/timing';
import { attachE2eBrowserTabLabel } from '../../helpers/e2e-tab-title';
import { bootstrapUser } from '../../helpers/talks-matching-flow';
import { gunBaseURL } from '../../helpers/ports';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';
import { readVisitCounterState, visitTotals } from '../../../../src/shared/visit-counter';

const ROOM_ID = 'global';

/** Read the room's G-Counter slots straight out of the server graph. */
async function readRoomVisitTotals(): Promise<{ visitCount: number; uniqueVisitorCount: number }> {
  const res = await fetch(`${gunBaseURL()}/api/test/export-snapshot`);
  expect(res.ok).toBeTruthy();
  const snapshot = (await res.json()) as { gunGraph?: Record<string, any> };
  const graph = snapshot.gunGraph || {};
  const prefix = `chatrooms/${ROOM_ID}/visitCounter/`;
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
    const before = await readRoomVisitTotals();

    // Launch both joins together — this is the interleaving that lost an increment
    // under the old shared-scalar counter.
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
    await afterSync();

    await expect
      .poll(async () => (await readRoomVisitTotals()).uniqueVisitorCount, { timeout: 20_000 })
      .toBeGreaterThanOrEqual(before.uniqueVisitorCount + 2);

    const after = await readRoomVisitTotals();
    // Both visits survived — the old counter would report +1 here on an unlucky interleave.
    expect(after.visitCount).toBeGreaterThanOrEqual(before.visitCount + 2);
    // Two distinct users, so exactly two new slots regardless of how many times each joined.
    expect(after.uniqueVisitorCount).toBe(before.uniqueVisitorCount + 2);
  });

  test('a repeat visit by the same user raises visits but not unique visitors', async () => {
    const before = await readRoomVisitTotals();

    await pageAlice.reload();
    await afterLoad();
    await afterSync();

    await expect
      .poll(async () => (await readRoomVisitTotals()).visitCount, { timeout: 20_000 })
      .toBeGreaterThan(before.visitCount);

    const after = await readRoomVisitTotals();
    expect(after.uniqueVisitorCount).toBe(before.uniqueVisitorCount);
  });
});
