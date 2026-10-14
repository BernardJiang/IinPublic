/**
 * Helpers for the phone-path journeys (see ./playwright.config.ts). Each user is a fresh browser
 * context pointed at a phone node's origin (or the hub's, for a plain web user), so every API
 * call takes the same route it takes on a real phone: WebView → embedded node → hub relay.
 */
import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { injectIdbClear } from '../helpers/clear-database';
import { waitForAppReady } from '../helpers/timing';
import { PHONE_PATH_PORTS, phonePathURL, type PhonePathOrigin } from './phone-path-ports';

/** A point in central San Diego; every journey user stands within a few hundred metres of it. */
export const JOURNEY_COORDS = { latitude: 32.7157, longitude: -117.1611 } as const;

export type JourneyUser = { label: string; origin: PhonePathOrigin; context: BrowserContext; page: Page };

/** Clear the hub and both phone nodes (in-memory graphs and per-run stores). */
export async function resetPhonePath(request: APIRequestContext): Promise<void> {
  for (const origin of Object.keys(PHONE_PATH_PORTS) as PhonePathOrigin[]) {
    const res = await request.post(`${phonePathURL(origin)}/api/test/clear-database`, { timeout: 30_000 });
    expect(res.ok(), `clear-database on ${origin}`).toBeTruthy();
  }
}

export type OpenUserOptions = {
  coords?: { latitude: number; longitude: number };
  /** Contacts needed to create a Place; journeys default to 0 so creation is not gated. */
  placeMinContacts?: number;
  extraQuery?: Record<string, string>;
};

export async function openUser(
  browser: Browser,
  label: string,
  origin: PhonePathOrigin,
  options: OpenUserOptions = {},
): Promise<JourneyUser> {
  const coords = options.coords ?? JOURNEY_COORDS;
  const context = await browser.newContext({
    viewport: { width: 480, height: 900 },
    geolocation: { latitude: coords.latitude, longitude: coords.longitude, accuracy: 10 },
    permissions: ['geolocation'],
  });
  const page = await context.newPage();
  page.on('console', (msg) => {
    if ((msg.type() === 'error' && process.env.PHONE_PATH_CONSOLE === '1') || process.env.PHONE_PATH_CONSOLE === 'all') {
      // eslint-disable-next-line no-console
      console.log(`[${label}] +${Date.now() % 100000} ${msg.text()}`);
    }
  });
  if (process.env.PHONE_PATH_CONSOLE) {
    page.on('response', async (res) => {
      if (res.status() < 400 && !(process.env.PHONE_PATH_TRACE_API === '1' && /\/api\/(chatrooms|active-rooms)/.test(res.url()))) return;
      const body = await res.text().catch(() => '');
      // eslint-disable-next-line no-console
      console.log(`[${label}] +${Date.now() % 100000} ${res.request().method()} ${res.url()} → ${res.status()} ${body.slice(0, 300)}`);
    });
  }
  await injectIdbClear(page);
  const query = new URLSearchParams({
    e2e_place_min_contacts: String(options.placeMinContacts ?? 0),
    ...options.extraQuery,
  });
  await page.goto(`${phonePathURL(origin)}/?${query.toString()}`);
  await page.waitForLoadState('load');
  await waitForAppReady(page, 60_000);
  await pinLocation(page, coords);
  return { label, origin, context, page };
}

/** Put the user's GPS fix in place directly, the same as `pinStableE2eLocation` does. */
export async function pinLocation(page: Page, coords: { latitude: number; longitude: number }): Promise<void> {
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__iinpublic_app?.getApp?.()?.currentUser?.id)), { timeout: 30_000 }).toBe(true);
  await page.evaluate(async ({ lat, lng }) => {
    const app = (window as any).__iinpublic_app?.getApp?.();
    const location = { latitude: lat, longitude: lng, accuracy: 10, timestamp: new Date() };
    app.currentLocation = location;
    app.uiManager?.setCurrentLocation?.(location);
    if (app.userService?.updateUserLocation) await app.userService.updateUserLocation(app.currentUser.id, location);
  }, { lat: coords.latitude, lng: coords.longitude });
}

export async function closeUsers(...users: Array<JourneyUser | undefined>): Promise<void> {
  for (const user of users) {
    if (!user) continue;
    await user.page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
    await user.context.close().catch(() => {});
  }
}

export function currentRoomId(page: Page): Promise<string> {
  return page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.currentChatroomId || '');
}

export async function openRoomList(page: Page): Promise<void> {
  await page.locator('.nav-btn[data-view="chatrooms"]').click();
  const back = page.locator('#back-to-chatrooms');
  if (await back.isVisible().catch(() => false)) await back.click();
  const listBtn = page.locator('#chatroom-list-view-btn');
  if (await listBtn.isVisible().catch(() => false) && (await listBtn.getAttribute('aria-pressed')) !== 'true') {
    await listBtn.click();
  }
  await expect(page.locator('#chatroom-list')).toBeVisible();
}

/**
 * Room moves on the phone path are slow (OPEN-58: an empty room's member read costs the hub
 * ~2.6 s and a Place entry makes four of them), so journeys wait up to a minute for the move to
 * finish and record how long it took in the test's annotations instead of failing on speed.
 */
