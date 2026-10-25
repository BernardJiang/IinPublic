import { expect, type Page } from '@playwright/test';

/**
 * Nearby is each user's own list (docs/design/nearby-and-place-chatrooms.md §3.7) and has no
 * goodbye: someone who left (or who left while I was away, still on my saved list) drops off when
 * my next swap with them gets no answer. A swap goes to one random person on my list per gossip
 * period, so instead of waiting out periods this runs swaps now until the Nearby headcount reads
 * `expected`.
 */
export async function expectNearbyHeadcount(page: Page, expected: number, message?: string): Promise<void> {
  const headcount = page.locator('[data-testid="nearby-headcount"]');
  await expect
    .poll(async () => {
      await page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.nearbyV3?.service.gossipNow()).catch(() => undefined);
      return Number((await headcount.textContent())?.match(/\d+/)?.[0] ?? '-1');
    }, { timeout: 60_000, intervals: [500, 1_000], ...(message ? { message } : {}) })
    .toBe(expected);
}

/**
 * Put everyone in one new Place: the first page creates it, the others enter it. Places are still
 * shared rooms with a hub roster and the classic mesh overlay; Nearby is not (each user's own list,
 * links only for a reason), so specs about room-wide mesh topology run in a Place.
 */
export async function enterNewPlaceTogether(pages: Page[], name: string): Promise<string> {
  const [creator, ...others] = pages;
  if (!creator) throw new Error('enterNewPlaceTogether needs at least one page');
  const roomOf = (page: Page) => page.evaluate(() => String((window as any).__iinpublic_app?.getApp?.()?.currentChatroomId || ''));
  await creator.click('.nav-btn[data-view="chatrooms"]');
  await creator.click('#create-custom-chatroom-btn');
  await creator.locator('[data-testid="custom-room-name-input"]').fill(name);
  await creator.locator('[data-testid="custom-room-submit-btn"]').click();
  await expect.poll(() => roomOf(creator), { timeout: 15_000 }).toMatch(/^place_/);
  const placeId = await roomOf(creator);
  for (const page of others) {
    await page.evaluate((id) => (window as any).__iinpublic_app?.getApp?.()?.uiManager?.emit('chatroomChanged', id), placeId);
    await expect.poll(() => roomOf(page), { timeout: 15_000 }).toBe(placeId);
  }
  return placeId;
}
