/**
 * Visible 14-user pagination journey.
 *
 * Capacity C = 3. The first user pages through all 13 other people in Nearby, creates a Place,
 * then six other users enter it and the first user pages through both three-person Place groups.
 * The deliberate headed pauses make this suitable as both an E2E gate and a visual demo.
 */
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { getBrowserWindowWorkArea, setBrowserWindowBounds } from '../../helpers/browser-window';
import { clearGunForStage5Spec } from '../../helpers/e2e-stage-pipeline';
import { headless } from '../../helpers/timing';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';
import { bootstrapUser } from '../../helpers/talks-matching-flow';
import { webAppURLStableChatroom } from '../../helpers/ports';

/* eslint-disable @typescript-eslint/no-explicit-any */

const NAMES = [
  'onearby 0',
  ...Array.from({ length: 13 }, (_, index) => `Nearby ${String(index + 1).padStart(2, '0')}`),
];
const CAPACITY = 3;

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

const visualPause = async (page: Page, multiplier = 1): Promise<void> => {
  if (headless) return;
  await page.waitForTimeout(positiveInt(process.env.E2E_DEMO_PAUSE_MS, 2_000) * multiplier);
};

async function arrangeDemoWindows(pages: Page[]): Promise<void> {
  if (headless || pages.length === 0) return;

  const workArea = await getBrowserWindowWorkArea(pages[0]!);
  if (!workArea) throw new Error('14-user demo could not read the physical browser work area');

  // Reserve the entire left side for the actor. No peer window may sit above, below or behind it.
  // The other thirteen users may overlap one another in a readable diagonal cascade on the right.
  const margin = 12;
  const zoneGap = 24;
  const actorWidth = Math.floor(workArea.width * 0.46);
  const actorBounds = {
    left: workArea.left + margin,
    top: workArea.top + margin,
    width: actorWidth - margin,
    height: workArea.height - (margin * 2),
  };
  const peerZoneLeft = actorBounds.left + actorBounds.width + zoneGap;
  const peerZoneWidth = (workArea.left + workArea.width - margin) - peerZoneLeft;
  const peerWidth = Math.max(440, Math.floor(peerZoneWidth * 0.58));
  const peerHeight = Math.max(520, Math.floor(actorBounds.height * 0.52));
  const peerCount = pages.length - 1;
  const xStep = peerCount > 1
    ? Math.max(12, Math.floor((peerZoneWidth - peerWidth) / (peerCount - 1)))
    : 0;
  const yStep = peerCount > 1
    ? Math.max(12, Math.floor((actorBounds.height - peerHeight) / (peerCount - 1)))
    : 0;
  const requested = [
    actorBounds,
    ...pages.slice(1).map((_, index) => ({
      left: peerZoneLeft + (index * xStep),
      top: workArea.top + margin + (index * yStep),
      width: peerWidth,
      height: peerHeight,
    })),
  ];
  const placements = [];
  for (const [index, page] of pages.entries()) {
    const placement = await setBrowserWindowBounds(page, requested[index]!);
    if (placement) placements.push(placement);
  }

  const windowIds = new Set(placements.map(({ windowId }) => windowId));
  const positions = new Set(placements.map(({ bounds }) => `${bounds.left},${bounds.top}`));
  const overlaps = (a: typeof actorBounds, b: typeof actorBounds): boolean =>
    a.left < b.left + b.width && a.left + a.width > b.left
      && a.top < b.top + b.height && a.top + a.height > b.top;
  const actorOverlaps = placements.slice(1)
    .map(({ bounds }, index) => overlaps(placements[0]!.bounds, bounds) ? index + 1 : undefined)
    .filter((index): index is number => index !== undefined);
  if (placements.length !== pages.length || windowIds.size !== pages.length
      || positions.size !== pages.length || actorOverlaps.length > 0) {
    throw new Error(
      `14-user demo window layout failed: ${placements.length} placements, ${windowIds.size} windows, `
        + `${positions.size} positions, actor overlaps peers=${actorOverlaps.join(',') || 'none'}`,
    );
  }

  await pages[0]!.bringToFront();
  console.log(
    `[14-user demo] ${NAMES[0]} is alone at ${placements[0]!.bounds.left},${placements[0]!.bounds.top} `
      + `(${placements[0]!.bounds.width}×${placements[0]!.bounds.height}); `
      + `13 peers cascade on the right by ${xStep}×${yStep}px.`,
  );
}

const nearbyNames = async (page: Page): Promise<string[]> =>
  page.locator('[data-testid="nearby-person-row"]').evaluateAll((rows) =>
    rows.map((row) => row.getAttribute('data-stage-name') || '').filter(Boolean));

