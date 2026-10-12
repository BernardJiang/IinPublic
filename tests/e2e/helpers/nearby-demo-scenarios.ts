/**
 * The adaptive-Nearby demos, runnable on either chatroom view. Map specs: stage4 08/09.
 * List specs (no map; all four users' lists side by side): stage4 11/12.
 */
import { Page, TestInfo } from '@playwright/test';
import { expect } from './fixtures';
import {
  NearbyMapDemo,
  SAN_DIEGO_SPOTS,
  areaOf,
  caption,
  describeOccupancy,
  formatDiameter,
  occupancy,
  openList,
  openMap,
  people,
  returnHome,
  roomOf,
  waitUntilSettled,
  type DemoView,
} from './nearby-map-demo';

const CAPACITY = 3;
const QUIET_MS = 60_000; // the Nearby control heartbeat is 15 s; four quiet beats = settled

/**
 * Four users arrive one by one (C = 3). The worldwide group splits once the fourth arrives, and keeps
 * splitting while all four stay inside one quarter, until every group holds ≤ 3.
 */
export async function runShrinkDemo(info: TestInfo, view: DemoView): Promise<NearbyMapDemo> {
  const demo = new NearbyMapDemo(info, `/?e2e_capacity=${CAPACITY}`, view);
  const pages: Record<string, Page> = {};
  const boot = async (index: number): Promise<Page> => {
    const label = `U${index + 1}`;
    const page = await demo.boot(label, SAN_DIEGO_SPOTS[index]!, index === 0 ? 0 : index - 1, index === 0);
    await demo.show(page);
    pages[label] = page;
    return page;
  };
  const watcher = await boot(0);
  const capture = (step: string) => view === 'map' ? demo.capture(watcher, 'U1', step) : demo.captureGrid(pages, step);

  const worldRoom = await roomOf(watcher);
  const worldArea = await areaOf(watcher);
  expect(worldArea, 'U1 should have a Nearby area').not.toBeNull();
  await capture('U1 alone (worldwide group)');

  for (let i = 1; i < 3; i++) {
    await boot(i);
    await caption(watcher, `U${i + 1} joined — ${i + 1} of ${CAPACITY}, no split yet`);
    await watcher.waitForTimeout(1_500);
  }
  expect(await roomOf(watcher), 'at capacity the group must not split').toBe(worldRoom);
  await capture(`3 users = capacity ${CAPACITY}`);

  await boot(3);
  await caption(watcher, 'U4 joined — 4 > capacity, splitting…');
  let step = 0;
  await waitUntilSettled({ U1: watcher }, QUIET_MS, 600_000, async () => {
    step++;
    await capture(`Split ${step}`);
  });

  const finalArea = await areaOf(watcher);
  expect(step, 'the fourth user should force at least one split').toBeGreaterThan(0);
  expect(finalArea!.approximateDiameterMeters).toBeLessThan(worldArea!.approximateDiameterMeters);
  await waitUntilSettled(pages, 20_000, 120_000);
  const rooms = await occupancy(pages);
  console.log(`[final] ${describeOccupancy(rooms)}`);
  for (const [room, labels] of rooms) expect(labels.length, `${room} over capacity`).toBeLessThanOrEqual(CAPACITY);
  await capture(`Settled after ${step} split(s): U1's Nearby ≈ ${formatDiameter(finalArea!.approximateDiameterMeters)}`);
  console.log(`[summary]\n${demo.summary()}`);
  return demo;
}

/**
 * After the cascade (A = 3, B = 1): one user of A travels to B (2 / 2, no split), then two users move
 * back into A (4 > C), so A splits again — or, at the deepest level, rejects the 4th user.
 */
