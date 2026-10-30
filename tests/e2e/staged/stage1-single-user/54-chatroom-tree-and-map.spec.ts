/**
 * OPEN-40 Nearby + Places navigation. The geographic hierarchy is deliberately absent: the list
 * contains only Community-created Places; Nearby people are shown directly and the map shades no
 * locally derived Nearby cell.
 */
import { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { afterNav, afterSync } from '../../helpers/timing';
import { webBaseURL } from '../../helpers/ports';

test.describe('Nearby and Places list/map views', () => {
  let context: BrowserContext | undefined;
  let page: Page | undefined;

  test.beforeAll(async ({ browser }) => {
    await clearGunForStage1Spec();
    context = await browser.newContext({ viewport: { width: 900, height: 1100 }, deviceScaleFactor: 1, hasTouch: true });
    page = await context.newPage();
    await page.route('https://tiles.openfreemap.org/styles/liberty*', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        json: {
          version: 8,
          sources: {},
          layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#eef2f7' } }],
        },
      });
    });
    await injectIdbClear(page);
    await gotoWebApp(page, webBaseURL());
    await afterSync();
  });

  test.afterAll(async () => {
    await page?.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
    await context?.close().catch(() => {});
    await clearGunForStage1Spec();
  });

  const openList = async (): Promise<void> => {
    await page!.locator('.nav-btn[data-view="chatrooms"]').click();
    await afterNav();
    if (await page!.locator('#back-to-chatrooms').isVisible().catch(() => false)) {
      await page!.locator('#back-to-chatrooms').click();
      await afterNav();
    }
    await page!.locator('[data-testid="chatroom-list-view-btn"]').click();
  };

  test('list exposes no synthetic Nearby room or Global/tree/capacity shards', async () => {
    await openList();
    const currentRoomId = await page!.evaluate(() =>
      (window as any).__iinpublic_app?.getApp?.()?.getCurrentChatroomId?.() || '');
    expect(currentRoomId).toMatch(/^nearby-v3$/);

    await expect(page!.locator(`.chatroom-item[data-chatroom-id="${currentRoomId}"]`)).toHaveCount(0);
    await expect(page!.locator('[data-testid="nearby-people-section"]')).toBeVisible();
    await expect(page!.locator('.chatroom-item[data-chatroom-id="global"]')).toHaveCount(0);
    await expect(page!.locator('.chatroom-item[data-chatroom-id^="tile_"]')).toHaveCount(0);
    await expect(page!.locator('.chatroom-item[data-chatroom-id*="_part_"]')).toHaveCount(0);
    await expect(page!.locator('.chatroom-expand-icon')).toHaveCount(0);
  });

  test('map focuses on me without a shaded Nearby area or retired tile travel', async () => {
    await openList();
    await page!.locator('[data-testid="chatroom-map-view-btn"]').click();
    const map = page!.locator('[data-testid="chatroom-map"]');
    await expect(map).toBeVisible();
    await expect(map).toHaveClass(/maplibregl-map/, { timeout: 20_000 });
    // Nearby is my own list, not an area: nothing is shaded (§3.7 "Map, list and headcounts").
    await expect(map).not.toHaveAttribute('data-nearby-area-visible', 'true');
    await expect(page!.locator('#chatroom-map-status')).not.toContainText('shaded Nearby area');
    await expect(page!.locator('#return-home-btn')).toBeHidden();

    const box = (await map.boundingBox())!;
    await page!.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(map).not.toHaveAttribute('data-selected-tile', /.+/);
    await expect(map.locator('[data-testid="map-tile-card"]')).toHaveCount(0);
  });

  test('center on me keeps bottom navigation responsive', async () => {
    await openList();
    await page!.locator('[data-testid="chatroom-map-view-btn"]').click();
    const map = page!.locator('[data-testid="chatroom-map"]');
    await expect(map).toHaveClass(/maplibregl-map/, { timeout: 20_000 });
    await page!.evaluate(() => {
      (window as any).__iinpublic_app.getApp().uiManager.setMapUserDotSource({
        selfPoint: { latitude: 32.715, longitude: -117.16, precisionMeters: 400 },
        selfTraveler: true,
        load: async () => ({ dots: [], density: [] }),
      });
    });
    await map.locator('.chatroom-map-locate-self').click();
    await page!.locator('.nav-btn[data-view="settings"]').click({ timeout: 2_000 });
    await expect(page!.locator('.nav-btn[data-view="settings"]')).toHaveClass(/active/);
  });

  test('broadcast event handlers animate the map and core exchange updates change match badges', async () => {
    await openList();
    await page!.locator('[data-testid="chatroom-map-view-btn"]').click();
    const map = page!.locator('[data-testid="chatroom-map"]');
    await expect(map).toHaveClass(/maplibregl-map/, { timeout: 20_000 });
    // Deterministic public points; exercise the real app/UI handlers without a second device.
    await page!.evaluate(() => {
      const app = (window as any).__iinpublic_app.getApp();
      const point = { latitude: 32.715, longitude: -117.16, precisionMeters: 400 };
      app.uiManager.setMapUserDotSource({
        selfPoint: point, selfTraveler: true,
        isCandidate: () => true,
        load: async () => ({ dots: [{ ...point, userId: 'map-eve', traveler: false }], density: [] }),
      });
    });
    await expect(map.locator('[data-testid="map-user-dot-self"]')).toHaveCount(1);
    await expect(map.locator('[data-testid="map-user-dot-room"]')).toHaveCount(1);

    await page!.evaluate(() => {
      const app = (window as any).__iinpublic_app.getApp();
      app.startNearbyBroadcastProgress(app.getCurrentChatroomId(), ['map-qa-talk'], 1, ['map-eve']);
    });
    await expect(map.locator('[data-direction="outgoing"]')).toHaveCount(1);
    await page!.evaluate(() => {
      (window as any).__iinpublic_app.getApp().uiManager.displayIncomingTalk({
        id: 'map-incoming', title: 'Map test', authorName: 'Eve', type: 'tag',
        questionCount: 0, timestamp: new Date().toISOString(), isOwnTalk: false,
        fullTalk: { authorId: 'map-eve' },
      });
    });
    await expect(map.locator('[data-direction="incoming"]')).toHaveCount(1);
    await expect(map.locator('[data-event-id]')).toHaveCount(0, { timeout: 5_000 });

    await page!.evaluate(() => {
      const app = (window as any).__iinpublic_app.getApp();
      app.recordLocalTalkExchange('map-eve', 'Eve', 'map-qa-talk', { title: 'Map test', type: 'tag' }, 'match');
    });
    await expect(map.locator('[data-user-id="map-eve"][data-match-count="1"]')).toHaveCount(1);
    await expect.poll(() => page!.evaluate(async () => {
      const records = await (window as any).__iinpublic_app.getApp().gunService.getBridge().core({ name: 'exchanges.snapshot' });
      return records.some((record: any) => record.peerId === 'map-eve' && record.outcome === 'match');
    })).toBe(true);
    // Loading/recording matches is data hydration, not another incoming broadcast animation.
    await expect(map.locator('[data-event-id]')).toHaveCount(0);
    await page!.evaluate(() => {
      (window as any).__iinpublic_app.getApp().recordLocalTalkExchange(
        'map-eve', 'Eve', 'map-qa-talk', { title: 'Map test', type: 'tag' }, 'mismatch',
      );
    });
    await expect(map.locator('[data-match-count]')).toHaveCount(0);
  });

  test('map nodes open Me and relationships; exchange lines open focused Talks and return to the same map', async () => {
    await openList();
    await page!.locator('[data-testid="chatroom-map-view-btn"]').click();
    const map = page!.locator('[data-testid="chatroom-map"]');
    await expect(map).toHaveClass(/maplibregl-map/);
    await page!.evaluate(() => {
      const app = (window as any).__iinpublic_app.getApp();
      const point = { latitude: 32.715, longitude: -117.16, precisionMeters: 400 };
      app.uiManager.setMapUserDotSource({
        selfPoint: point, selfTraveler: true, isCandidate: (dot: any) => dot.userId === 'map-eve',
        load: async () => ({ dots: ['map-eve', 'map-stranger'].map((userId) => ({ ...point, userId, traveler: false })), density: [] }),
      });
      app.recordLocalTalkExchange('map-eve', 'Eve', 'map-qa-talk', { title: 'Map shared talk', type: 'flow' }, 'mismatch');
      (window as any).__iinpublic_collection_edit('myTalks', { set: {
        'map-qa-talk': { title: 'Map shared talk', type: 'flow', role: 'created', timestamp: new Date().toISOString(), fullTalk: { id: 'map-qa-talk', title: 'Map shared talk', type: 'flow', questions: [], status: 'active' } },
        'map-unrelated': { title: 'Unrelated map talk', type: 'flow', role: 'created', timestamp: new Date().toISOString(), fullTalk: { id: 'map-unrelated', title: 'Unrelated map talk', type: 'flow', questions: [], status: 'active' } },
      } });
    });
    await map.locator('.chatroom-map-locate-self').click();
    // Finish each MapLibre camera transition before the next zoom command.
    await page!.waitForTimeout(500);
    for (let i = 0; i < 4; i++) {
      await map.locator('.maplibregl-ctrl-zoom-in').click();
      await page!.waitForTimeout(500);
    }
    const line = map.locator('[data-testid="map-talk-line-label"][data-peer-id="map-eve"]');
    await expect(line).toBeVisible();
    await expect(line).toHaveText('1 Talk');
    await expect(map.locator('[data-testid="map-talk-line"]')).toHaveCount(1);
    const self = map.locator('[data-testid="map-user-dot-self"]');
    const peer = map.locator('[data-testid="map-user-dot-room"][data-user-id="map-eve"]');
    const before = await peer.boundingBox();

    await self.dblclick();
    await expect(page!.locator('.nav-btn[data-view="me"]')).toHaveClass(/active/);
    await page!.locator('#graph-back-btn').click();
    await expect(map).toBeVisible();
    await expect.poll(async () => {
      const box = await peer.boundingBox();
      return box && before ? Math.abs(box.x - before.x) + Math.abs(box.y - before.y) : Infinity;
    }).toBeLessThan(3);

    await peer.dblclick();
    await expect(page!.locator('.nav-btn[data-view="contacts"]')).toHaveClass(/active/);
    await expect(page!.locator('#peer-detail-overlay')).toBeVisible();
    expect(await page!.evaluate(() => ((window as any).__iinpublic_app.getApp().currentUser?.knownPeople ?? [])
      .some((person: any) => person.userId === 'map-eve'))).toBe(false);
    await page!.locator('#back-from-peer-detail').click();
    await expect(map).toBeVisible();
    await expect(page!.locator('#peer-detail-overlay')).toBeHidden();

    // Double-click the actual broad SVG line target, away from its label and endpoint dots.
    const point = await map.locator('[data-testid="map-talk-line"][data-peer-id="map-eve"]').evaluate((element) => {
      const bounds = element.closest('svg')!.getBoundingClientRect();
      const x1 = Number(element.getAttribute('x1')); const x2 = Number(element.getAttribute('x2'));
      const y1 = Number(element.getAttribute('y1')); const y2 = Number(element.getAttribute('y2'));
      return { x: bounds.left + x1 + (x2 - x1) * 0.35, y: bounds.top + y1 + (y2 - y1) * 0.35 };
    });
    await page!.mouse.dblclick(point.x, point.y);
    await expect(page!.locator('.nav-btn[data-view="talks"]')).toHaveClass(/active/);
    await expect(page!.locator('#talks-focus-chip')).toContainText('With map-eve');
    await expect(page!.locator('#talks-list')).toContainText('Map shared talk');
    await expect(page!.locator('#talks-list')).not.toContainText('Unrelated map talk');
    await page!.locator('#graph-back-btn').click();
    await expect(map).toBeVisible();
    await expect(line).toBeVisible();
    await expect.poll(async () => {
      const box = await peer.boundingBox();
      return box && before ? Math.abs(box.x - before.x) + Math.abs(box.y - before.y) : Infinity;
    }).toBeLessThan(3);

    // Phone-style single taps expose the same actions; the yellow person is not a travel click.
    await page!.setViewportSize({ width: 390, height: 844 });
    await self.tap();
    await page!.locator('[data-testid="map-self-open"]').tap();
    await expect(page!.locator('.nav-btn[data-view="me"]')).toHaveClass(/active/);
    await page!.locator('#graph-back-btn').click();
    await map.locator('[data-user-id="map-stranger"][data-testid="map-user-dot-other"]').tap();
    await expect(map.locator('[data-testid="map-member-travel"]')).toBeVisible();
    await expect(map.locator('[data-testid="map-member-profile"]')).toHaveText('👤 Relationship');
    await map.locator('[data-testid="map-member-talks"]').tap();
    await expect(page!.locator('#talks-focus-chip')).toContainText('With map-stra');
    await expect(page!.locator('#talks-list')).toContainText('No exchanged Talks with this person');
    await page!.locator('#graph-back-btn').click();
    await line.tap();
    await page!.locator('[data-testid="map-connection-open"]').tap();
    await expect(page!.locator('#talks-focus-chip')).toBeVisible();
    await page!.locator('#talks-focus-chip .focus-chip-clear').click();
    await expect(page!.locator('#talks-focus-chip')).toBeHidden();
    await expect(page!.locator('#talks-list')).toContainText('Unrelated map talk');
    await page!.setViewportSize({ width: 900, height: 1100 });
  });

  test('list puts me first and Places last, with downward sending and upward receiving waves', async () => {
    await openList();
    await page!.setViewportSize({ width: 390, height: 844 });
    await page!.evaluate(() => {
      const app = (window as any).__iinpublic_app.getApp();
      app.uiManager.updateChatroomMembers([
        { userId: 'list-eve', stageName: 'Eve' },
        { userId: app.currentUser.id, stageName: app.currentUser.stageName },
        { userId: 'list-bob', stageName: 'Bob' },
      ], app.currentUser.id);
      app.uiManager.setActiveRooms({ totalOnline: 5, totalRooms: 1, hasMore: false, rooms: [
        { roomId: 'place_32.71_-117.17_abcdefabcdef', kind: 'place', name: 'Coffee Place', memberCount: 2, latitude: 32.71, longitude: -117.17, distanceMeters: 100, bearingDegrees: 0 },
      ] });
    });
    const list = page!.locator('#chatroom-list');
    const self = list.getByTestId('nearby-self-row');
    await expect(self).toBeVisible();
    await expect(list.getByTestId('nearby-person-row')).toHaveText([/Eve/, /Bob/]);
    expect(await list.locator('[data-testid="nearby-people-section"] > :first-child').getAttribute('data-testid')).toBe('nearby-self-row');
    const place = list.getByTestId('rooms-near-you-section');
    await expect(place).toContainText('Coffee Place');
    expect((await place.boundingBox())!.y).toBeGreaterThan((await list.getByTestId('nearby-person-row').last().boundingBox())!.y);

    await page!.evaluate(() => {
      const app = (window as any).__iinpublic_app.getApp();
      app.startNearbyBroadcastProgress(app.getCurrentChatroomId(), ['list-qa-talk'], 2, ['list-eve', 'list-bob']);
      app.uiManager.displayIncomingTalk({
        id: 'list-incoming', title: 'List test', authorName: 'Eve', type: 'tag',
        questionCount: 0, timestamp: new Date().toISOString(), isOwnTalk: false,
        fullTalk: { authorId: 'list-eve' },
      });
    });
    const effects = list.getByTestId('list-broadcast-effects');
    await expect(effects.locator('[data-direction="outgoing"] line')).toHaveCount(2);
    await expect(effects.locator('[data-direction="incoming"] line')).toHaveCount(1);
    expect(await effects.locator('line').evaluateAll((lines) => lines.every((line) => {
      const delta = Number(line.getAttribute('y2')) - Number(line.getAttribute('y1'));
      return line.parentElement!.getAttribute('data-direction') === 'outgoing' ? delta > 0 : delta < 0;
    }))).toBe(true);
    await expect(effects).toContainText('Sending ↓Receiving ↑');
    await expect(place.locator('svg')).toHaveCount(0);
    await page!.screenshot({ path: '/tmp/iinpublic-list-broadcast-mobile.png' });
    // A roster refresh reattaches the existing overlay rather than restarting the event.
    const ids = await effects.locator('[data-event-id]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-event-id')));
    await page!.evaluate(() => (window as any).__iinpublic_app.getApp().uiManager.setNearbyCount(2));
    expect(await effects.locator('[data-event-id]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-event-id')))).toEqual(ids);
    await expect(effects.locator('[data-event-id]')).toHaveCount(0, { timeout: 5_000 });
    await self.tap();
    await expect(page!.locator('.nav-btn[data-view="me"]')).toHaveClass(/active/);
    await page!.locator('#graph-back-btn').click();
    await expect(list).toBeVisible();
    await expect(self).toBeVisible();
    expect(await page!.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page!.setViewportSize({ width: 900, height: 1100 });
  });


  test('Place member lists also keep me first and animate toward members', async () => {
    await openList();
    const placeId = 'place_32.71_-117.17_abcdefabcdef';
    await page!.evaluate((id) => (window as any).__iinpublic_app.getApp().uiManager.showChatroomDetail(id), placeId);
    await page!.waitForTimeout(500);
    await page!.evaluate((id) => {
      const app = (window as any).__iinpublic_app.getApp();
      app.uiManager.updateChatroomMembers([
        { userId: app.currentUser.id, stageName: app.currentUser.stageName },
        { userId: 'place-eve', stageName: 'Eve in Place' },
      ], app.currentUser.id);
      app.uiManager.animateMapBroadcast('outgoing', app.currentUser.id, id, ['place-eve']);
      app.uiManager.animateMapBroadcast('incoming', 'place-eve', id);
    }, placeId);
    const members = page!.locator('#chatroom-members-list');
    await expect(members.getByTestId('nearby-self-row')).toBeVisible();
    await expect(members.locator('.chatroom-member-item')).toHaveCount(1);
    const effects = members.getByTestId('list-broadcast-effects');
    await expect(effects.locator('[data-direction="outgoing"] line')).toHaveCount(1);
    await expect(effects.locator('[data-direction="incoming"] line')).toHaveCount(1);
    expect(await effects.locator('[data-direction="outgoing"] line').evaluate((line) =>
      Number(line.getAttribute('y2')) > Number(line.getAttribute('y1')))).toBe(true);
    await page!.screenshot({ path: '/tmp/iinpublic-list-broadcast-place.png' });
    await expect(effects.locator('[data-event-id]')).toHaveCount(0, { timeout: 5_000 });
  });

});
