/**
 * Visual demo: one user's Nearby chatroom shrinks from the whole world to a local area (C = 3).
 *
 * docs/design/nearby-and-place-chatrooms.md §3: while the online population is at most C, everyone
 * shares one worldwide Nearby group. When C + 1 signed presences reach a group, the partition index
 * replaces it with four compact geographic groups, and each member follows the one covering its
 * declared location. Four users around San Diego keep landing in the same quarter, so the split
 * repeats level by level until the privacy floor; after that, identity lanes divide them.
 *
 * U1's window stays on the map view. Every time U1's Nearby room changes, the shaded green area
 * is captured (screenshot attachment) and the run is recorded as a video.
 */
import { Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage4Spec } from '../../helpers/e2e-stage-pipeline';
import { NearbyMapDemo, SAN_DIEGO_SPOTS, areaOf, caption, formatDiameter, openMap, roomOf } from '../../helpers/nearby-map-demo';

const CAPACITY = 3;

test.describe('Nearby shrink on the map', () => {
  let demo: NearbyMapDemo | undefined;

  test.afterAll(async () => {
    await demo?.close();
    await clearGunForStage4Spec();
  });

  test('U1 watches its Nearby area shrink from worldwide to local as four users arrive', async () => {
    test.setTimeout(900_000);
    await clearGunForStage4Spec();
    demo = new NearbyMapDemo(test.info(), `/?e2e_capacity=${CAPACITY}`);
    const boot = (index: number): Promise<Page> =>
      demo!.boot(`U${index + 1}`, SAN_DIEGO_SPOTS[index]!, index === 0 ? 0 : index - 1, index === 0);
    const capture = (page: Page, step: string) => demo!.capture(page, 'U1', step);

    // U1 alone: the worldwide Nearby group.
    const watcher = await boot(0);
    await openMap(watcher);
    const worldRoom = await roomOf(watcher);
    const worldArea = await areaOf(watcher);
    expect(worldArea, 'U1 should have a shaded Nearby area').not.toBeNull();
    await capture(watcher, 'U1 alone (worldwide group)');

    const others: Page[] = [];
    for (let i = 1; i < 3; i++) {
      others.push(await boot(i));
      await caption(watcher, `U${i + 1} joined — ${i + 1} of ${CAPACITY}, no split yet`);
      await watcher.waitForTimeout(1_500);
    }
    // At capacity the group must not split.
    expect(await roomOf(watcher)).toBe(worldRoom);
    await capture(watcher, `3 users = capacity ${CAPACITY}`);

    // The fourth arrival makes C + 1: the group is replaced, and keeps being replaced while all four
    // stay inside one quarter. Track every room U1 moves into until it settles.
    others.push(await boot(3));
    await caption(watcher, 'U4 joined — 4 > capacity, splitting…');

    let lastRoom = worldRoom;
    let lastChangeAt = Date.now();
    const SETTLE_MS = 60_000; // the control heartbeat is 15 s; four quiet beats = settled
    let step = 0;
    while (Date.now() - lastChangeAt < SETTLE_MS) {
      const room = await roomOf(watcher);
      if (room !== lastRoom && /^nearby_/.test(room)) {
        step++;
        lastRoom = room;
        lastChangeAt = Date.now();
        await capture(watcher, `Split ${step}`);
      }
      await watcher.waitForTimeout(1_000);
    }

    const finalArea = await areaOf(watcher);
    expect(step, 'the fourth user should force at least one split').toBeGreaterThan(0);
    expect(finalArea!.approximateDiameterMeters).toBeLessThan(worldArea!.approximateDiameterMeters);

    // Nobody shares a group with more than C - every room holds at most CAPACITY of the four.
    const rooms = [await roomOf(watcher), ...(await Promise.all(others.map(roomOf)))];
    const sizes = new Map<string, number>();
    for (const room of rooms) sizes.set(room, (sizes.get(room) ?? 0) + 1);
    console.log(`[final] ${rooms.map((room, i) => `U${i + 1}→${room.slice(0, 24)}…`).join('  ')}`);
    for (const [room, size] of sizes) expect(size, `${room} over capacity`).toBeLessThanOrEqual(CAPACITY);

    await caption(watcher, `Settled after ${step} split(s): Nearby ≈ ${formatDiameter(finalArea!.approximateDiameterMeters)} across`);
    await watcher.waitForTimeout(2_000);
    console.log(`[summary]\n${demo.summary()}`);
  });
});