const placeNames = async (page: Page): Promise<string[]> =>
  page.locator('#chatroom-members-list .chatroom-member-item').evaluateAll((rows) =>
    rows.map((row) => row.getAttribute('data-stage-name') || '').filter(Boolean));

async function expectFreshPage(
  readNames: () => Promise<string[]>,
  expectedCount: number,
  alreadySeen: Set<string>,
): Promise<string[]> {
  await expect.poll(async () => {
    const names = await readNames();
    return names.length === expectedCount && names.every((name) => !alreadySeen.has(name));
  }, { timeout: 120_000, intervals: [250, 500, 1_000] }).toBe(true);
  const names = await readNames();
  names.forEach((name) => alreadySeen.add(name));
  return names;
}

test.describe('14-user Nearby and Place pagination demo', () => {
  test.describe.configure({ retries: 0 });
  let browser: Browser | undefined;
  const contexts: BrowserContext[] = [];
  const pages: Page[] = [];

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage5Spec();
  });

  test.afterAll(async () => {
    await Promise.all(pages.map((page) =>
      page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {})));
    await Promise.all(contexts.map((context) => context.close().catch(() => {})));
    await browser?.close().catch(() => {});
    await clearGunForStage5Spec();
  });

  test('first user sees 13 Nearby people, then all 6 people in a custom Place', async () => {
    test.setTimeout(900_000);
    const appUrl = new URL(webAppURLStableChatroom());
    appUrl.searchParams.set('e2e_capacity', String(CAPACITY));
    appUrl.searchParams.set('e2e_place_min_friends', '0');

    browser = await chromium.launch({
      headless,
      slowMo: headless ? 0 : positiveInt(process.env.PW_SLOW_MO, 180),
      args: [
        ...WEBRTC_CHROMIUM_ARGS,
        '--window-position=80,40',
        '--window-size=720,1080',
        '--force-device-scale-factor=1',
      ],
    });

    // Keep setup bounded on a laptop: four independent identities bootstrap at a time in one
    // browser process. Each still owns a separate browser context and local identity database.
    for (let start = 0; start < NAMES.length; start += 4) {
      const batch = NAMES.slice(start, start + 4);
      const ready = await Promise.all(batch.map((name, offset) =>
        bootstrapUser(browser!, `U${start + offset + 1}`, name, 60_000, appUrl.toString())));
      ready.forEach(({ context, page }) => {
        contexts.push(context);
        pages.push(page);
      });
    }

    // Keep the actor easy to follow: onearby 0 owns the entire left side with no window above,
    // below or behind it, while every supporting user remains in a title-bar cascade on the right.
    await arrangeDemoWindows(pages);

    const first = pages[0]!;
    // Bootstrapping 14 full app identities takes longer than the hub's narrow online window on a
    // development laptop. Refresh every already-signed card together so this begins with fourteen
    // genuinely live participants rather than letting the earliest setup tabs age out.
    await Promise.all(pages.map((page) => page.evaluate(async () => {
      const app = (window as any).__iinpublic_app?.getApp?.();
      const runtime = app?.nearbyV3;
      await runtime?.service?.refresh?.();
      const card = runtime?.service?.card?.();
      if (card) await runtime.hub.heartbeat(card);
    })));
    await expect.poll(() => Promise.all(pages.map((page) => page.evaluate(() =>
      String((window as any).__iinpublic_app?.getApp?.()?.nearbyV3?.service?.card?.()?.stageName || '')))),
    { timeout: 60_000, intervals: [250, 500, 1_000] }).toEqual(NAMES);
    // Freeze periodic background swaps for the visual demo. Explicit page turns and scope changes
    // still call refresh themselves, while the three rows being inspected no longer reshuffle
    // during the deliberate two-second pause between actions.
    await Promise.all(pages.map((page) => page.evaluate(() =>
      (window as any).__iinpublic_app?.getApp?.()?.nearbyV3?.service?.stop?.())));
    await first.waitForTimeout(1_000);
    // The first page may have cached cards received before peers finished their profile rename.
    // Merge every peer's newly signed card into the first user's bounded list. This refreshes any
    // cached row without marking that person unreachable or excluding them from a later page.
    const peerCards = await Promise.all(pages.slice(1).map((page) => page.evaluate(() =>
      (window as any).__iinpublic_app?.getApp?.()?.nearbyV3?.service?.card?.())));
    await first.evaluate(async (cards) => {
      const service = (window as any).__iinpublic_app?.getApp?.()?.nearbyV3?.service;
      for (const card of cards) await service?.offerCard?.(card);
    }, peerCards);
    await first.evaluate(async () => {
      const app = (window as any).__iinpublic_app?.getApp?.();
      await app?.refreshActiveRooms?.();
    });
    await first.bringToFront();
    await expect(first.locator('[data-testid="nearby-headcount"]')).toHaveText(
      '3 near you · 14 online',
      { timeout: 120_000 },
    );
    await expect(first.locator('[data-testid="room-list-total"]')).toHaveCount(0);

    const nearbySeen = new Set<string>();
    const nearbyPageSizes = [3, 3, 3, 3, 1];
    for (const [index, expectedCount] of nearbyPageSizes.entries()) {
      const names = await expectFreshPage(() => nearbyNames(first), expectedCount, nearbySeen);
      console.log(`[14-user demo] Nearby page ${index + 1}: ${names.join(', ')}`);
      await visualPause(first);
      if (index === nearbyPageSizes.length - 1) break;

      await first.locator('[data-testid="nearby-meet-new-people-action"]').click();
      await expect(first.locator('[data-testid="nearby-meet-confirm"]')).toBeVisible();
      await visualPause(first, 0.5);
      await first.locator('[data-testid="nearby-meet-confirm-action"]').click();
    }

    expect([...nearbySeen].sort()).toEqual(NAMES.slice(1).sort());
    expect(nearbySeen.size).toBe(13);

    // The first user creates the Place through the real UI while still visible.
    const roomName = `Capacity Three Room ${Date.now()}`;
    await first.locator('#create-custom-chatroom-btn').click();
    await expect(first.locator('[data-testid="custom-room-name-input"]')).toBeVisible();
    await first.locator('[data-testid="custom-room-name-input"]').fill(roomName);
    await visualPause(first);
    await first.locator('[data-testid="custom-room-submit-btn"]').click();
    const currentRoom = (page: Page) => page.evaluate(() =>
      String((window as any).__iinpublic_app?.getApp?.()?.currentChatroomId || ''));
    await expect.poll(() => currentRoom(first), { timeout: 30_000 }).toMatch(/^place_/);
    const placeId = await currentRoom(first);
    await expect(first.locator('#current-chatroom-title')).toContainText(roomName);
    await visualPause(first);

    // Six other people enter the real Place. Keep the creator in front so each arrival is visible.
    const entrants = pages.slice(1, 7);
    for (const [index, entrant] of entrants.entries()) {
      await entrant.evaluate((id) =>
        (window as any).__iinpublic_app?.getApp?.()?.uiManager?.emit('chatroomChanged', id), placeId);
      await expect.poll(() => currentRoom(entrant), { timeout: 30_000 }).toBe(placeId);
      await first.bringToFront();
      console.log(`[14-user demo] ${NAMES[index + 1]} entered ${roomName}`);
      await visualPause(first, 0.5);
    }

    // A room switch commits before its fire-and-forget Place-card refresh necessarily finishes.
    // Make all seven Place cards present before paging, especially in the zero-pause CI run.
    await Promise.all([first, ...entrants].map((page) => page.evaluate(async () => {
      await (window as any).__iinpublic_app?.getApp?.()?.nearbyV3?.service?.refresh?.();
    })));
    const entrantCards = await Promise.all(entrants.map((page) => page.evaluate(() =>
      (window as any).__iinpublic_app?.getApp?.()?.nearbyV3?.service?.card?.())));
    await first.evaluate(async (cards) => {
      const service = (window as any).__iinpublic_app?.getApp?.()?.nearbyV3?.service;
      for (const card of cards) await service?.offerCard?.(card);
    }, entrantCards);

    const placeSeen = new Set<string>();
    const firstPlacePage = await expectFreshPage(() => placeNames(first), 3, placeSeen);
    console.log(`[14-user demo] Place page 1: ${firstPlacePage.join(', ')}`);
    await expect(first.locator('[data-testid="nearby-group-bar"]')).toHaveCount(0);
    await expect(first.locator('[data-testid="nearby-meet-new-people-action"]')).toBeVisible();
    await visualPause(first);

    await first.locator('[data-testid="nearby-meet-new-people-action"]').click();
    await expect(first.locator('[data-testid="nearby-meet-confirm"]')).toContainText(
      'Swap these 3 people for the next people in this Place.',
    );
    await visualPause(first, 0.5);
    await first.locator('[data-testid="nearby-meet-confirm-action"]').click();
    const secondPlacePage = await expectFreshPage(() => placeNames(first), 3, placeSeen);
    console.log(`[14-user demo] Place page 2: ${secondPlacePage.join(', ')}`);
    await visualPause(first, 1.5);

    expect([...placeSeen].sort()).toEqual(NAMES.slice(1, 7).sort());
    expect(placeSeen.size).toBe(6);
  });
});
