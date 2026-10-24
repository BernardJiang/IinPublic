/**
 * Chatrooms browser layout and Nearby paging (docs/design/nearby-and-place-chatrooms.md §3.7):
 * people come first, three custom rooms follow, and the top row owns the headcount. With C = 3,
 * Adam's first page holds three of the four other people. The compact AppBar action advances to the
 * remaining person, who receives Adam's active Talk without a new broadcast. That is the last page,
 * so the action disappears; "Back to group 1" returns to page 1.
 */
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage4Spec } from '../../helpers/e2e-stage-pipeline';
import { headless } from '../../helpers/timing';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';
import { bootstrapUser } from '../../helpers/talks-matching-flow';
import { webAppURLStableChatroom } from '../../helpers/ports';
import { createTagTalk, waitForIncomingTalk } from '../../journeys/nearby-ring-journey';
import type { TestActor } from '../../helpers/test-actor';

/* eslint-disable @typescript-eslint/no-explicit-any */
const NAMES = ['Adam', 'Eve', 'Bob', 'Alice', 'Carol'] as const;

const groupMembers = (page: Page) => page.locator('[data-testid="nearby-person-row"]');
const memberNames = async (page: Page): Promise<string[]> =>
  (await groupMembers(page).evaluateAll((rows) => rows.map((row) => row.getAttribute('data-stage-name') || ''))).sort();

