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
const VISIBLE_USERS = 6;
const CAPACITY = 3;
const TALK_PREFIX = 'MapOps user-';
const DELIVERY_POINT = { latitude: 32.7157, longitude: -117.1611 };

const INITIAL_MAP_LOCATIONS = [
  { latitude: 37.7749, longitude: -122.4194 }, // San Francisco
  { latitude: 40.7128, longitude: -74.0060 }, // New York
  { latitude: 51.5074, longitude: -0.1278 }, // London
  { latitude: 48.8566, longitude: 2.3522 }, // Paris
  { latitude: 35.6762, longitude: 139.6503 }, // Tokyo
  { latitude: -33.8688, longitude: 151.2093 }, // Sydney
] as const;

function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(raw || '', 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

async function visualPause(page: Page, multiplier = 1): Promise<void> {
  if (headless) return;
  await page.waitForTimeout(positiveInt(process.env.E2E_DEMO_PAUSE_MS, 2_500) * multiplier);
}

async function visualStepPause(page: Page): Promise<void> {
  if (headless) return;
  await page.waitForTimeout(positiveInt(process.env.E2E_TRAVEL_STEP_PAUSE_MS, 10_000));
}

async function mapCounts(page: Page): Promise<{ green: number; yellow: number }> {
  return page.evaluate(() => {
    const sum = (kind: 'room' | 'other') =>
      Array.from(document.querySelectorAll(`[data-testid="map-user-dot-${kind}"]`)).reduce((acc, node) => {
        const count = Number((node as HTMLElement).dataset.count || '1');
        return acc + (Number.isFinite(count) ? count : 1);
      }, 0);
    return { green: sum('room'), yellow: sum('other') };
  });
}

function distanceKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const x = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * (Math.sin(dLon / 2) ** 2);
  return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

async function injectDeterministicWorldMapDots(users: DemoUser[]): Promise<void> {
  for (const viewer of users) {
    const displayOffsets = [
      { lat: 0.008, lng: 0.006 },
      { lat: -0.010, lng: 0.009 },
      { lat: 0.011, lng: -0.008 },
      { lat: 0.017, lng: 0.014 },
      { lat: -0.018, lng: -0.015 },
    ];

    const others = users
      .filter((candidate) => candidate.userId !== viewer.userId)
      .map((candidate, index) => {
        const offset = displayOffsets[index % displayOffsets.length]!;
        return {
        userId: candidate.userId,
        latitude: viewer.location.latitude + offset.lat,
        longitude: viewer.location.longitude + offset.lng,
      };
      });

    const inReachIds = users
      .filter((candidate) => candidate.userId !== viewer.userId)
      .slice()
      .sort((a, b) =>
        distanceKm(viewer.location, a.location) - distanceKm(viewer.location, b.location))
      .slice(0, CAPACITY)
      .map((entry) => entry.userId);

    await viewer.page.evaluate(({ selfPoint, dots, reachable }) => {
      const app = (window as any).__iinpublic_app?.getApp?.();
      if (!app?.uiManager?.setMapUserDotSource) throw new Error('setMapUserDotSource unavailable');
      app.uiManager.setMapUserDotSource({
        selfPoint: { ...selfPoint, precisionMeters: 400 },
        selfTraveler: false,
        listPoints: () => dots.map((entry: { latitude: number; longitude: number }) => ({
          latitude: entry.latitude,
          longitude: entry.longitude,
        })),
        isCandidate: (dot: any) => reachable.includes(String(dot?.userId || '')),
        load: async () => ({
          dots: dots.map((item: { userId: string; latitude: number; longitude: number }) => ({
            userId: item.userId,
            latitude: item.latitude,
            longitude: item.longitude,
            precisionMeters: 400,
            traveler: false,
          })),
          density: [],
        }),
      });
    }, {
      selfPoint: viewer.location,
      dots: others,
      reachable: inReachIds,
    });
  }
}

async function openMapAndApplyShowcaseDots(users: DemoUser[]): Promise<void> {
  await injectDeterministicWorldMapDots(users);
  await Promise.all(users.map(async (user) => {
    await waitForTabActive(user.page, 'chatrooms');
    await user.page.locator('[data-testid="chatroom-map-view-btn"]').click();
    await expect(user.page.locator('[data-testid="chatroom-map"]')).toBeVisible({ timeout: 60_000 });
    const locateSelf = user.page.locator('.chatroom-map-locate-self');
    if (await locateSelf.isVisible().catch(() => false)) {
      await locateSelf.click();
    }
  }));
}

async function assertAllVisible(users: DemoUser[]): Promise<void> {
  for (const user of users.slice(0, VISIBLE_USERS)) {
    await expect
      .poll(async () => {
        const counts = await mapCounts(user.page);
        return counts.green + counts.yellow;
      }, { timeout: 60_000, intervals: [1_000, 2_000] })
      .toBe(TOTAL_USERS - 1);
  }
}

async function travelUsersIntoFirstRegionOneByOne(users: DemoUser[]): Promise<void> {
  const first = users[0]!;
  const regionCenter = { ...first.location };
  await first.page.bringToFront();
  await visualStepPause(first.page);

  for (let i = 1; i < users.length; i += 1) {
    users[i]!.location = {
      latitude: regionCenter.latitude + (i * 0.0015),
      longitude: regionCenter.longitude - (i * 0.0012),
    };
    await openMapAndApplyShowcaseDots(users);
    await assertAllVisible(users);
    await first.page.bringToFront();
    await visualStepPause(first.page);
  }
}

async function arrangeSixVisibleWindows(users: DemoUser[]): Promise<void> {
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

  const bounds: BrowserWindowBounds[] = Array.from({ length: VISIBLE_USERS }, (_, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    return {
      left: workArea.left + margin + (col * (cellWidth + margin)),
      top: workArea.top + margin + (row * (cellHeight + margin)),
      width: cellWidth,
      height: cellHeight,
    };
  });

  const placements = [];
  for (let i = 0; i < Math.min(VISIBLE_USERS, users.length); i += 1) {
    const placed = await setBrowserWindowBounds(users[i]!.page, bounds[i]!);
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
      const retryable =
        message.includes('Execution context was destroyed')
        || message.includes('Cannot find context with specified id')
        || message.includes('navigation');
      if (!retryable || attempt === 3) break;
      await page.waitForLoadState('load', { timeout: 20_000 }).catch(() => {});
      await afterSync();
    }
  }
  throw lastError;
}

