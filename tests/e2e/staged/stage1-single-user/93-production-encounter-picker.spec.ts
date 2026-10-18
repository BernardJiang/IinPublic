/**
 * The website's encounter location in a PRODUCTION bundle (OPEN-40; design
 * docs/design/nearby-and-place-chatrooms.md). Dev builds fake GPS with `window.__test_location`;
 * production asks the browser for the device location instead, and without it the person is a
 * Traveler ✈ at a point they pick on the map (OPEN-53). This is the path real website users take.
 *
 *   1. Location refused → placed at a random point as a Traveler, in Nearby (never Contacts only),
 *      and asked to pick → the typed point is saved and Nearby is resolved from it.
 *   2. Location allowed → a Resident at the browser's fix, no encounter point, no picker.
 *   3. Both people share the one Nearby room (two people online share one broad group).
 *
 * Needs a production dist/web served statically: `npm run test:e2e:production-web` builds it.
 */
import { Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { webBaseURL } from '../../helpers/ports';

const PRODUCTION_WEB = process.env.E2E_PRODUCTION_WEB === '1';
const ENCOUNTER_KEY = 'iinpublic_encounter_location_v1';
const LONDON = { latitude: 51.50135, longitude: -0.14189 };
const PARIS = { latitude: 48.85837, longitude: 2.294481 };

/* eslint-disable @typescript-eslint/no-explicit-any */
const app = (page: Page) => page.evaluate(() => {
  const a = (window as any).__iinpublic_app?.getApp?.();
  return {
    room: String(a?.currentChatroomId || ''),
    traveler: !!a?.appearsAsTraveler?.(),
  };
});
const encounter = (page: Page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) || 'null'), ENCOUNTER_KEY);
/* eslint-enable @typescript-eslint/no-explicit-any */

async function openUser(browser: Browser, geolocation?: { latitude: number; longitude: number }): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    viewport: { width: 900, height: 1100 },
    ...(geolocation ? { geolocation, permissions: ['geolocation'] } : { permissions: [] }),
  });
  const page = await context.newPage();
  await injectIdbClear(page);
  await gotoWebApp(page, webBaseURL());
  return { context, page };
}

test.describe('Production website encounter location → Nearby', () => {
  test.skip(!PRODUCTION_WEB, 'Needs a production web bundle: npm run test:e2e:production-web');

  const contexts: BrowserContext[] = [];
  let refused: Page;
  let allowed: Page;

  test.beforeAll(async () => {
    await clearGunForStage1Spec();
  });

  test.afterAll(async () => {
    for (const context of contexts) await context.close().catch(() => {});
    await clearGunForStage1Spec();
  });

  test('location refused: a random Traveler point in Nearby, then the picked point', async ({ browser }) => {
    const user = await openUser(browser);
    contexts.push(user.context);
    refused = user.page;

    await expect(refused.locator('[data-testid="encounter-location-modal"]')).toBeVisible({ timeout: 60_000 });
    await expect.poll(async () => (await encounter(refused))?.auto, { timeout: 15_000 }).toBe(true);
    await expect.poll(async () => (await app(refused)).room, { timeout: 60_000 }).toMatch(/^nearby_/);
    expect((await app(refused)).traveler).toBe(true);

    await refused.locator('[data-testid="encounter-location-lat"]').fill(String(LONDON.latitude));
    await refused.locator('[data-testid="encounter-location-lng"]').fill(String(LONDON.longitude));
    await refused.locator('[data-testid="encounter-location-confirm"]').click();
    await expect(refused.locator('[data-testid="encounter-location-modal"]')).toHaveCount(0);
    await expect.poll(() => encounter(refused), { timeout: 15_000 }).toMatchObject(LONDON);
    expect((await encounter(refused)).auto).toBeUndefined();
    await expect.poll(async () => (await app(refused)).room, { timeout: 60_000 }).toMatch(/^nearby_/);
    expect((await app(refused)).traveler).toBe(true);
  });

  test('location allowed: a Resident at the browser fix, with no picker', async ({ browser }) => {
    const user = await openUser(browser, PARIS);
    contexts.push(user.context);
    allowed = user.page;

    await expect.poll(async () => (await app(allowed)).room, { timeout: 60_000 }).toMatch(/^nearby_/);
    expect((await app(allowed)).traveler).toBe(false);
    expect(await encounter(allowed)).toBeNull();
    await expect(allowed.locator('[data-testid="encounter-location-modal"]')).toHaveCount(0);
  });

  test('the Traveler and the Resident share the one Nearby room', async () => {
    test.skip(!refused || !allowed, 'needs both users from the tests above');
    await expect.poll(async () => (await app(allowed)).room, { timeout: 60_000 }).toBe((await app(refused)).room);
  });
});
