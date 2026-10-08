import type { Page } from '@playwright/test';
import { expect } from './fixtures';
import { afterNav } from './timing';
import { tileIdAt } from '../../../src/shared/room-tiles';

/**
 * Opens the Chatrooms list even when the product correctly restores a previously opened room.
 * Tests that intend to choose a room must explicitly leave that restored detail first.
 */
export async function ensureChatroomList(page: Page): Promise<void> {
  await page
    .evaluate(() => {
      document.querySelector('[data-testid="broadcast-preamble-modal"]')?.remove();
    })
    .catch(() => {});

  const chatroomsTab = page.locator('.nav-btn[data-view="chatrooms"]');
  if (!(await chatroomsTab.evaluate((element) => element.classList.contains('active')).catch(() => false))) {
    await chatroomsTab.click();
    await afterNav();
  }

  const list = page.locator('#chatroom-list-container');
  if (!(await list.isVisible().catch(() => false))) {
    await page.locator('#back-to-chatrooms').click();
  }
  await expect(list).toBeVisible();
}

/** Remote spots used to "travel" to an area room (named country/city rooms are not offered). */
export const AREA_PLACES = {
  london: { latitude: 51.5074, longitude: -0.1278 },
  tokyo: { latitude: 35.6762, longitude: 139.6503 },
} as const;

/** The bottom-layer tile (~78 km, `tile_4_…`) covering `place` — what a map tap opens. */
export function areaRoomIdAt(place: { latitude: number; longitude: number }): string {
  return tileIdAt(4, place.latitude, place.longitude);
}

/**
 * Opens the area room (bottom-layer tile) covering `place` exactly the way a tap on the chatroom
 * map does (map click → `tileIdAt(4, …)` → `showChatroomDetail`), without depending on map tiles
 * loading in the test browser. Returns the room id.
 */
export async function openAreaRoomAt(page: Page, place: { latitude: number; longitude: number }): Promise<string> {
  const roomId = areaRoomIdAt(place);
  // A row click implicitly waited for the list to render; the switch is ignored until the app
  // has its user, so wait for that first.
  await expect
    .poll(() => page.evaluate(() => !!(window as any).__iinpublic_app?.getApp?.()?.currentUser?.id), { timeout: 30_000 })
    .toBe(true);
  // Under load the app's own boot join (to Global) can land after this switch and override it;
  // re-issue the switch until it sticks.
  const currentRoom = () => page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.currentChatroomId || '');
  for (let attempt = 0; attempt < 3 && (attempt === 0 || (await currentRoom()) !== roomId); attempt++) {
    await page.evaluate((id) => (window as any).__iinpublic_app?.getApp?.()?.uiManager?.showChatroomDetail(id), roomId);
    await afterNav();
    await expect.poll(currentRoom, { timeout: 8_000 }).toBe(roomId).catch(() => {});
  }
  await expect(page.locator('#chatroom-detail-container')).toBeVisible();
  await expect.poll(currentRoom, { timeout: 5_000 }).toBe(roomId);
  return roomId;
}
