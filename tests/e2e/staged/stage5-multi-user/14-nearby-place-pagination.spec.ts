/**
 * Visible 20-user pagination journey: 14 in San Diego, 6 in Los Angeles.
 *
 * Capacity C = 3. The first user pages through all 13 other people in Nearby with one tag Talk per
 * page ("page1" … "page5"), creates a Place that five others enter ("custompage1", "custompage2"),
 * then travels to Los Angeles ("LAPage1", "LApage2"). Each tag reaches exactly the people on that
 * page, who like it; the author collects exactly those likes; nobody else holds it.
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
import { completeTalkInAppByAnswerIds } from '../../helpers/talk-demo-ui';
import type { TestActor } from '../../helpers/test-actor';
import { createTagTalk } from '../../journeys/nearby-ring-journey';

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

type Person = { page: Page; name: string; userId: string };

/** Incoming Talk titles on this device's own local graph (exact titles, not substrings). */
const incomingTalks = (page: Page): Promise<Array<{ title: string; talkId: string }>> => page.evaluate(async () => {
  const app = (window as any).__iinpublic_app?.getApp?.();
  const clusters = (await app?.getLocalIncomingClustersForE2e?.()) ?? [];
  return clusters.map((cluster: { title?: string; latestTalkId?: string }) => ({
    title: String(cluster.title || ''),
    talkId: String(cluster.latestTalkId || '').split('__')[0] || '',
  }));
});

/**
 * The first user's Talk exchanges with the people on their current page (Nearby or Place). Each
 * exchange: create a tag, broadcast, every person on the page receives and likes it, the author
 * collects exactly those likes, and nobody else holds that tag. A broadcast carries all of the
 * author's active Talks and each new audience catches up on them (§3.7 "A new group and a new Place
 * are the same kind of move"), so an older tag may also reach people met later — but never anyone
 * the author has not had on a page.
 */
class TalkExchanges {
  private readonly tags: string[] = [];
  private readonly met = new Set<string>();
  private readonly author: Person;

  constructor(private readonly people: Person[]) {
    this.author = people[0]!;
  }

  async run(title: string, expectedCount: number): Promise<void> {
    const { page } = this.author;
    const startedAt = Date.now();
    const pageIds: string[] = await page.evaluate(() => {
      const app = (window as any).__iinpublic_app?.getApp?.();
      const me = String(app?.currentUser?.id || '');
      return (app?.uiManager?.getCurrentChatroomMembers?.() ?? [])
        .map((member: { userId: string }) => member.userId)
        .filter((userId: string) => userId && userId !== me);
    });
    expect(pageIds, `${title}: the current page`).toHaveLength(expectedCount);
    const recipients = pageIds.map((userId) => this.people.find((person) => person.userId === userId)!);
    expect(recipients.every(Boolean)).toBe(true);
    pageIds.forEach((userId) => this.met.add(userId));

    const actor: TestActor = { id: this.author.name, runtime: 'browser', page };
    const talk = await createTagTalk(actor, title);
    const sent = await page.evaluate((count) =>
      (window as any).__iinpublic_app?.getApp?.()?.deliverPendingBroadcastTalksForE2e?.(count), expectedCount);
    expect(sent?.receivers, `${title}: broadcast audience`).toBe(expectedCount);

    // Every person on the page receives the tag and likes it.
    await Promise.all(recipients.map(async (person) => {
      let talkId = '';
      await expect.poll(async () => {
        talkId = (await incomingTalks(person.page)).find((entry) => entry.title === title)?.talkId ?? '';
        return talkId;
      }, { timeout: 120_000, intervals: [1_000, 2_000], message: `${person.name} should receive ${title}` }).not.toBe('');
      expect(talkId).toBe(talk.talkId);
      const talkData = await person.page.evaluate((id) =>
        (window as any).__iinpublic_app?.getApp?.()?.talkService?.getTalkWithRetry?.(id, { attempts: 30, gapMs: 250 }) ?? null, talkId);
      expect(talkData, `${person.name} should open ${title}`).toBeTruthy();
      await completeTalkInAppByAnswerIds(person.page, talkId, talkData, ['a_0_match'], 'match');
    }));

    // The author collects exactly those likes: one match conversation per person, for this tag.
    await expect.poll(() => page.evaluate((talkId) => {
      const conversations = (window as any).__iinpublic_app?.getApp?.()?.uiManager?.getMyConversations?.() ?? {};
      return Object.values(conversations)
        .filter((conversation: any) => conversation?.talkId === talkId)
        .map((conversation: any) => String(conversation.otherUserId))
        .sort();
    }, talk.talkId), { timeout: 120_000, intervals: [1_000, 2_000], message: `the author should collect ${title} likes` })
      .toEqual([...pageIds].sort());
    this.tags.push(title);

    // Nobody else holds this tag, and no earlier tag reached anyone the author never had on a page.
    await page.waitForTimeout(5_000);
    const holdings = await Promise.all(this.people.slice(1).map(async (person) => ({
      person,
      titles: new Set((await incomingTalks(person.page)).map((entry) => entry.title)),
    })));
    const holders = holdings.filter(({ titles }) => titles.has(title)).map(({ person }) => person.userId).sort();
    expect(holders, `only the people on this page should hold ${title}`).toEqual([...pageIds].sort());
    for (const earlier of this.tags) {
      const strangers = holdings
        .filter(({ person, titles }) => titles.has(earlier) && !this.met.has(person.userId))
        .map(({ person }) => person.name);
      expect(strangers, `${earlier} must not reach anyone the author never met`).toEqual([]);
    }
    console.log(`[20-user demo] ${title}: ${recipients.map((person) => person.name).join(', ')} liked it `
      + `(${Date.now() - startedAt} ms); nobody else holds it`);
  }
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

