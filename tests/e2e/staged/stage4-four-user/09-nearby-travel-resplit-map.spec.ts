/**
 * Visual demo, continuing 08-nearby-shrink-map: travel between adjacent Nearby regions (C = 3).
 *
 * 1. Four users around San Diego split the worldwide Nearby group down until it settles as two
 *    adjacent regions: A holds 3 users, B holds 1.
 * 2. One user of A taps a point inside B on the map and joins B as a traveler → A = 2, B = 2.
 *    Neither region is over capacity, so nothing splits.
 * 3. Two users move back into A: B's original user travels to a point in A, and the traveler
 *    presses Return home. A now has 4 > C, so A is replaced again by smaller regions. If A were
 *    already at the deepest partition level, the index would reject the 4th presence instead
 *    ("Nearby group is full and cannot be subdivided safely"). The test reports which happened.
 */
import { Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage4Spec } from '../../helpers/e2e-stage-pipeline';
import {
  NearbyMapDemo,
  SAN_DIEGO_SPOTS,
  areaOf,
  caption,
  describeOccupancy,
  formatDiameter,
  occupancy,
  openMap,
  people,
  returnHome,
  roomOf,
  travelByMapTap,
  waitUntilSettled,
} from '../../helpers/nearby-map-demo';

const CAPACITY = 3;
const QUIET_MS = 60_000; // the Nearby control heartbeat is 15 s; four quiet beats = settled

