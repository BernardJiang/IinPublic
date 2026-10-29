import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { test, expect } from '../helpers/fixtures';
import { clearGunForStage1Spec } from '../helpers/e2e-stage-pipeline';
import { headless, afterSync } from '../helpers/timing';
import { WEBRTC_CHROMIUM_ARGS } from '../helpers/webrtc-chromium';
import { bootstrapUser, waitForTabActive } from '../helpers/talks-matching-flow';
import { webAppURLStableChatroom } from '../helpers/ports';
import {
  completeTalkInAppByAnswerIds,
  createTagTalkViaEditor,
} from '../helpers/talk-demo-ui';
import {
  getBrowserWindowWorkArea,
  setBrowserWindowBounds,
  type BrowserWindowBounds,
} from '../helpers/browser-window';

/* eslint-disable @typescript-eslint/no-explicit-any */

type DemoUser = {
  index: number;
  label: string;
  stageName: string;
  location: { latitude: number; longitude: number };
  context: BrowserContext;
  page: Page;
  userId: string;
};

const TOTAL_USERS = 6;
const CAPACITY = 3;
const STARTING_GREEN_COUNT = CAPACITY;
const STARTING_YELLOW_COUNT = TOTAL_USERS - STARTING_GREEN_COUNT - 1;
const REACHABLE_NEARBY_KM = 1_500;
const TALK_PREFIX = 'MapOps user-';
const DELIVERY_POINT = { latitude: 32.7157, longitude: -117.1611 };

const WORLD_STARTS = [
  { latitude: 37.7749, longitude: -122.4194 }, // San Francisco (leader)
  { latitude: 34.0522, longitude: -118.2437 }, // Los Angeles, close enough to be green
  { latitude: 36.1699, longitude: -115.1398 }, // Las Vegas, close enough to be green
  { latitude: 47.6062, longitude: -122.3321 }, // Seattle, close enough to be green
  { latitude: 35.6762, longitude: 139.6503 }, // Tokyo, far enough to stay yellow
  { latitude: 51.5074, longitude: -0.1278 }, // London, far enough to stay yellow
] as const;

function distanceKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * (Math.sin(dLon / 2) ** 2);
  return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function mapPrecisionForViewer(viewer: DemoUser, users: DemoUser[]): number {
  const others = users.filter((candidate) => candidate.userId !== viewer.userId);
  if (others.length === 0) return 50_000;

  const nearest = [...others]
    .sort((a, b) => distanceKm(viewer.location, a.location) - distanceKm(viewer.location, b.location))
    .slice(0, 4);

  const nearestDists = nearest.map((entry) => distanceKm(viewer.location, entry.location));
  const spreadKm = nearestDists.length > 1 ? Math.max(...nearestDists) - Math.min(...nearestDists) : 0;
  const maxDistanceKm = nearestDists.length > 0 ? Math.max(...nearestDists) : 0;
  const closeClusterCount = others.filter((candidate) => distanceKm(viewer.location, candidate.location) <= 30).length;

  if (closeClusterCount >= 4 || maxDistanceKm < 0.8) return 400;
  if (maxDistanceKm < 3 || spreadKm < 2) return 1_000;
  if (maxDistanceKm < 40) return 10_000;
  return 50_000;
}

function buildViewerDemoLayout(viewer: DemoUser, users: DemoUser[]): { dots: Array<{ userId: string; latitude: number; longitude: number }>; nearbyIds: string[]; roomMembers: Array<{ userId: string; stageName: string }> } {
  const others = users.filter((candidate) => candidate.userId !== viewer.userId);
  const ranked = [...others].sort(
    (a, b) => distanceKm(viewer.location, a.location) - distanceKm(viewer.location, b.location),
  );
  const nearbyIds = ranked.slice(0, CAPACITY).map((entry) => entry.userId);
  const greenSet = new Set(nearbyIds);
  const roomMembers = ranked
    .filter((user) => greenSet.has(user.userId))
    .map((user) => ({ userId: user.userId, stageName: user.stageName }));

  const dots = otherDotsForViewer(viewer, ranked, greenSet);
  return { dots, nearbyIds, roomMembers };
}

function otherDotsForViewer(
  viewer: DemoUser,
  ranked: DemoUser[],
  greenSet: Set<string>,
): Array<{ userId: string; latitude: number; longitude: number }> {
  // Keep the map data in real-world coordinates. Any local jitter collapses the initial view into a
  // tiny cluster and forces the app to jump straight into a street-level fit, which is exactly the
  // regression the user reported. The map should start on the world view and only tighten later as
  // those real locations converge.
  return ranked.map((user) => ({
    userId: user.userId,
    latitude: user.location.latitude,
    longitude: user.location.longitude,
  }));
}

