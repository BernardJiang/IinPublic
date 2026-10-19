/**
 * Helpers for the phone-path journeys (see ./playwright.config.ts). Each user is a fresh browser
 * context pointed at a phone node's origin (or the hub's, for a plain web user), so every API
 * call takes the same route it takes on a real phone: WebView → embedded node → hub relay.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import * as path from 'node:path';
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
  /** Open the app from this origin instead (a phone node the spec started itself). */
  baseUrl?: string;
  /** Reuse a browser context (the same WebView storage), e.g. after the phone node restarted. */
  context?: BrowserContext;
};

export async function openUser(
  browser: Browser,
  label: string,
  origin: PhonePathOrigin,
  options: OpenUserOptions = {},
): Promise<JourneyUser> {
  const coords = options.coords ?? JOURNEY_COORDS;
  const context = options.context ?? await browser.newContext({
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
  if (!options.context) await injectIdbClear(page);
  const query = new URLSearchParams({
    e2e_place_min_contacts: String(options.placeMinContacts ?? 0),
    ...options.extraQuery,
  });
  await page.goto(`${options.baseUrl ?? phonePathURL(origin)}/?${query.toString()}`);
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
  // Physical WebViews can keep the bottom bar's bounds moving while Nearby presence updates.
  // This journey helper is selecting a view, not testing pointer hit targets, so invoke the real
  // navigation listener without waiting for Playwright's stable-bounding-box condition.
  await page.locator('.nav-btn[data-view="chatrooms"]').evaluate((element) => {
    (element as HTMLButtonElement).click();
  });
  const back = page.locator('#back-to-chatrooms');
  if (await back.isVisible().catch(() => false)) {
    await back.evaluate((element) => (element as HTMLButtonElement).click());
  }
  const listBtn = page.locator('#chatroom-list-view-btn');
  if ((await listBtn.count()) > 0 && (await listBtn.getAttribute('aria-pressed')) !== 'true') {
    await clickAppBarAction(page, '#chatroom-list-view-btn');
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
/** Click an app-bar action. On a phone-width screen the bar moves lower-priority actions (New
 *  Room, Return Home) into the "…" overflow panel, so open it first when the button is hidden. */
export async function clickAppBarAction(page: Page, selector: string): Promise<void> {
  const button = page.locator(selector);
  if (!(await button.isVisible().catch(() => false))) {
    await page.locator('#app-bar-overflow-btn').evaluate((element) => {
      (element as HTMLButtonElement).click();
    });
    await expect(page.locator('#app-bar-overflow-panel')).toHaveClass(/\bopen\b/);
  }
  await button.evaluate((element) => (element as HTMLButtonElement).click());
}

export async function createPlace(page: Page, name: string): Promise<string> {
  await page.locator('.nav-btn[data-view="chatrooms"]').evaluate((element) => {
    (element as HTMLButtonElement).click();
  });
  await clickAppBarAction(page, '#create-custom-chatroom-btn');
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
  await roomRow(page, roomId).first().evaluate((element) => {
    (element as HTMLElement).click();
  });
  await expect.poll(() => currentRoomId(page), { timeout: ROOM_MOVE_TIMEOUT_MS, message: `never entered ${roomId}` }).toBe(roomId);
  recordTiming(`enter ${roomId.slice(0, 12)}… from the list`, startedAt);
}

/** Leave whatever room the user is in and go back to their home (Nearby) room. */
export async function returnHome(page: Page): Promise<void> {
  await page.locator('.nav-btn[data-view="chatrooms"]').evaluate((element) => {
    (element as HTMLButtonElement).click();
  });
  const back = page.locator('#back-to-chatrooms');
  if (await back.isVisible().catch(() => false)) {
    await back.evaluate((element) => (element as HTMLButtonElement).click());
  }
  const startedAt = Date.now();
  await clickAppBarAction(page, '#return-home-btn');
  await expect.poll(() => currentRoomId(page), { timeout: ROOM_MOVE_TIMEOUT_MS }).not.toMatch(/^place_/);
  recordTiming('return home', startedAt);
}

/** Member public keys of a room as the HUB sees them (not the phone's local view). */
export async function hubRoomMembers(request: APIRequestContext, roomId: string): Promise<string[]> {
  if (roomId === 'nearby-v3') {
    // Nearby is a personal list with no hub roster (§3.7): who the hub would introduce here.
    const intro = await request.post(`${phonePathURL('hub')}/api/nearby/v3/introductions`, { data: { point: JOURNEY_COORDS } });
    if (!intro.ok()) return [];
    const body = await intro.json().catch(() => ({})) as { cards?: Array<{ userId?: string }> };
    return (body.cards ?? []).map((card) => String(card.userId || '')).filter(Boolean);
  }
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

/** A notification banner whose text matches. */
export function notification(page: Page, text: RegExp) {
  return page.locator('.notification', { hasText: text });
}

/** Room ids a node lists at `GET /api/chatrooms` (Places are listed only while live). */
export async function listedRoomIds(request: APIRequestContext, baseUrl: string, creatorPub?: string): Promise<string[]> {
  const query = creatorPub ? `?creatorPub=${encodeURIComponent(creatorPub)}` : '';
  const res = await request.get(`${baseUrl}/api/chatrooms${query}`, { timeout: 20_000 });
  if (!res.ok()) return [];
  const body = await res.json().catch(() => []);
  const rooms = Array.isArray(body) ? body : body.chatrooms || body.rooms || [];
  return rooms.map((room: any) => String(room?.id || '')).filter(Boolean);
}

/** Age a Place `days` into the past on the hub and on both phone nodes (E2E-only endpoint). */
export async function backdatePlace(request: APIRequestContext, roomId: string, days: number): Promise<void> {
  let found = false;
  for (const origin of Object.keys(PHONE_PATH_PORTS) as PhonePathOrigin[]) {
    const res = await request.post(`${phonePathURL(origin)}/api/test/chatrooms/${encodeURIComponent(roomId)}/backdate`, {
      data: { days },
      timeout: 20_000,
    });
    expect([200, 404], `backdate on ${origin}`).toContain(res.status());
    if (origin === 'hub') found = res.status() === 200;
  }
  expect(found, 'the hub did not know the Place to backdate').toBe(true);
}

export type SpecPhoneNode = { url: string; stop: () => Promise<void> };

/**
 * Start a phone node of the spec's own (scripts/e2e-phone-node.mjs) on `port`, relaying to the hub
 * on `hubPort`. With `dataDir`, its data survives `stop()`, so starting it again is an app restart.
 */
export async function startPhoneNode(port: number, hubPort: number, dataDir?: string): Promise<SpecPhoneNode> {
  const repoRoot = path.resolve(__dirname, '..', '..', '..');
  const child: ChildProcess = spawn(process.execPath, ['scripts/e2e-phone-node.mjs', String(port), String(hubPort)], {
    cwd: repoRoot,
    env: { ...process.env, ...(dataDir ? { PHONE_NODE_DATA_DIR: dataDir } : {}) },
    stdio: process.env.PHONE_PATH_SERVER_LOGS === '1' ? 'inherit' : 'ignore',
  });
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 120_000;
  for (;;) {
    const up = await fetch(`${url}/health`).then((res) => res.ok).catch(() => false);
    if (up) break;
    if (child.exitCode != null || Date.now() > deadline) {
      child.kill('SIGKILL');
      throw new Error(`phone node on ${port} did not start (exit ${child.exitCode})`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const stop = async () => {
    if (child.exitCode != null) return;
    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.kill('SIGTERM');
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 10_000))]);
    if (child.exitCode == null) child.kill('SIGKILL');
    // The port must be free before the node is started again.
    for (let i = 0; i < 40 && await fetch(`${url}/health`).then(() => true).catch(() => false); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  };
  return { url, stop };
}