test.describe('Nearby travel and re-split on the map', () => {
  let demo: NearbyMapDemo | undefined;

  test.afterAll(async () => {
    await demo?.close();
    await clearGunForStage4Spec();
  });

  test('a user travels A→B, two users move back into A, and A splits again (or rejects)', async () => {
    test.setTimeout(1_200_000);
    await clearGunForStage4Spec();
    demo = new NearbyMapDemo(test.info(), `/?e2e_capacity=${CAPACITY}`);

    const rejections: string[] = [];
    const pages: Record<string, Page> = {};
    for (let i = 0; i < 4; i++) {
      const label = `U${i + 1}`;
      const page = await demo.boot(label, SAN_DIEGO_SPOTS[i]!, i === 0 ? 0 : i - 1, i === 0);
      page.on('console', (message) => {
        if (/cannot be subdivided|bounded group limit/.test(message.text())) rejections.push(`${label}: ${message.text()}`);
      });
      await openMap(page);
      pages[label] = page;
    }
    const spotOf = (label: string) => SAN_DIEGO_SPOTS[Number(label.slice(1)) - 1]!;
    // Each user's current encounter point: home, or the map point they traveled to.
    const points: Record<string, { latitude: number; longitude: number }> = Object.fromEntries(
      Object.keys(pages).map((label) => [label, spotOf(label)]));
    // Overlay names: A and B once known; regions created later get A1, A2, … (they replace A).
    const regionNames = new Map<string, string>();
    const shot = async (label: string, step: string) => {
      const everyone = await people(pages, points);
      for (const person of everyone) {
        if (!regionNames.has(person.roomId)) regionNames.set(person.roomId, `A${[...regionNames.values()].filter((n) => n.startsWith('A')).length}`);
        person.regionName = regionNames.get(person.roomId);
      }
      await demo!.capture(pages[label]!, label, step, everyone);
    };

    // ---- Phase 1: the cascade settles into A (3 users) + B (1 user). ----
    await caption(pages.U1!, 'Four users joined — splitting until every region holds ≤ 3');
    await waitUntilSettled(pages, QUIET_MS, 600_000);
    let rooms = await occupancy(pages);
    console.log(`[settled] ${describeOccupancy(rooms)}`);
    const sizes = [...rooms.values()].map((labels) => labels.length).sort();
    expect(sizes, 'the first cascade should leave a 3-user and a 1-user region').toEqual([1, 3]);
    const [roomA, trio] = [...rooms.entries()].find(([, labels]) => labels.length === 3)!;
    const [roomB, [lone]] = [...rooms.entries()].find(([, labels]) => labels.length === 1)! as [string, string[]];
    const areaA = (await areaOf(pages[trio[0]!]!))!;
    const areaB = (await areaOf(pages[lone!]!))!;
    expect(areaA.west !== areaB.west || areaA.south !== areaB.south, 'A and B should be different map areas').toBe(true);
    // Watch A from a user who stays there the whole time; the mover is another member of A.
    regionNames.set(roomA, 'A');
    regionNames.set(roomB, 'B');
    const stayer = trio.includes('U1') ? 'U1' : trio[0]!;
    const mover = trio.find((label) => label !== stayer)!;
    console.log(`[roles] A=${roomA.slice(-6)} [${trio.join(',')}], B=${roomB.slice(-6)} [${lone}], mover=${mover}, stayer=${stayer}`);
    await shot(stayer, `settled in region A (3 users, ${formatDiameter(areaA.approximateDiameterMeters)})`);
    await shot(lone!, 'settled alone in region B');

    // ---- Phase 2: the mover travels from A into B by tapping B on the map. A = 2, B = 2. ----
    await caption(pages[mover]!, `${mover}: tapping region B to join it as a traveler`);
    await travelByMapTap(pages[mover]!, spotOf(lone!));
    points[mover] = spotOf(lone!);
    await expect.poll(() => roomOf(pages[mover]!), { timeout: 60_000, message: `${mover} should reach B` }).toBe(roomB);
    await shot(mover, 'traveled A → B');
    // Two full heartbeats: neither region is over capacity, so neither may split.
    await pages[stayer]!.waitForTimeout(35_000);
    rooms = await occupancy(pages);
    console.log(`[after A→B] ${describeOccupancy(rooms)}`);
    expect(rooms.get(roomA)?.length, 'A keeps 2 users').toBe(2);
    expect(rooms.get(roomB)?.length, 'B has 2 users').toBe(2);
    await shot(stayer, 'region A now has 2 users');
    await shot(lone!, 'region B now has 2 users');

    // ---- Phase 3: two users move back into A → 4 > C. ----
    await caption(pages[lone!]!, `${lone}: tapping region A to join it as a traveler`);
    await travelByMapTap(pages[lone!]!, spotOf(stayer));
    points[lone!] = spotOf(stayer);
    await caption(pages[mover]!, `${mover}: Return home (back to region A)`);
    await returnHome(pages[mover]!);
    points[mover] = spotOf(mover);
    await caption(pages[stayer]!, `${lone} and ${mover} moved into A — 4 > ${CAPACITY}`);

    let changes = 0;
    await waitUntilSettled(pages, QUIET_MS, 600_000, async (label, room) => {
      changes++;
      console.log(`[change] ${label} → ${room.slice(-6)}`);
      if (label === stayer || label === lone) await shot(label, `after move-back change ${changes}`);
    });

    rooms = await occupancy(pages);
    console.log(`[final] ${describeOccupancy(rooms)}`);
    for (const [room, labels] of rooms) {
      expect(labels.length, `${room} holds ${labels.join(',')}: over capacity`).toBeLessThanOrEqual(CAPACITY);
    }
    const stillInA = [...(rooms.get(roomA) ?? [])];
    if (rejections.length > 0) {
      console.log(`[outcome] A was already at the deepest level and rejected the 4th user:\n  ${rejections.join('\n  ')}`);
      expect(stillInA.length).toBeLessThanOrEqual(CAPACITY);
    } else {
      console.log('[outcome] A was replaced by smaller regions');
      expect(stillInA, 'A must have been replaced').toEqual([]);
    }
    const finalArea = (await areaOf(pages[stayer]!))!;
    await caption(pages[stayer]!, `Settled: ${stayer}'s region ≈ ${formatDiameter(finalArea.approximateDiameterMeters)}`);
    await shot(stayer, 'final');
    console.log(`[summary]\n${demo.summary()}`);
  });
});
