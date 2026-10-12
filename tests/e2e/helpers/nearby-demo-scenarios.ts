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

/**
 * Down to the smallest region, then switch rooms by tapping list rows (spec stage4 13).
 *
 * U1–U3 stand inside one smallest Neighborhood square (~1 km, depth 15 at San Diego); U4 stands
 * ~1.4 km west, in the neighbouring square — the four share every larger region. So the cascade
 * cannot stop early: it splits all the way to the smallest region, where U4 finally separates
 * (A = 3, B = 1). Then:
 *   1. U4 taps A ("3 / 3 · Full", greyed) — nothing happens; a full room cannot be entered.
 *   2. U3 taps B — enters B's member list (A = 2, B = 2).
 *   3. U4 taps A (now 2 / 3) — enters A (A = 3, B = 1).
 */
export const MINIMUM_SPLIT_SPOTS: Array<{ latitude: number; longitude: number }> = [
  { latitude: 32.7157, longitude: -117.1611 },
  { latitude: 32.7132, longitude: -117.1646 },
  { latitude: 32.7132, longitude: -117.1636 },
  { latitude: 32.7132, longitude: -117.1756 },
];

export async function runMinimumSplitSwitchDemo(info: TestInfo): Promise<NearbyMapDemo> {
  const demo = new NearbyMapDemo(info, `/?e2e_capacity=${CAPACITY}`, 'list');
  const pages: Record<string, Page> = {};
  for (let i = 0; i < 4; i++) {
    const label = `U${i + 1}`;
    pages[label] = await demo.boot(label, MINIMUM_SPLIT_SPOTS[i]!, i, false);
    await demo.show(pages[label]!);
  }
  await demo.captureGrid(pages, 'four users joined: 4 > 3, splitting');

  let splits = 0;
  await waitUntilSettled(pages, QUIET_MS, 900_000, async (label) => {
    if (label !== 'U1') return;
    splits++;
    await demo.captureGrid(pages, `split ${splits}`);
  });
  const rooms = await occupancy(pages);
  console.log(`[settled after ${splits} splits] ${describeOccupancy(rooms)}`);
  const roomA = [...rooms.entries()].find(([, labels]) => labels.length === 3)?.[0];
  const roomB = [...rooms.entries()].find(([, labels]) => labels.length === 1)?.[0];
  expect(roomA && roomB, 'the cascade should end with U1–U3 together and U4 alone').toBeTruthy();
  expect(rooms.get(roomB!)).toEqual(['U4']);
  const area = (await areaOf(pages.U1!))!;
  console.log(`[smallest region] U1's Nearby ≈ ${formatDiameter(area.approximateDiameterMeters)} across`);
  expect(area.approximateDiameterMeters, 'the split should reach the smallest (~1.5 km) region').toBeLessThan(2_000);
  await demo.captureGrid(pages, `smallest region reached: A = U1, U2, U3 (full) · B = U4`);

  const row = (label: string, roomId: string) =>
    pages[label]!.locator(`[data-testid="room-list-row"][data-chatroom-id="${roomId}"]`);
  const tapInto = async (label: string, roomId: string, step: string) => {
    await expect(row(label, roomId), `${label} should list the room`).toBeVisible({ timeout: 45_000 });
    if (process.env.ROOM_TAP_DEBUG) {
      const info = await pages[label]!.evaluate(async (target) => {
        const app = (window as any).__iinpublic_app?.getApp?.();
        const base = app?.getBackendApiBase?.() || '';
        const list = await fetch(`${base}/api/active-rooms?limit=50`).then((r) => r.json());
        return { target: list.rooms.find((r: any) => r.roomId === target), all: list.rooms.map((r: any) => `${r.roomId.slice(-6)}:${r.memberCount}:${r.partitionPath}`) };
      }, roomId);
      console.log(`[debug ${label}→${roomId.slice(-6)}] ${JSON.stringify(info)}`);
    }
    await row(label, roomId).click();
    if (process.env.ROOM_TAP_DEBUG) {
      await pages[label]!.waitForTimeout(500);
      console.log(`[debug ${label} travel point] ${JSON.stringify(await pages[label]!.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.pendingNearbyTravel?.location || (window as any).__iinpublic_app?.getApp?.()?.travelNearbyPoint))}`);
    }
    await expect(pages[label]!.locator('#chatroom-detail-container')).toBeVisible();
    await expect.poll(() => roomOf(pages[label]!), { timeout: 60_000 }).toBe(roomId);
    await pages[label]!.waitForTimeout(2_500); // let the members arrive in the member list
    await demo.captureGrid(pages, step);
    await openList(pages[label]!);
  };

  // 1. A full room is shown, greyed, and cannot be entered.
  await expect(row('U4', roomA!)).toHaveAttribute('aria-disabled', 'true', { timeout: 45_000 });
  await row('U4', roomA!).click();
  await pages.U4!.waitForTimeout(1_500);
  expect(await roomOf(pages.U4!), 'U4 must stay in B').toBe(roomB);
  await demo.captureGrid(pages, 'U4 taps A: "Full" — stays in B');

  // 2. U3 switches into B by tapping it: A = 2, B = 2.
  await tapInto('U3', roomB!, 'U3 tapped B: entered its member list (A = 2, B = 2)');
  // 3. A has room again; U4 switches into A: A = 3, B = 1.
  await expect(row('U4', roomA!)).not.toHaveAttribute('aria-disabled', 'true', { timeout: 45_000 });
  await tapInto('U4', roomA!, 'U4 tapped A: entered its member list (A = 3, B = 1)');

  await waitUntilSettled(pages, 20_000, 120_000);
  const final = await occupancy(pages);
  console.log(`[final] ${describeOccupancy(final)}`);
  for (const [room, labels] of final) expect(labels.length, `${room} over capacity`).toBeLessThanOrEqual(CAPACITY);
  expect(final.get(roomA!)?.sort()).toEqual(['U1', 'U2', 'U4']);
  expect(final.get(roomB!)).toEqual(['U3']);
  await demo.captureGrid(pages, 'final: A = U1, U2, U4 · B = U3');
  console.log(`[summary]\n${demo.summary()}`);
  return demo;
}