async function syncDemoRoomMembers(viewer: DemoUser, users: DemoUser[]): Promise<void> {
  const { roomMembers } = buildViewerDemoLayout(viewer, users);
  await viewer.page.evaluate(({ members, currentUserId }) => {
    const app = (window as any).__iinpublic_app?.getApp?.();
    const shell = app?.uiManager?.chatroomShellController;
    if (!shell) throw new Error('chatroom shell unavailable');
    shell.updateChatroomMembers(members, currentUserId);
  }, { members: roomMembers, currentUserId: viewer.userId });
}

async function waitForMapLoaded(page: Page): Promise<void> {
  await expect(page.locator('[data-testid="chatroom-map"]')).toBeVisible({ timeout: 60_000 });
}

async function applyWorldMapDots(users: DemoUser[]): Promise<void> {
  for (const viewer of users) {
    const { dots, nearbyIds } = buildViewerDemoLayout(viewer, users);
    const precisionMeters = mapPrecisionForViewer(viewer, users) as 400 | 1_000 | 10_000 | 50_000;
    await syncDemoRoomMembers(viewer, users);

    await viewer.page.evaluate(({ selfPoint, dots, nearbyIds, precisionMeters }) => {
      const app = (window as any).__iinpublic_app?.getApp?.();
      if (!app?.uiManager?.setMapUserDotSource) throw new Error('setMapUserDotSource unavailable');
      app.uiManager.setMapUserDotSource({
        selfPoint: { ...selfPoint, precisionMeters },
        selfTraveler: false,
        listPoints: () => dots.map((entry: { latitude: number; longitude: number }) => ({
          latitude: entry.latitude,
          longitude: entry.longitude,
        })),
        isCandidate: (dot: any) => nearbyIds.includes(String(dot?.userId || '')),
        load: async () => ({
          dots: dots.map((entry: { userId: string; latitude: number; longitude: number }) => ({
            userId: entry.userId,
            latitude: entry.latitude,
            longitude: entry.longitude,
            precisionMeters,
            traveler: false,
          })),
          density: [],
        }),
      });
    }, { selfPoint: viewer.location, dots, nearbyIds, precisionMeters });
  }
}

async function openMapViewAndCenter(users: DemoUser[], centerOnSelf = false): Promise<void> {
  await Promise.all(users.map(async (user) => {
    await waitForTabActive(user.page, 'chatrooms');
    await user.page.locator('[data-testid="chatroom-map-view-btn"]').click();
    await waitForMapLoaded(user.page);
    if (centerOnSelf) {
      const selfButton = user.page.locator('.chatroom-map-locate-self');
      if (await selfButton.isVisible().catch(() => false)) {
        await selfButton.click();
      }
      await user.page.waitForTimeout(500);
    }
  }));
}

async function assertAllUsersVisible(users: DemoUser[]): Promise<void> {
  for (const user of users) {
    await expect.poll(async () => {
      return user.page.evaluate(() => {
        const room = Array.from(document.querySelectorAll('[data-testid="map-user-dot-room"]')).length;
        const other = Array.from(document.querySelectorAll('[data-testid="map-user-dot-other"]')).length;
        return room + other;
      });
    }, { timeout: 30_000, intervals: [700, 1200] }).toBeGreaterThan(0);
  }
}

async function ensureWorldMapView(user: DemoUser, expectedGreen: number, expectedYellow: number): Promise<void> {
  const zoomOutButton = user.page.locator('.maplibregl-ctrl-zoom-out');
  for (let round = 0; round < 10; round += 1) {
    const visibleCounts = await user.page.evaluate(() => ({
      green: document.querySelectorAll('[data-testid="map-user-dot-room"]').length,
      yellow: document.querySelectorAll('[data-testid="map-user-dot-other"]').length,
    }));
    if (visibleCounts.green >= expectedGreen && visibleCounts.yellow >= expectedYellow) {
      return;
    }
    if (await zoomOutButton.isVisible().catch(() => false)) {
      await zoomOutButton.click();
      await afterSync();
      await user.page.waitForTimeout(300);
      continue;
    }
    break;
  }
  await expect.poll(async () => {
    return user.page.evaluate(() => ({
      green: document.querySelectorAll('[data-testid="map-user-dot-room"]').length,
      yellow: document.querySelectorAll('[data-testid="map-user-dot-other"]').length,
    }));
  }, { timeout: 30_000, intervals: [700, 1200] }).toEqual({ green: expectedGreen, yellow: expectedYellow });
}

async function assertNearbyBalance(users: DemoUser[], expectedGreen: number, expectedYellow: number): Promise<void> {
  for (const user of users) {
    await ensureWorldMapView(user, expectedGreen, expectedYellow);
    await expect.poll(async () => {
      return user.page.evaluate(() => {
        const green = document.querySelectorAll('[data-testid="map-user-dot-room"]').length;
        const yellow = document.querySelectorAll('[data-testid="map-user-dot-other"]').length;
        return { green, yellow };
      });
    }, { timeout: 30_000, intervals: [700, 1200] }).toEqual({ green: expectedGreen, yellow: expectedYellow });
  }
}

