/**
 * Visible 20-user pagination journey: 14 in San Diego, 6 in Los Angeles.
 *
 * Capacity C = 3. The first user pages through all 13 other people in Nearby, creates a Place,
 * then six other users enter it and the first user pages through both three-person Place groups.
 * The deliberate headed pauses make this suitable as both an E2E gate and a visual demo.
 */
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import {
  getBrowserWindowWorkArea,
  setBrowserWindowBounds,
  type BrowserWindowBounds,
} from '../../helpers/browser-window';
import { clearGunForStage5Spec } from '../../helpers/e2e-stage-pipeline';
import { headless } from '../../helpers/timing';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';
import { bootstrapUser } from '../../helpers/talks-matching-flow';
import { webAppURLStableChatroom } from '../../helpers/ports';

/* eslint-disable @typescript-eslint/no-explicit-any */

const SAN_DIEGO_NAMES = [
  'onearby 0',
  ...Array.from({ length: 13 }, (_, index) => `Nearby ${String(index + 1).padStart(2, '0')}`),
];
const LOS_ANGELES_NAMES = Array.from(
  { length: 6 },
  (_, index) => `Los Angeles ${String(index + 1).padStart(2, '0')}`,
);
const NAMES = [...SAN_DIEGO_NAMES, ...LOS_ANGELES_NAMES];
const SAN_DIEGO = { latitude: 32.7157, longitude: -117.1611 };
const LOS_ANGELES = { latitude: 34.0522, longitude: -118.2437 };
const CAPACITY = 3;

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

const visualPause = async (page: Page, multiplier = 1): Promise<void> => {
  if (headless) return;
  await page.waitForTimeout(positiveInt(process.env.E2E_DEMO_PAUSE_MS, 2_000) * multiplier);
};

interface DemoWindowLayout {
  workArea: BrowserWindowBounds;
  actorBounds: BrowserWindowBounds;
  peerBounds: BrowserWindowBounds[];
  xStep: number;
  yStep: number;
}

async function createDemoWindowLayout(first: Page, pageCount: number): Promise<DemoWindowLayout> {
  const workArea = await getBrowserWindowWorkArea(first);
  if (!workArea) throw new Error('20-user demo could not read the physical browser work area');

  // Reserve the entire left side for the actor. No peer window may sit above, below or behind it.
  // The other nineteen users may overlap one another in a readable diagonal cascade on the right.
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
  const peerCount = pageCount - 1;
  const xStep = peerCount > 1
    ? Math.max(12, Math.floor((peerZoneWidth - peerWidth) / (peerCount - 1)))
    : 0;
  const yStep = peerCount > 1
    ? Math.max(12, Math.floor((actorBounds.height - peerHeight) / (peerCount - 1)))
    : 0;
  const peerBounds = Array.from({ length: peerCount }, (_, index) => ({
      left: peerZoneLeft + (index * xStep),
      top: workArea.top + margin + (index * yStep),
      width: peerWidth,
      height: peerHeight,
    }));
  return { workArea, actorBounds, peerBounds, xStep, yStep };
}