export const ROOM_MOVE_TIMEOUT_MS = 60_000;

function recordTiming(what: string, startedAt: number): void {
  const ms = Date.now() - startedAt;
  test.info().annotations.push({ type: 'timing', description: `${what}: ${ms} ms` });
  // eslint-disable-next-line no-console
  console.log(`[timing] ${what}: ${ms} ms`);
}

/** Create a Place through the New Room dialog and wait until the creator stands in it. */
export async function createPlace(page: Page, name: string): Promise<string> {
  await page.locator('.nav-btn[data-view="chatrooms"]').click();
  await page.locator('#create-custom-chatroom-btn').click();
  await page.locator('[data-testid="custom-room-name-input"]').fill(name);
  const startedAt = Date.now();
  await page.locator('[data-testid="custom-room-submit-btn"]').click();
  await expect.poll(() => currentRoomId(page), { timeout: ROOM_MOVE_TIMEOUT_MS, message: `creator never entered Place "${name}"` })
    .toMatch(/^place_b[a-z2-7]+$/);
  recordTiming('create Place → creator inside', startedAt);
  return currentRoomId(page);
}

/** The list row for a room, wherever it is listed ("Rooms near you" or "Places near you"). */
export function roomRow(page: Page, roomId: string) {
  return page.locator(`#chatroom-list [data-testid="room-list-row"][data-chatroom-id="${roomId}"]`);
}

/** Wait (re-opening the list, which refetches) until a room's row shows up. */
export async function waitForRoomRow(page: Page, roomId: string, timeoutMs = 45_000): Promise<void> {
  await expect.poll(async () => {
    await openRoomList(page);
    return roomRow(page, roomId).count();
  }, { timeout: timeoutMs, intervals: [1_000, 2_000, 3_000], message: `room ${roomId} never listed` }).toBeGreaterThan(0);
}

export async function enterRoomFromList(page: Page, roomId: string): Promise<void> {
  await waitForRoomRow(page, roomId);
  const startedAt = Date.now();
  await roomRow(page, roomId).first().click();
  await expect.poll(() => currentRoomId(page), { timeout: ROOM_MOVE_TIMEOUT_MS, message: `never entered ${roomId}` }).toBe(roomId);
  recordTiming(`enter ${roomId.slice(0, 12)}… from the list`, startedAt);
}

/** Leave whatever room the user is in and go back to their home (Nearby) room. */
export async function returnHome(page: Page): Promise<void> {
  await page.locator('.nav-btn[data-view="chatrooms"]').click();
  const back = page.locator('#back-to-chatrooms');
  if (await back.isVisible().catch(() => false)) await back.click();
  const startedAt = Date.now();
  await page.locator('#return-home-btn').click();
  await expect.poll(() => currentRoomId(page), { timeout: ROOM_MOVE_TIMEOUT_MS }).not.toMatch(/^place_/);
  recordTiming('return home', startedAt);
}

/** Member public keys of a room as the HUB sees them (not the phone's local view). */
export async function hubRoomMembers(request: APIRequestContext, roomId: string): Promise<string[]> {
  const res = await request.get(`${phonePathURL('hub')}/api/chatrooms/${encodeURIComponent(roomId)}/members`);
  if (!res.ok()) return [];
  const body = await res.json().catch(() => ({}));
  const list = Array.isArray(body) ? body : body.members || [];
  return list.map((m: any) => String(m?.id || m?.userId || m?.pub || m)).filter(Boolean);
}

export async function hubListsPlace(request: APIRequestContext, roomId: string): Promise<boolean> {
  const res = await request.get(`${phonePathURL('hub')}/api/chatrooms`);
  if (!res.ok()) return false;
  const body = await res.json().catch(() => ({}));
  const rooms = Array.isArray(body) ? body : body.chatrooms || body.rooms || [];
  return rooms.some((room: any) => room?.id === roomId);
}

export function userId(page: Page): Promise<string> {
  return page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.currentUser?.id || '');
}

/** A member's row in the current room's member list. */
export function memberItem(page: Page, memberId: string) {
  return page.locator(`#chatroom-members-list .chatroom-member-item[data-user-id="${memberId}"]`);
}

/** Room ids in the hub's own "rooms with people" list (`/api/active-rooms`, what the list shows). */
export async function hubActiveRoomIds(request: APIRequestContext, near = JOURNEY_COORDS): Promise<string[]> {
  const res = await request.get(`${phonePathURL('hub')}/api/active-rooms?lat=${near.latitude}&lng=${near.longitude}&limit=50`);
  if (!res.ok()) return [];
  const body = await res.json().catch(() => ({}));
  return (body.rooms || []).map((room: any) => String(room?.roomId || ''));
}

export function stageName(page: Page): Promise<string> {
  return page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.currentUser?.stageName || '');
}

/** Open the room the user is in (its member list) from the room list. */
export async function openCurrentRoom(page: Page): Promise<void> {
  await openRoomList(page);
  await page.locator('#chatroom-list .chatroom-item.current-room').first().click();
  await expect(page.locator('#chatroom-members-list')).toBeVisible();
}