test.describe('M6 map world operations showcase', () => {
  test('shows 6 side-by-side windows with 6 world users and tag/manual+auto flow', async () => {
    test.setTimeout(1_800_000);
    await clearGunForStage1Spec();

    const browser: Browser = await chromium.launch({
      headless,
      args: [...WEBRTC_CHROMIUM_ARGS, '--disable-dev-shm-usage'],
    });

    const users: DemoUser[] = [];
    const appUrl = new URL(webAppURLStableChatroom());
    appUrl.searchParams.set('e2e_capacity', String(CAPACITY));

    try {
      for (let i = 0; i < TOTAL_USERS; i += 1) {
        const stageName = `Map User ${String(i + 1).padStart(2, '0')}`;
        const ready = await bootstrapUser(
          browser,
          `M6-${i + 1}`,
          stageName,
          120_000,
          appUrl.toString(),
          DELIVERY_POINT,
        );
        const userId = await ready.page.evaluate(() =>
          String((window as any).__iinpublic_app?.getApp?.()?.currentUser?.id || ''),
        );
        users.push({
          index: i,
          label: `U${String(i + 1).padStart(2, '0')}`,
          stageName,
          location: INITIAL_MAP_LOCATIONS[i]!,
          context: ready.context,
          page: ready.page,
          userId,
        });
      }

      await arrangeSixVisibleWindows(users);
      await users[0]!.page.bringToFront();
      await openMapAndApplyShowcaseDots(users);

      await assertAllVisible(users);

      await visualPause(users[0]!.page, 2);
      await travelUsersIntoFirstRegionOneByOne(users);

      const authoredTalks: Array<{
        authorId: string;
        authorName: string;
        talkId: string;
        talkData: any;
      }> = [];
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

      for (const user of users.slice(0, VISIBLE_USERS)) {
        await waitForTabActive(user.page, 'chatrooms');
        await injectDeterministicWorldMapDots([user]);
        await user.page.locator('[data-testid="chatroom-map-view-btn"]').click();
        const locateSelf = user.page.locator('.chatroom-map-locate-self');
        if (await locateSelf.isVisible().catch(() => false)) {
          await locateSelf.click();
        }
      }
      await users[0]!.page.bringToFront();
      await visualPause(users[0]!.page, 5);
    } finally {
      await Promise.all(users.map((user) =>
        user.page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {})));
      await Promise.all(users.map((user) => user.context.close().catch(() => {})));
      await browser.close().catch(() => {});
      await clearGunForStage1Spec();
    }
  });
});
