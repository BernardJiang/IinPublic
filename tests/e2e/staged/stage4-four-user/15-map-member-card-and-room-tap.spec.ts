/**
 * Map view ↔ people: a green dot (someone in my room) opens a brief profile card whose Message
 * button opens the ordinary DM and whose Profile button opens the peer page; a tap on another Nearby
 * group (its pin, or open map outside my room) moves me into that group.
 */
import type { Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage4Spec } from '../../helpers/e2e-stage-pipeline';
import {
  NearbyMapDemo,
  SAN_DIEGO_SPOTS,
  occupancy,
  openMap,
  roomOf,
  waitUntilSettled,
} from '../../helpers/nearby-map-demo';

const stageNameOf = (page: Page): Promise<string> =>
  page.evaluate(() => String((window as any).__iinpublic_app?.getApp?.()?.currentUser?.stageName || ''));

test.describe('Map: member card and moving by tap', () => {
  let demo: NearbyMapDemo | undefined;

  test.afterEach(async () => {
    await demo?.close();
    demo = undefined;
    await clearGunForStage4Spec();
  });

  test('a green dot opens a profile card; Message opens the DM, Profile the peer page', async () => {
    test.setTimeout(300_000);
    await clearGunForStage4Spec();
    demo = new NearbyMapDemo(test.info(), '/');
    const u1 = await demo.boot('U1', SAN_DIEGO_SPOTS[0]!, 0, true);
    const u2 = await demo.boot('U2', SAN_DIEGO_SPOTS[1]!, 0, false);
    await expect.poll(() => roomOf(u2), { timeout: 60_000 }).toBe(await roomOf(u1));
    const u2Name = await stageNameOf(u2);
    expect(u2Name).toBeTruthy();

    await openMap(u1);
    const map = u1.locator('[data-testid="chatroom-map"]');
    const roommate = map.locator('[data-testid="map-user-dot-room"]');
    await expect(roommate).toHaveCount(1, { timeout: 90_000 });

    await roommate.click();
    const card = map.locator('[data-testid="map-member-card"]');
    await expect(card).toBeVisible();
    await expect(card.locator('[data-testid="map-member"]')).toContainText(u2Name);
    await demo.capture(u1, 'U1', 'member card');

    await card.locator('[data-testid="map-member-message"]').click();
    await expect(u1.locator('#conversation-detail-overlay')).toBeVisible({ timeout: 15_000 });
    await expect(u1.locator('#conversation-detail-overlay')).toContainText(u2Name);
    await expect(u1.locator('#conversation-message-input')).toBeVisible();
    // Back from the DM pops to the peer page (conversation-first back chain), then to the map.
    await u1.locator('#back-from-conversation').click();
    await expect(u1.locator('#peer-detail-overlay')).toBeVisible({ timeout: 15_000 });
    await u1.locator('#back-from-peer-detail').click();
    await expect(u1.locator('#peer-detail-overlay')).toBeHidden();

    // The card's Profile button opens the peer page directly.
    await expect(roommate).toHaveCount(1, { timeout: 30_000 });
    await roommate.click();
    await map.locator('[data-testid="map-member-profile"]').click();
    await expect(u1.locator('#peer-detail-overlay')).toBeVisible({ timeout: 15_000 });
    await expect(u1.locator('#peer-detail-overlay')).toContainText(u2Name);
  });

  test('tapping another Nearby group on the map moves me into it', async () => {
    test.setTimeout(900_000);
    await clearGunForStage4Spec();
    demo = new NearbyMapDemo(test.info(), '/?e2e_capacity=3');
    const pages: Record<string, Page> = {};
    for (let i = 0; i < 4; i++) {
      const label = `U${i + 1}`;
      pages[label] = await demo.boot(label, SAN_DIEGO_SPOTS[i]!, i === 0 ? 0 : i - 1, i === 0);
    }
    // Four users, capacity 3: the worldwide group splits until every group holds ≤ 3.
    await waitUntilSettled(pages, 45_000, 600_000);
    const rooms = await occupancy(pages);
    expect(rooms.size, 'the split should leave more than one group').toBeGreaterThan(1);

    const u1 = pages.U1!;
    const before = await roomOf(u1);
    const otherRooms = [...rooms.keys()].filter((room) => room !== before);
    await openMap(u1);
    // Another group's pin (drawn over its members' yellow dots): tapping it moves me there. Open-map
    // taps outside my room use the same rule (src/test/unit/chatroom-map-tap.test.ts).
    const otherRoom = u1.locator(`[data-testid="chatroom-map"] .chatroom-map-marker[data-chatroom-id="${otherRooms[0]}"]`);
    await expect(otherRoom).toBeVisible({ timeout: 90_000 });
    await otherRoom.click();

    await expect.poll(() => roomOf(u1), { timeout: 60_000 }).not.toBe(before);
    expect(otherRooms).toContain(await roomOf(u1));
    await demo.capture(u1, 'U1', 'moved by tapping another group');
  });
});