  test('first user exchanges one tag per page: 5 Nearby pages, 2 Place pages, 2 Los Angeles pages', async () => {
    test.setTimeout(2_400_000);
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
    // The app keeps running normally from here on: hub presence expires two reissue periods after
    // the last heartbeat, and the Talk exchanges below take longer than that.
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

    const people = await Promise.all(pages.map(async (page, index) => ({
      page,
      name: NAMES[index]!,
      userId: await page.evaluate(() => String((window as any).__iinpublic_app?.getApp?.()?.currentUser?.id || '')),
    })));
    const exchanges = new TalkExchanges(people);

    // Nearby, San Diego: one tag per page, each reaching exactly the people on that page.
    const nearbySeen = new Set<string>();
    const nearbyPageSizes = [3, 3, 3, 3, 1];
    for (const [index, expectedCount] of nearbyPageSizes.entries()) {
      const names = await expectFreshPage(() => nearbyNames(first), expectedCount, nearbySeen);
      console.log(`[20-user demo] Nearby page ${index + 1}: ${names.join(', ')}`);
      await exchanges.run(`page${index + 1}`, expectedCount);
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

    // Five other people enter the real Place. Keep the creator in front so each arrival is visible.
    const entrants = pages.slice(1, 6);
    for (const [index, entrant] of entrants.entries()) {
      await entrant.evaluate((id) =>
        (window as any).__iinpublic_app?.getApp?.()?.uiManager?.emit('chatroomChanged', id), placeId);
      await expect.poll(() => currentRoom(entrant), { timeout: 30_000 }).toBe(placeId);
      await first.bringToFront();
      console.log(`[20-user demo] ${NAMES[index + 1]} entered ${roomName}`);
      await visualPause(first, 0.5);
    }

    // A room switch commits before its fire-and-forget Place-card refresh necessarily finishes.
    // Make all six Place cards present before paging, especially in the zero-pause CI run.
    await Promise.all([first, ...entrants].map((page) => page.evaluate(async () => {
      await (window as any).__iinpublic_app?.getApp?.()?.nearbyV3?.service?.refresh?.();
    })));
    const entrantCards = await Promise.all(entrants.map((page) => page.evaluate(() =>
      (window as any).__iinpublic_app?.getApp?.()?.nearbyV3?.service?.card?.())));
    await first.evaluate(async (cards) => {
      const service = (window as any).__iinpublic_app?.getApp?.()?.nearbyV3?.service;
      for (const card of cards) await service?.offerCard?.(card);
    }, entrantCards);

    // Inside a Place the header counts its occupancy minus me: six people, "5 nearby", and the
    // online total does not change when people move from Nearby into a Place.
    // The header appends " · N matches" once likes arrive; the count part is its base text.
    await expect(first.locator('[data-testid="nearby-headcount"]')).toHaveAttribute('data-status-bar-base', '5 nearby · 20 online', { timeout: 60_000 });

    const placeSeen = new Set<string>();
    const firstPlacePage = await expectFreshPage(() => placeNames(first), 3, placeSeen);
    console.log(`[20-user demo] Place page 1: ${firstPlacePage.join(', ')}`);
    await expect(first.locator('[data-testid="nearby-group-bar"]')).toHaveCount(0);
    await expect(first.locator('[data-testid="nearby-meet-new-people-action"]')).toBeVisible();
    await exchanges.run('custompage1', 3);
    await visualPause(first);

    await first.locator('[data-testid="nearby-meet-new-people-action"]').click();
    await expect(first.locator('[data-testid="nearby-meet-confirm"]')).toHaveCount(0);
    const secondPlacePage = await expectFreshPage(() => placeNames(first), 2, placeSeen);
    console.log(`[20-user demo] Place page 2: ${secondPlacePage.join(', ')}`);
    await exchanges.run('custompage2', 2);
    await visualPause(first, 1.5);

    expect([...placeSeen].sort()).toEqual(NAMES.slice(1, 6).sort());
    expect(placeSeen.size).toBe(5);

    // Someone outside the Place sees it on the map as one icon carrying its full occupancy (6),
    // never as six yellow person dots (OPEN-86 E3/E5).
    const outsider = pages[7]!;
    await outsider.evaluate(async () => { await (window as any).__iinpublic_app?.getApp?.()?.refreshActiveRooms?.(); });
    await outsider.locator('[data-testid="chatroom-map-view-btn"]').click();
    await expect(outsider.locator(`.chatroom-map-marker[data-chatroom-id="${placeId}"] .chatroom-map-marker-count`))
      .toHaveText('6', { timeout: 60_000 });
    await outsider.locator('[data-testid="chatroom-list-view-btn"]').click();

    // The first user travels to Los Angeles: a new area, group 1, and six people there (R = 6 > C).
    await first.evaluate((point) =>
      (window as any).__iinpublic_app?.getApp?.()?.uiManager?.emit('travelNearbyAtPoint', point), LOS_ANGELES);
    await expect.poll(() => first.evaluate(() => {
      const card = (window as any).__iinpublic_app?.getApp?.()?.nearbyV3?.service?.card?.();
      return card ? { scope: card.scope, latitude: Math.round(card.point.latitude), traveler: card.traveler } : null;
    }), { timeout: 60_000 }).toEqual({ scope: 'nearby', latitude: 34, traveler: true });
    await expect(first.locator('[data-testid="nearby-headcount"]')).toHaveAttribute('data-status-bar-base', '6 nearby · 20 online', { timeout: 120_000 });
    const laSeen = new Set<string>();
    for (const [index, title] of ['LAPage1', 'LApage2'].entries()) {
      const names = await expectFreshPage(() => nearbyNames(first), 3, laSeen);
      console.log(`[20-user demo] Los Angeles page ${index + 1}: ${names.join(', ')}`);
      expect(names.every((name) => LOS_ANGELES_NAMES.includes(name))).toBe(true);
      await exchanges.run(title, 3);
      await visualPause(first);
      if (index === 0) await first.locator('[data-testid="nearby-meet-new-people-action"]').click();
    }
    expect([...laSeen].sort()).toEqual([...LOS_ANGELES_NAMES].sort());
  });
});