async function recenterMapForUser(user: DemoUser): Promise<void> {
  await waitForTabActive(user.page, 'chatrooms');
  await user.page.locator('[data-testid="chatroom-map-view-btn"]').click();
  await waitForMapLoaded(user.page);
  const selfButton = user.page.locator('.chatroom-map-locate-self');
  if (await selfButton.isVisible().catch(() => false)) {
    await selfButton.click();
  }
  await afterSync();
  await user.page.waitForTimeout(250);
}

async function travelUsersOneByOne(users: DemoUser[]): Promise<void> {
  const leader = users[0]!;
  const moveSteps = 24;
  const interStepDelayMs = 1_000;

  await assertNearbyBalance(users, STARTING_GREEN_COUNT, STARTING_YELLOW_COUNT);

  for (let idx = 1; idx < users.length; idx += 1) {
    const mover = users[idx]!;
    const start = { ...mover.location };
    const target = { ...leader.location };
    await mover.page.bringToFront();
    await recenterMapForUser(mover);

    for (let step = 1; step <= moveSteps; step += 1) {
      const t = step / moveSteps;
      mover.location = {
        latitude: start.latitude + (target.latitude - start.latitude) * t,
        longitude: start.longitude + (target.longitude - start.longitude) * t,
      };

      await applyWorldMapDots(users);
      await Promise.all(users.map(async (user) => {
        await syncDemoRoomMembers(user, users);
        await recenterMapForUser(user);
      }));
      await assertAllUsersVisible(users);

      await userMapPause(mover.page, interStepDelayMs);
    }

    await leader.page.bringToFront();
    await recenterMapForUser(leader);
    await userMapPause(leader.page, 1_500);
  }
}

async function userMapPause(page: Page, ms: number): Promise<void> {
  if (headless) return;
  await page.waitForTimeout(ms);
}

async function seedIncomingTalkWithRetry(
  page: Page,
  payload: { talkData: any; senderId: string; senderName: string },
): Promise<void> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await page.evaluate(async ({ talkData, senderId, senderName }) => {
        const app = (window as any).__iinpublic_app?.getApp?.();
        if (!app?.seedIncomingTalkForE2e) throw new Error('seedIncomingTalkForE2e unavailable');
        await app.seedIncomingTalkForE2e({ talkData, senderId, senderName });
      }, payload);
      return;
    } catch (error) {
      lastError = error;
      const message = String(error);
      const retryable = message.includes('Execution context was destroyed')
        || message.includes('Cannot find context with specified id')
        || message.includes('navigation');
      if (!retryable || attempt === 3) break;
      await page.waitForLoadState('load', { timeout: 20_000 }).catch(() => {});
      await afterSync();
    }
  }
  throw lastError;
}

async function arrangeWindows(users: DemoUser[]): Promise<void> {
  if (headless || users.length === 0) return;
  const workArea = await getBrowserWindowWorkArea(users[0]!.page);
  if (!workArea) return;

  const margin = 10;
  const cols = 3;
  const rows = 2;
  const usableWidth = workArea.width - (margin * (cols + 1));
  const usableHeight = workArea.height - (margin * (rows + 1));
  const cellWidth = Math.floor(usableWidth / cols);
  const cellHeight = Math.floor(usableHeight / rows);

  const bounds: BrowserWindowBounds[] = Array.from({ length: TOTAL_USERS }, (_, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    return {
      left: workArea.left + margin + (col * (cellWidth + margin)),
      top: workArea.top + margin + (row * (cellHeight + margin)),
      width: cellWidth,
      height: cellHeight,
    };
  });

  const placements: BrowserWindowBounds[] = [];
  for (let index = 0; index < users.length; index += 1) {
    const placed = await setBrowserWindowBounds(users[index]!.page, bounds[index]!);
    if (placed) placements.push(placed.bounds);
  }

  const overlaps = (a: BrowserWindowBounds, b: BrowserWindowBounds): boolean =>
    a.left < b.left + b.width
    && a.left + a.width > b.left
    && a.top < b.top + b.height
    && a.top + a.height > b.top;

  for (let i = 0; i < placements.length; i += 1) {
    for (let j = i + 1; j < placements.length; j += 1) {
      if (overlaps(placements[i]!, placements[j]!)) {
        throw new Error(`window overlap detected between visible users ${i + 1} and ${j + 1}`);
      }
    }
  }
}