export async function runTravelResplitDemo(info: TestInfo, view: DemoView): Promise<NearbyMapDemo> {
  const demo = new NearbyMapDemo(info, `/?e2e_capacity=${CAPACITY}`, view);
  const rejections: string[] = [];
  const pages: Record<string, Page> = {};
  for (let i = 0; i < 4; i++) {
    const label = `U${i + 1}`;
    const page = await demo.boot(label, SAN_DIEGO_SPOTS[i]!, i === 0 ? 0 : i - 1, i === 0);
    page.on('console', (message) => {
      if (/cannot be subdivided|bounded group limit/.test(message.text())) rejections.push(`${label}: ${message.text()}`);
    });
    await demo.show(page);
    pages[label] = page;
  }
  const spotOf = (label: string) => SAN_DIEGO_SPOTS[Number(label.slice(1)) - 1]!;
  const points: Record<string, { latitude: number; longitude: number }> = Object.fromEntries(
    Object.keys(pages).map((label) => [label, spotOf(label)]));
  const regionNames = new Map<string, string>();
  /** Map: the named users' maps with the region overlay. List: one 2×2 frame of every list. */
  const snap = async (step: string, mapLabels: string[]) => {
    if (view === 'list') {
      await demo.captureGrid(pages, step);
      return;
    }
    for (const label of mapLabels) {
      const everyone = await people(pages, points);
      for (const person of everyone) {
        if (!regionNames.has(person.roomId)) regionNames.set(person.roomId, `A${[...regionNames.values()].filter((n) => n.startsWith('A')).length}`);
        person.regionName = regionNames.get(person.roomId);
      }
      await demo.capture(pages[label]!, label, step, everyone);
    }
  };
  /**
   * Map: tap the target room's pin. List: tap the target room's row ("Rooms near you"), which enters it as a
   * Traveler and opens its member list; then go back to the list.
   */
  const travel = async (label: string, point: { latitude: number; longitude: number }, targetRoomId: string) => {
    const page = pages[label]!;
    if (view === 'map') {
      // Every room with people is a pin on the map; tapping it enters the room (member list).
      const pin = page.locator(`#chatroom-map [data-chatroom-id="${targetRoomId}"]`);
      await expect(pin, `${label} should see the target room's pin`).toBeVisible({ timeout: 45_000 });
      await pin.click();
      await expect(page.locator('#chatroom-detail-container')).toBeVisible();
      await expect.poll(() => roomOf(page), { timeout: 60_000 }).toBe(targetRoomId);
      await openMap(page);
    } else {
      const row = page.locator(`[data-testid="room-list-row"][data-chatroom-id="${targetRoomId}"]`);
      await expect(row, `${label} should see the target room in its list`).toBeVisible({ timeout: 45_000 });
      await row.click();
      await expect(page.locator('#chatroom-detail-container')).toBeVisible();
      await expect.poll(() => roomOf(page), { timeout: 60_000 }).toBe(targetRoomId);
      await demo.captureGrid(pages, `${label} tapped a room and entered its member list`);
      await openList(page);
    }
    points[label] = point;
  };

  // ---- Phase 1: the cascade settles into A (3 users) + B (1 user). ----
  await caption(pages.U1!, 'Four users joined — splitting until every group holds ≤ 3');
  await waitUntilSettled(pages, QUIET_MS, 600_000);
  let rooms = await occupancy(pages);
  console.log(`[settled] ${describeOccupancy(rooms)}`);
  expect([...rooms.values()].map((labels) => labels.length).sort(), 'expected a 3-user and a 1-user group').toEqual([1, 3]);
  const [roomA, trio] = [...rooms.entries()].find(([, labels]) => labels.length === 3)!;
  const [roomB, [lone]] = [...rooms.entries()].find(([, labels]) => labels.length === 1)! as [string, string[]];
  const areaA = (await areaOf(pages[trio[0]!]!))!;
  const areaB = (await areaOf(pages[lone!]!))!;
  expect(areaA.west !== areaB.west || areaA.south !== areaB.south, 'A and B should be different areas').toBe(true);
  regionNames.set(roomA, 'A');
  regionNames.set(roomB, 'B');
  const stayer = trio.includes('U1') ? 'U1' : trio[0]!;
  const mover = trio.find((label) => label !== stayer)!;
  console.log(`[roles] A=${roomA.slice(-6)} [${trio.join(',')}], B=${roomB.slice(-6)} [${lone}], mover=${mover}, stayer=${stayer}`);
  await snap(`settled: A has ${trio.join(', ')}; B has ${lone}`, [stayer, lone!]);

  // ---- Phase 2: the mover travels from A into B. A = 2, B = 2. ----
  await caption(pages[mover]!, `${mover}: traveling into B`);
  await travel(mover, spotOf(lone!), roomB);
  await expect.poll(() => roomOf(pages[mover]!), { timeout: 60_000, message: `${mover} should reach B` }).toBe(roomB);
  await pages[stayer]!.waitForTimeout(35_000); // two heartbeats: neither group is over capacity
  rooms = await occupancy(pages);
  console.log(`[after A→B] ${describeOccupancy(rooms)}`);
  expect(rooms.get(roomA)?.length, 'A keeps 2 users').toBe(2);
  expect(rooms.get(roomB)?.length, 'B has 2 users').toBe(2);
  await snap(`${mover} traveled A → B: A = 2, B = 2, no split`, [mover, stayer]);

  // ---- Phase 3: two users move back into A → 4 > C. ----
  await caption(pages[lone!]!, `${lone}: traveling into A`);
  await travel(lone!, spotOf(stayer), roomA);
  await caption(pages[mover]!, `${mover}: 🏠 Return home (back to A)`);
  await returnHome(pages[mover]!);
  points[mover] = spotOf(mover);
  await caption(pages[stayer]!, `${lone} and ${mover} moved into A — 4 > ${CAPACITY}`);
  await snap(`${lone} and ${mover} moved into A: 4 > ${CAPACITY}`, [stayer]);

  let changes = 0;
  await waitUntilSettled(pages, QUIET_MS, 600_000, async (label, room) => {
    changes++;
    console.log(`[change] ${label} → ${room.slice(-6)}`);
    if (view === 'list' || label === stayer || label === lone) await snap(`after move-back change ${changes}`, [label]);
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
    console.log('[outcome] A was replaced by smaller groups');
    expect(stillInA, 'A must have been replaced').toEqual([]);
  }
  await snap(`final: ${describeOccupancy(rooms).replace(/[0-9a-f]{6}:/g, '')}`, [stayer]);
  console.log(`[summary]\n${demo.summary()}`);
  return demo;
}
