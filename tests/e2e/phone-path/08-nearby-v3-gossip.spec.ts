/**
 * Nearby v3 phase 2 (docs/design/nearby-and-place-chatrooms.md §3.7) on phone-like nodes: with
 * `?nearby_v3=1`, each device signs a card, the hub introduces the two to each other, and a gossip
 * swap crosses a real WebRTC link that the receiving side opened because of a signed knock.
 * One-sided lists (a knock from someone the receiver does not list) are pinned by
 * src/test/unit/nearby-v3-link.test.ts.
 */
import { expect, test } from '@playwright/test';
import { closeUsers, openUser, resetPhonePath, userId, type JourneyUser } from './phone-path-helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Diagnostics = {
  list: Array<{ userId: string; distanceMeters: number }>;
  card: string | null;
  stats: { swaps: number; failedSwaps: number; busy: number; answered: number; size: number };
};

const diagnostics = (user: JourneyUser): Promise<Diagnostics | null> =>
  user.page.evaluate(() => (window as any).__iinpublicNearbyV3?.() ?? null);

test.describe('Nearby v3: personal lists and a gossip swap between two phones', () => {
  let alice: JourneyUser | undefined;
  let bob: JourneyUser | undefined;

  test.beforeEach(async ({ request }) => {
    await resetPhonePath(request);
  });

  test.afterEach(async () => {
    await closeUsers(alice, bob);
    alice = bob = undefined;
  });

  test('cards → hub introductions → each lists the other → a swap over a knocked link', async ({ browser }) => {
    test.setTimeout(180_000);
    alice = await openUser(browser, 'Alice', 'phoneA', { extraQuery: { nearby_v3: '1' } });
    bob = await openUser(browser, 'Bob', 'phoneB', { extraQuery: { nearby_v3: '1' } });
    const [aliceId, bobId] = [await userId(alice.page), await userId(bob.page)];

    // Bob may have asked the hub before Alice's card reached it; an empty list asks again.
    await expect.poll(async () => (await diagnostics(alice!))?.list.map((entry) => entry.userId) ?? [],
      { timeout: 60_000, message: 'Alice should list Bob' }).toEqual([bobId]);
    await expect.poll(async () => (await diagnostics(bob!))?.list.map((entry) => entry.userId) ?? [],
      { timeout: 90_000, message: 'Bob should list Alice' }).toEqual([aliceId]);
    expect((await diagnostics(alice))!.list[0]!.distanceMeters).toBe(0);

    const before = (await diagnostics(bob))!.stats.answered;
    await alice.page.evaluate(() => (window as any).__iinpublic_app.getApp().nearbyV3.service.gossipNow());
    const after = await diagnostics(alice);
    expect(after!.stats.failedSwaps, 'the swap should get an answer over the link').toBe(0);
    expect(after!.stats.swaps).toBeGreaterThanOrEqual(1);
    await expect.poll(async () => (await diagnostics(bob!))!.stats.answered,
      { timeout: 20_000, message: 'Bob should have answered Alice\'s swap' }).toBeGreaterThan(before);
    // The swap kept both on each other's list.
    expect((await diagnostics(alice))!.list.map((entry) => entry.userId)).toEqual([bobId]);
  });
});