test.describe('M6 map world operations showcase', () => {
  test('starts on the world map, performs talk exchange, then moves each user to the leader one at a time', async () => {
    test.setTimeout(1_800_000);
    await clearGunForStage1Spec();

    const browser: Browser = await chromium.launch({
      headless,
      args: [...WEBRTC_CHROMIUM_ARGS, '--disable-dev-shm-usage'],
    });

    const users: DemoUser[] = [];
    const appUrl = new URL(webAppURLStableChatroom());
    appUrl.searchParams.set('e2e_capacity', '3');

    try {
      for (let index = 0; index < TOTAL_USERS; index += 1) {
        const stageName = `Map User ${String(index + 1).padStart(2, '0')}`;
        const ready = await bootstrapUser(
          browser,
          `M6-${index + 1}`,
          stageName,
          120_000,
          appUrl.toString(),
          DELIVERY_POINT,
        );
        const userId = await ready.page.evaluate(() =>
          String((window as any).__iinpublic_app?.getApp?.()?.currentUser?.id || ''),
        );
        users.push({
          index,
          label: `U${String(index + 1).padStart(2, '0')}`,
          stageName,
          location: { ...WORLD_STARTS[index]! },
          context: ready.context,
          page: ready.page,
          userId,
        });
      }

      await arrangeWindows(users);
      await users[0]!.page.bringToFront();
      await applyWorldMapDots(users);
      await openMapViewAndCenter(users, false);
      await assertAllUsersVisible(users);
      await users[0]!.page.waitForTimeout(2_000);

      const authoredTalks: Array<{ authorId: string; authorName: string; talkId: string; talkData: any }> = [];
      const talkDataById = new Map<string, any>();

      for (const user of users) {
        await user.page.evaluate(() => localStorage.setItem('chatbotEnabled', 'true'));
        const tag = `tag-${String(user.index + 1).padStart(2, '0')}`;
        const created = await createTagTalkViaEditor(user.page, {
          title: `${TALK_PREFIX}${String(user.index + 1).padStart(2, '0')} #${tag}`,
        });
        authoredTalks.push({
          authorId: user.userId,
          authorName: user.stageName,
          talkId: created.talkId,
          talkData: created.talkData,
        });
        talkDataById.set(created.talkId, created.talkData);
      }

      for (const talk of authoredTalks) {
        for (const receiver of users) {
          if (receiver.userId === talk.authorId) continue;
          await seedIncomingTalkWithRetry(receiver.page, {
            talkData: talk.talkData,
            senderId: talk.authorId,
            senderName: talk.authorName,
          });
        }
      }
      await afterSync();

      for (const user of users) {
        await expect.poll(async () => user.page.evaluate(async (prefix) => {
          const app = (window as any).__iinpublic_app?.getApp?.();
          await app?.syncIncomingClustersFromServer?.();
          const clusters = (await app?.getLocalIncomingClustersForE2e?.()) ?? [];
          return clusters.filter((entry: any) => String(entry?.title || '').startsWith(prefix)).length;
        }, TALK_PREFIX), { timeout: 180_000, intervals: [1_000, 2_000, 4_000] }).toBe(TOTAL_USERS - 1);
      }

      for (const user of users) {
        const incoming = await user.page.evaluate(async (prefix) => {
          const app = (window as any).__iinpublic_app?.getApp?.();
          await app?.syncIncomingClustersFromServer?.();
          const clusters = (await app?.getLocalIncomingClustersForE2e?.()) ?? [];
          return clusters
            .map((entry: any) => ({
              title: String(entry?.title || ''),
              talkId: String(entry?.latestTalkId || '').split('__')[0],
            }))
            .filter((entry: { title: string; talkId: string }) => entry.talkId && entry.title.startsWith(prefix))
            .sort((a: { title: string }, b: { title: string }) => a.title.localeCompare(b.title));
        }, TALK_PREFIX) as Array<{ title: string; talkId: string }>;

        expect(incoming.length).toBe(TOTAL_USERS - 1);
        for (let i = 0; i < incoming.length; i += 1) {
          const entry = incoming[i]!;
          const talkData = talkDataById.get(entry.talkId);
          if (!talkData) throw new Error(`missing local talk data for ${entry.talkId}`);
          await completeTalkInAppByAnswerIds(
            user.page,
            entry.talkId,
            talkData,
            ['a_0_match'],
            'match',
            i === 0 ? 'manual' : 'auto',
          );
        }
        await afterSync();
      }

      await travelUsersOneByOne(users);
      await users[0]!.page.bringToFront();
      await users[0]!.page.waitForTimeout(5_000);
    } finally {
      await Promise.all(users.map((user) =>
        user.page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {})));
      await Promise.all(users.map((user) => user.context.close().catch(() => {})));
      await browser.close().catch(() => {});
      await clearGunForStage1Spec();
    }
  });
});