async function arrangeDemoWindows(pages: Page[], layout: DemoWindowLayout): Promise<void> {
  if (headless || pages.length === 0) return;

  const requested = [layout.actorBounds, ...layout.peerBounds];
  const placements = [];
  for (const [index, page] of pages.entries()) {
    const placement = await setBrowserWindowBounds(page, requested[index]!);
    if (placement) placements.push(placement);
  }

  const windowIds = new Set(placements.map(({ windowId }) => windowId));
  const positions = new Set(placements.map(({ bounds }) => `${bounds.left},${bounds.top}`));
  const overlaps = (a: BrowserWindowBounds, b: BrowserWindowBounds): boolean =>
    a.left < b.left + b.width && a.left + a.width > b.left
      && a.top < b.top + b.height && a.top + a.height > b.top;
  const actorOverlaps = placements.slice(1)
    .map(({ bounds }, index) => overlaps(placements[0]!.bounds, bounds) ? index + 1 : undefined)
    .filter((index): index is number => index !== undefined);
  if (placements.length !== pages.length || windowIds.size !== pages.length
      || positions.size !== pages.length || actorOverlaps.length > 0) {
    throw new Error(
      `20-user demo window layout failed: ${placements.length} placements, ${windowIds.size} windows, `
        + `${positions.size} positions, actor overlaps peers=${actorOverlaps.join(',') || 'none'}`,
    );
  }

  await pages[0]!.bringToFront();
  console.log(
    `[20-user demo] ${NAMES[0]} is alone at ${placements[0]!.bounds.left},${placements[0]!.bounds.top} `
      + `(${placements[0]!.bounds.width}×${placements[0]!.bounds.height}); `
      + `${pages.length - 1} peers cascade on the right by ${layout.xStep}×${layout.yStep}px.`,
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

test.describe('20-user San Diego/Los Angeles Nearby and Place pagination demo', () => {
  test.describe.configure({ retries: 0 });
  const browsers: Browser[] = [];
  const contexts: BrowserContext[] = [];
  const pages: Page[] = [];

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage5Spec();
  });

  test.afterAll(async () => {
    await Promise.all(pages.map((page) =>
      page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {})));
    await Promise.all(contexts.map((context) => context.close().catch(() => {})));
    await Promise.all(browsers.map((browser) => browser.close().catch(() => {})));
    await clearGunForStage5Spec();
  });

  test('first user sees 13 Nearby people, then all 6 people in a custom Place', async () => {
    test.setTimeout(900_000);
    const appUrl = new URL(webAppURLStableChatroom());
    appUrl.searchParams.set('e2e_capacity', String(CAPACITY));
    appUrl.searchParams.set('e2e_place_min_friends', '0');

    const launchBrowser = (bounds?: BrowserWindowBounds): Promise<Browser> => chromium.launch({
      headless,
      slowMo: headless ? 0 : positiveInt(process.env.PW_SLOW_MO, 180),
      args: [
        ...WEBRTC_CHROMIUM_ARGS,
        `--window-position=${bounds?.left ?? 80},${bounds?.top ?? 40}`,
        `--window-size=${bounds?.width ?? 720},${bounds?.height ?? 1080}`,
        '--force-device-scale-factor=1',
      ],
    });

    // Create the actor first and alone in its own browser process. Only after it is fully ready and
    // placed in the reserved left zone do we start a second process for the supporting identities.
    const actorBrowser = await launchBrowser();
    browsers.push(actorBrowser);
    const actor = await bootstrapUser(actorBrowser, 'U1', NAMES[0]!, 60_000, appUrl.toString(), SAN_DIEGO);
    contexts.push(actor.context);
    pages.push(actor.page);

    let layout: DemoWindowLayout | undefined;
    let peerBrowser = actorBrowser;
    if (!headless) {
      layout = await createDemoWindowLayout(actor.page, NAMES.length);
      await setBrowserWindowBounds(actor.page, layout.actorBounds);
      await actor.page.bringToFront();
      console.log(`[20-user demo] Created ${NAMES[0]} separately.`);
      await visualPause(actor.page);

      // Every future window is born on the right, not over the actor. Peers share this second
      // process and may cover one another as the requested cascade grows.
      peerBrowser = await launchBrowser(layout.peerBounds[0]);
      browsers.push(peerBrowser);
    }

    if (headless) {
      // Preserve a fast CI setup; the visual transition is a headed-demo concern.
      for (let start = 1; start < NAMES.length; start += 4) {
        const batch = NAMES.slice(start, start + 4);
        const ready = await Promise.all(batch.map((name, offset) =>
          bootstrapUser(
            peerBrowser,
            `U${start + offset + 1}`,
            name,
            60_000,
            appUrl.toString(),
            start + offset < SAN_DIEGO_NAMES.length ? SAN_DIEGO : LOS_ANGELES,
          )));
        ready.forEach(({ context, page }) => {
          contexts.push(context);
          pages.push(page);
        });
      }
    } else {
      // In the visible demo, create and settle one user at a time so every transition is legible.
      for (let index = 1; index < NAMES.length; index += 1) {
        const ready = await bootstrapUser(
          peerBrowser,
          `U${index + 1}`,
          NAMES[index]!,
          60_000,
          appUrl.toString(),
          index < SAN_DIEGO_NAMES.length ? SAN_DIEGO : LOS_ANGELES,
        );
        contexts.push(ready.context);
        pages.push(ready.page);
        await setBrowserWindowBounds(ready.page, layout!.peerBounds[index - 1]!);
        await actor.page.bringToFront();
        console.log(`[20-user demo] Created ${NAMES[index]} (${index + 1}/${NAMES.length}).`);
        await actor.page.evaluate(async () => {
          const runtime = (window as any).__iinpublic_app?.getApp?.()?.nearbyV3;
          const card = runtime?.service?.card?.();
          if (card) await runtime.hub.heartbeat(card);
        });
        await visualPause(actor.page);
      }
      await arrangeDemoWindows(pages, layout!);
    }

    const first = pages[0]!;
    const cardLocations = await Promise.all(pages.map((page) => page.evaluate(() => {
      const point = (window as any).__iinpublic_app?.getApp?.()?.nearbyV3?.service?.card?.()?.point;
      return point ? `${point.latitude},${point.longitude},${point.precisionMeters}` : '';
    })));
    expect(new Set(cardLocations.slice(0, SAN_DIEGO_NAMES.length)).size).toBe(1);
    expect(new Set(cardLocations.slice(SAN_DIEGO_NAMES.length)).size).toBe(1);
    expect(cardLocations[0]).not.toBe(cardLocations.at(-1));
    const travelerFlags = await Promise.all(pages.map((page) => page.evaluate(() =>
      (window as any).__iinpublic_app?.getApp?.()?.nearbyV3?.service?.card?.()?.traveler)));
    expect(travelerFlags).toEqual(Array.from({ length: NAMES.length }, () => false));
    // Bootstrapping 20 full app identities takes longer than the hub's narrow online window on a
    // development laptop. Refresh every already-signed card together so this begins with twenty
    // genuinely live participants rather than letting the earliest setup tabs age out.
    await Promise.all(pages.map((page) => page.evaluate(async () => {
      const app = (window as any).__iinpublic_app?.getApp?.();
      const runtime = app?.nearbyV3;
      await runtime?.service?.refresh?.();
      const card = runtime?.service?.card?.();
      if (card) await runtime.hub.heartbeat(card);
    })));
    // The first pass makes every card live. Heartbeat once more only after that barrier so every
    // browser receives counts from the same complete population. Without this, a long headed run
    // could leave an early response at 10 San Diego users while later cards were still refreshing.
    await Promise.all(pages.map((page) => page.evaluate(async () => {
      const runtime = (window as any).__iinpublic_app?.getApp?.()?.nearbyV3;
      const card = runtime?.service?.card?.();
      if (card) await runtime.hub.heartbeat(card);
    })));
    await expect.poll(() => Promise.all(pages.map((page) => page.evaluate(() =>
      String((window as any).__iinpublic_app?.getApp?.()?.nearbyV3?.service?.card?.()?.stageName || '')))),
    { timeout: 60_000, intervals: [250, 500, 1_000] }).toEqual(NAMES);
    // Freeze periodic background swaps for the visual demo. Explicit page turns and scope changes
    // still call refresh themselves, while the three rows being inspected no longer reshuffle
    // during the deliberate two-second pause between actions. Freezing must not leave the hub
    // (a plain stop() is a logout since OPEN-85 and dropped everyone: "19 nearby · 0 online").
    await Promise.all(pages.map((page) => page.evaluate(() =>
      (window as any).__iinpublic_app?.getApp?.()?.nearbyV3?.service?.stop?.({ leave: false }))));
    await Promise.all(pages.slice(0, SAN_DIEGO_NAMES.length).map((page) =>
      expect(page.locator('[data-testid="nearby-headcount"]')).toHaveText(
        '13 nearby · 20 online',
        { timeout: 120_000 },
      )));
    await Promise.all(pages.slice(SAN_DIEGO_NAMES.length).map((page) =>
      expect(page.locator('[data-testid="nearby-headcount"]')).toHaveText(
        '5 nearby · 20 online',
        { timeout: 120_000 },
      )));
    if (!headless) {
      // Show one LA resident's final self-exclusive count, then restore the unobstructed actor.
      await pages[SAN_DIEGO_NAMES.length]!.bringToFront();
      await visualPause(first);
      await first.bringToFront();
      await visualPause(first);
    }
    await first.waitForTimeout(1_000);
    // The first page may have cached cards received before peers finished their profile rename.
    // Merge every peer's newly signed card into the first user's bounded list. This refreshes any
    // cached row without marking that person unreachable or excluding them from a later page.
    const peerCards = await Promise.all(pages.slice(1, SAN_DIEGO_NAMES.length).map((page) => page.evaluate(() =>
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
      '13 nearby · 20 online',
      { timeout: 120_000 },
    );
    await expect(first.locator('[data-testid="room-list-total"]')).toHaveCount(0);

    const nearbySeen = new Set<string>();
    const nearbyPageSizes = [3, 3, 3, 3, 1];
    for (const [index, expectedCount] of nearbyPageSizes.entries()) {
      const names = await expectFreshPage(() => nearbyNames(first), expectedCount, nearbySeen);
      console.log(`[20-user demo] Nearby page ${index + 1}: ${names.join(', ')}`);
      await visualPause(first);
      if (index === nearbyPageSizes.length - 1) break;

      await first.locator('[data-testid="nearby-meet-new-people-action"]').click();
      await expect(first.locator('[data-testid="nearby-meet-confirm"]')).toHaveCount(0);
    }

    expect([...nearbySeen].sort()).toEqual(SAN_DIEGO_NAMES.slice(1).sort());
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
      console.log(`[20-user demo] ${NAMES[index + 1]} entered ${roomName}`);
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

    // Inside a Place the header counts its occupancy minus me: seven people, "6 nearby", and the
    // online total does not change when people move from Nearby into a Place.
    await expect(first.locator('[data-testid="nearby-headcount"]')).toHaveText('6 nearby · 20 online', { timeout: 60_000 });

    const placeSeen = new Set<string>();
    const firstPlacePage = await expectFreshPage(() => placeNames(first), 3, placeSeen);
    console.log(`[20-user demo] Place page 1: ${firstPlacePage.join(', ')}`);
    await expect(first.locator('[data-testid="nearby-group-bar"]')).toHaveCount(0);
    await expect(first.locator('[data-testid="nearby-meet-new-people-action"]')).toBeVisible();
    await visualPause(first);

    await first.locator('[data-testid="nearby-meet-new-people-action"]').click();
    await expect(first.locator('[data-testid="nearby-meet-confirm"]')).toHaveCount(0);
    const secondPlacePage = await expectFreshPage(() => placeNames(first), 3, placeSeen);
    console.log(`[20-user demo] Place page 2: ${secondPlacePage.join(', ')}`);
    await visualPause(first, 1.5);

    expect([...placeSeen].sort()).toEqual(NAMES.slice(1, 7).sort());
    expect(placeSeen.size).toBe(6);
  });
});