test.describe('Chatroom browser layout and Nearby paging (§3.7)', () => {
  const browsers: Browser[] = [];
  const contexts: BrowserContext[] = [];
  const pages: Page[] = [];

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage4Spec();
  });

  test.afterAll(async () => {
    await Promise.all(pages.map((page) =>
      page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {})));
    await Promise.all(contexts.map((context) => context.close().catch(() => {})));
    await Promise.all(browsers.map((browser) => browser.close().catch(() => {})));
    await clearGunForStage4Spec();
  });

  test('people-first multi-room layout; page 1 → last page 2 → page 1', async () => {
    test.setTimeout(420_000);
    // C = 3: each person's page holds at most three of the four others.
    const url = webAppURLStableChatroom().replace('e2e_capacity=50', 'e2e_capacity=3');
    browsers.push(...await Promise.all(NAMES.map(() => chromium.launch({ headless, args: [...WEBRTC_CHROMIUM_ARGS] }))));
    for (const [index, name] of NAMES.entries()) {
      const { context, page } = await bootstrapUser(browsers[index], name, `${name} G`, 30_000, url);
      contexts.push(context);
      pages.push(page);
    }
    const [adam, ...others] = pages;
    const othersByName = new Map(others.map((page, i) => [`${NAMES[i + 1]} G`, page]));
    await adam.evaluate(async () => {
      const runtime = (window as any).__iinpublic_app?.getApp?.()?.nearbyV3;
      const card = runtime?.service?.card?.();
      if (card) await runtime.hub.heartbeat(card);
    });

    // Page 1 is already the root screen: no Nearby room or redundant people heading.
    await expect(groupMembers(adam)).toHaveCount(3, { timeout: 90_000 });
    await expect(adam.locator('[data-testid="nearby-headcount"]')).toContainText('4 nearby', { timeout: 90_000 });
    await expect(adam.getByText('People near you', { exact: true })).toHaveCount(0);
    await expect(adam.getByText('Loading rooms…', { exact: true })).toHaveCount(0);
    await expect(adam.locator('.chatroom-item[data-chatroom-id="nearby-v3"]')).toHaveCount(0);

    // Exercise the actual browser layout with several custom rooms. The app's public UI methods
    // receive the same catalogue/active-room shapes that its network refresh supplies.
    await adam.evaluate(() => {
      const ui = (window as any).__iinpublic_app?.getApp?.()?.uiManager;
      const rooms = [
        { id: 'place_32.71_-117.17_111111111111', name: 'Coffee Room', type: 'business', description: 'Coffee', location: { latitude: 32.71, longitude: -117.17 } },
        { id: 'place_32.72_-117.18_222222222222', name: 'Book Room', type: 'custom', description: 'Books', location: { latitude: 32.72, longitude: -117.18 } },
        { id: 'place_32.73_-117.19_333333333333', name: 'Music Room', type: 'custom', description: 'Music', location: { latitude: 32.73, longitude: -117.19 } },
      ];
      ui?.setCustomChatroomsFromServer(rooms);
      ui?.setActiveRooms({
        totalOnline: 5,
        totalRooms: 3,
        hasMore: false,
        rooms: rooms.map((room, index) => ({
          roomId: room.id,
          kind: 'place',
          name: room.name,
          memberCount: index + 1,
          latitude: room.location.latitude,
          longitude: room.location.longitude,
          distanceMeters: 1_000 + index * 500,
          bearingDegrees: 90,
        })),
      });
      ui?.setNearbyOnline(5);
    });
    await expect(adam.locator('[data-testid="nearby-headcount"]')).toHaveText('4 nearby · 5 online');
    const sections = adam.locator('[data-testid="nearby-browser-list"] > section');
    await expect(sections).toHaveCount(2);
    await expect(sections.nth(0)).toHaveAttribute('data-testid', 'nearby-people-section');
    await expect(sections.nth(1)).toHaveAttribute('data-testid', 'rooms-near-you-section');
    const roomRows = adam.locator('[data-testid="room-list-row"]');
    await expect(roomRows).toHaveCount(3);
    await expect(adam.locator('[data-testid="room-list-sort"]')).toBeVisible();
    await expect(roomRows.locator('.chatroom-icon')).toHaveText(['🚪', '🚪', '🚪']);
    await expect(roomRows.locator('.chatroom-name')).toHaveText(['Coffee Room', 'Book Room', 'Music Room']);

    const meetAction = adam.locator('[data-testid="nearby-meet-new-people-action"]');
    await expect(meetAction).toBeVisible();
    await expect(meetAction).toHaveAttribute('aria-label', 'Meet new people');
    await expect(adam.locator('[data-testid="nearby-group-bar"]')).toHaveCount(0);
    const firstSeenGroup = await memberNames(adam);

    // Online dots come from the hub's card heartbeats (refreshed at start and every minute).
    await expect(adam.locator('[data-testid="nearby-person-row"] .presence-indicator.online')).toHaveCount(3, { timeout: 75_000 });

    // Adam's active Talk reaches his group.
    const adamActor: TestActor = { id: 'Adam', runtime: 'browser', page: adam };
    const talk = await createTagTalk(adamActor, `meet-new-people-${Date.now()}`);
    const sent = await adam.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.deliverPendingBroadcastTalksForE2e?.(1));
    expect(sent?.talksSent ?? 0).toBeGreaterThan(0);
    for (const name of firstSeenGroup) {
      expect(await waitForIncomingTalk(othersByName.get(name)!, name, talk.title)).toBe(talk.talkId);
    }

    // Meet new people: one click goes directly to group 2, the person Adam had not met yet.
    // Capture group 1 immediately before the swap. While the four new users gossip, Adam can learn
    // a higher-ranked card and legitimately replace one of the first two rows shown above.
    const group1 = await memberNames(adam);
    const notMet = [...othersByName.keys()].filter((name) => !group1.includes(name));
    expect(notMet).toHaveLength(1);
    await meetAction.click();
    await expect(adam.locator('[data-testid="nearby-meet-confirm"]')).toHaveCount(0);
    await expect.poll(() => memberNames(adam), { timeout: 90_000 }).toEqual(notMet);
    await expect(adam.locator('[data-testid="nearby-headcount"]')).toContainText('4 nearby');
    await expect(adam.locator('[data-testid="nearby-back-to-first-group-action"]')).toBeVisible();
    // The new person gets Adam's active Talk without another broadcast (same as entering a Place).
    expect(await waitForIncomingTalk(othersByName.get(notMet[0]!)!, notMet[0]!, talk.title)).toBe(talk.talkId);

    // Group 2 is the last page: the hub reports no next one, so the action disappears instead of
    // leading to an empty group (OPEN-86 E1).
    await expect(meetAction).toBeHidden({ timeout: 30_000 });
    await expect(groupMembers(adam)).toHaveCount(1);

    // Back to group 1: the currently highest-ranked two again. Membership can differ from the
    // early snapshot if gossip learned a better-ranked card while Adam visited later groups.
    await adam.locator('[data-testid="nearby-back-to-first-group-action"]').click();
    await expect(groupMembers(adam)).toHaveCount(3, { timeout: 90_000 });
    const returnedGroup = await memberNames(adam);
    expect(returnedGroup.every((name) => othersByName.has(name))).toBe(true);
    expect(new Set(returnedGroup).size).toBe(3);
  });
});