/**
 * More than four users (spec stage4 14). U1–U3 stand in one smallest square, so with C = 3 they
 * fit in the single worldwide room. Then newcomers arrive, each closer than the last; every arrival
 * makes 4 in the trio's room, which splits until the newcomer separates. The last newcomer stands
 * inside the trio's own smallest square: 4 people in a region that cannot be divided by location.
 * After each step every user looks at the list view, then the map view (one frame each).
 */
export const PROGRESSIVE_NEWCOMERS: Array<{ label: string; where: string; latitude: number; longitude: number }> = [
  { label: 'U4', where: 'New York (~3,900 km)', latitude: 40.7128, longitude: -74.006 },
  { label: 'U5', where: 'Los Angeles (~180 km)', latitude: 34.0522, longitude: -118.2437 },
  { label: 'U6', where: 'La Jolla (~17 km)', latitude: 32.8328, longitude: -117.2713 },
  { label: 'U7', where: 'the next smallest square (~1.4 km)', ...MINIMUM_SPLIT_SPOTS[3]! },
  { label: 'U8', where: "inside the trio's own smallest square", latitude: 32.7132, longitude: -117.1641 },
];

export async function runProgressiveSplitDemo(info: TestInfo): Promise<NearbyMapDemo> {
  const demo = new NearbyMapDemo(info, `/?e2e_capacity=${CAPACITY}`, 'list');
  demo.gridColumns = 4;
  const pages: Record<string, Page> = {};
  const rejections: string[] = [];
  const boot = async (label: string, spot: { latitude: number; longitude: number }) => {
    const page = await demo.boot(label, spot, Number(label.slice(1)) - 1, false);
    page.on('console', (message) => {
      if (/cannot be subdivided|bounded group limit/.test(message.text())) rejections.push(`${label}: ${message.text()}`);
    });
    await demo.show(page);
    pages[label] = page;
  };
  /** Every user checks the list, then the map; one frame of all screens for each view. */
  const lookBothWays = async (step: string) => {
    for (const page of Object.values(pages)) await openList(page);
    await demo.captureGrid(pages, `${step} — list`, 'list');
    for (const page of Object.values(pages)) await openMap(page);
    await Object.values(pages)[0]!.waitForTimeout(1_500); // map tiles + dots
    await demo.captureGrid(pages, `${step} — map`, 'map');
    for (const page of Object.values(pages)) await openList(page);
  };
  const log: string[] = [];
  const record = async (step: string) => {
    const rooms = await occupancy(pages);
    const areas = await Promise.all(Object.keys(pages).map(async (label) => {
      const area = await areaOf(pages[label]!);
      return `${label}:${area ? formatDiameter(area.approximateDiameterMeters) : '?'}`;
    }));
    const line = `${step}: ${describeOccupancy(rooms)} | areas ${areas.join(' ')}`;
    log.push(line);
    console.log(`[step] ${line}`);
    for (const [room, labels] of rooms) expect(labels.length, `${room} holds ${labels.join(',')}`).toBeLessThanOrEqual(CAPACITY);
    return rooms;
  };

  // The trio: three people, capacity three — one worldwide room, no split.
  for (let i = 0; i < 3; i++) await boot(`U${i + 1}`, MINIMUM_SPLIT_SPOTS[i]!);
  await waitUntilSettled(pages, 20_000, 120_000);
  const start = await record('U1–U3 in one smallest square');
  expect(start.size, 'three users fit in the single worldwide room').toBe(1);
  await lookBothWays('U1–U3: one worldwide room (3 / 3)');

  for (const newcomer of PROGRESSIVE_NEWCOMERS) {
    await boot(newcomer.label, newcomer);
    await caption(pages.U1!, `${newcomer.label} joined from ${newcomer.where}`);
    await waitUntilSettled(pages, QUIET_MS, 900_000);
    const rooms = await record(`${newcomer.label} joined from ${newcomer.where}`);
    const trioRoom = await roomOf(pages.U1!);
    await lookBothWays(`${newcomer.label} from ${newcomer.where}: ${rooms.size} rooms`);
    if (newcomer.label !== 'U8') {
      // The newcomer always ends up apart from the trio, who stay together.
      expect([await roomOf(pages.U2!), await roomOf(pages.U3!)]).toEqual([trioRoom, trioRoom]);
      expect(await roomOf(pages[newcomer.label]!), `${newcomer.label} separates from the trio`).not.toBe(trioRoom);
    }
  }

  // Four people in one smallest region: location cannot divide them any further.
  const smallest = await Promise.all(['U1', 'U2', 'U3', 'U8'].map(async (label) => ({ label, room: await roomOf(pages[label]!), area: await areaOf(pages[label]!) })));
  const sameArea = new Set(smallest.map((entry) => `${entry.area?.west},${entry.area?.south}`)).size === 1;
  const lanes = new Map<string, string[]>();
  for (const entry of smallest) lanes.set(entry.room, [...(lanes.get(entry.room) ?? []), entry.label]);
  const outcome = rejections.length > 0
    ? `rejected: ${rejections.join('; ')}`
    : `split by identity lanes into ${lanes.size} groups (${[...lanes.values()].map((l) => l.join('+')).join(' / ')}), ${sameArea ? 'all on the same map square' : 'on different squares'}`;
  console.log(`[outcome] 4 users in one smallest region → ${outcome}`);
  expect(sameArea, 'the four share the smallest region on the map').toBe(true);
  expect(rejections.length > 0 || lanes.size > 1, 'either the index rejects the 4th user or lanes divide them').toBe(true);
  console.log(`[log]\n  ${log.join('\n  ')}`);
  return demo;
}
