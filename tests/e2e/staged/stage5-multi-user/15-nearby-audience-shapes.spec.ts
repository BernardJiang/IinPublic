/**
 * OPEN-86 E5 (docs/design/nearby-and-place-chatrooms.md §3.7): every Nearby audience shape in real
 * browsers at C = 3. Users arrive one by one so each viewer passes through:
 *
 * 1. everyone online fits on one page (`A <= C`), including exactly `A = C`;
 * 2. a sparse area: the nearest C worldwide, no page 2 (`R < C`), and exactly `R = C`;
 * 3. a crowded area (`R > C`): pages stay inside the area, the paging action disappears on the last
 *    page, and the map draws the whole area green and a person just outside it yellow;
 * 4. travel to another city, and a larger area size chosen in Settings — each starts again at
 *    group 1 with the audience of the new area.
 *
 * The header (`N nearby · G online`), the AppBar paging action and the service's audience are
 * asserted on the viewer's own screen.
 */
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage5Spec } from '../../helpers/e2e-stage-pipeline';
import { headless } from '../../helpers/timing';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';
import { bootstrapUser, waitForTabActive } from '../../helpers/talks-matching-flow';
import { webAppURLStableChatroom } from '../../helpers/ports';
import { openSettingsSection, SETTINGS_SECTION } from '../../helpers/settings-nav';

/* eslint-disable @typescript-eslint/no-explicit-any */

const CAPACITY = 3;
const SAN_DIEGO = { latitude: 32.7157, longitude: -117.1611 };
/** About 1.5 km north: another 1 km cell, so outside a San Diego viewer's area but in its map view. */
const NORTH_PARK = { latitude: 32.7292, longitude: -117.1611 };
const LOS_ANGELES = { latitude: 34.0522, longitude: -118.2437 };

type Audience = { mode: string; nearby: number; pageable: boolean; hasMore: boolean } | null;

const header = (page: Page) => page.locator('[data-testid="nearby-headcount"]');
const meetAction = (page: Page) => page.locator('[data-testid="nearby-meet-new-people-action"]');
const backAction = (page: Page) => page.locator('[data-testid="nearby-back-to-first-group-action"]');
const audience = (page: Page): Promise<Audience> => page.evaluate(() =>
  (window as any).__iinpublic_app?.getApp?.()?.nearbyV3?.service?.audienceInfo?.() ?? null);
const nearbyNames = (page: Page): Promise<string[]> =>
  page.locator('[data-testid="nearby-person-row"]').evaluateAll((rows) =>
    rows.map((row) => row.getAttribute('data-stage-name') || '').filter(Boolean).sort());

/** Ask the hub now instead of waiting for the next 20 s poll and 3 min reissue. */
async function refreshCounts(pages: Page[]): Promise<void> {
  await Promise.all(pages.map((page) => page.evaluate(async () => {
    const app = (window as any).__iinpublic_app?.getApp?.();
    await app?.nearbyV3?.service?.refreshCounts?.();
    await app?.nearbyV3?.service?.tick?.();
    await app?.refreshActiveRooms?.();
  }).catch(() => undefined)));
}

async function expectShape(
  pages: Page[],
  page: Page,
  expected: { header: string; mode: string; pageable: boolean },
): Promise<void> {
  await expect.poll(async () => {
    await refreshCounts(pages);
    const [text, shape] = await Promise.all([header(page).textContent(), audience(page)]);
    return { header: text?.trim(), mode: shape?.mode, pageable: shape?.pageable };
  }, { timeout: 120_000, intervals: [1_000, 2_000, 5_000] }).toEqual(expected);
  if (expected.pageable) await expect(meetAction(page)).toBeVisible({ timeout: 60_000 });
  else await expect(meetAction(page)).toBeHidden({ timeout: 60_000 });
}

test.describe('Nearby audience shapes at C = 3 (OPEN-86 E5)', () => {
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

  test('all → nearest C → exactly C → crowded area → travel → larger area', async () => {
    test.setTimeout(900_000);
    const appUrl = new URL(webAppURLStableChatroom());
    appUrl.searchParams.set('e2e_capacity', String(CAPACITY));
    const browser = await chromium.launch({ headless, args: [...WEBRTC_CHROMIUM_ARGS] });
    browsers.push(browser);
    const add = async (name: string, at: { latitude: number; longitude: number }): Promise<Page> => {
      const ready = await bootstrapUser(browser, name, name, 60_000, appUrl.toString(), at);
      contexts.push(ready.context);
      pages.push(ready.page);
      return ready.page;
    };

    // 1. Three people, two cities: A = 2 <= C, so everyone is on the only page, wherever they are.
    const s1 = await add('Shape S1', SAN_DIEGO);
    const s2 = await add('Shape S2', SAN_DIEGO);
    const l1 = await add('Shape L1', LOS_ANGELES);
    await expectShape(pages, s1, { header: '2 nearby · 3 online', mode: 'all', pageable: false });
    await expect.poll(() => nearbyNames(s1), { timeout: 90_000 }).toEqual(['Shape L1', 'Shape S2']);
    // Exactly A = C still fits on one page.
    const l2 = await add('Shape L2', LOS_ANGELES);
    await expectShape(pages, s1, { header: '3 nearby · 4 online', mode: 'all', pageable: false });
    await expectShape(pages, l1, { header: '3 nearby · 4 online', mode: 'all', pageable: false });

    // 2. A = 4 > C, but S1's area holds only two others: the nearest C worldwide, no page 2.
    const s3 = await add('Shape S3', SAN_DIEGO);
    await expectShape(pages, s1, { header: '3 nearby · 5 online', mode: 'nearest', pageable: false });
    await expect.poll(async () => (await nearbyNames(s1)).filter((name) => name.startsWith('Shape S')), { timeout: 90_000 })
      .toEqual(['Shape S2', 'Shape S3']);
    // Exactly R = C: three others in S1's area, still one page, all of them from San Diego.
    const s4 = await add('Shape S4', SAN_DIEGO);
    await expectShape(pages, s1, { header: '3 nearby · 6 online', mode: 'nearest', pageable: false });
    await expect.poll(() => nearbyNames(s1), { timeout: 90_000 }).toEqual(['Shape S2', 'Shape S3', 'Shape S4']);

    // 3. A crowded area: R = 4 > C. Pages stay in San Diego; North Park (another cell) is never on them.
    const s5 = await add('Shape S5', SAN_DIEGO);
    const north = await add('Shape N1', NORTH_PARK);
    await expectShape(pages, s1, { header: '4 nearby · 8 online', mode: 'area', pageable: true });
    await expectShape(pages, l1, { header: '3 nearby · 8 online', mode: 'nearest', pageable: false });
    await expect.poll(async () => (await nearbyNames(s1)).length, { timeout: 90_000 }).toBe(3);
    const page1 = await nearbyNames(s1);
    expect(page1.every((name) => /^Shape S[2-5]$/.test(name))).toBe(true);
    await meetAction(s1).click();
    await expect.poll(() => nearbyNames(s1), { timeout: 90_000 })
      .toEqual(['Shape S2', 'Shape S3', 'Shape S4', 'Shape S5'].filter((name) => !page1.includes(name)));
    // The last page: no empty page 3, only the way back.
    await expect(meetAction(s1)).toBeHidden({ timeout: 30_000 });
    await expect(backAction(s1)).toBeVisible();
    await expect(header(s1)).toHaveText('4 nearby · 8 online');

    // The map: the whole San Diego area is green (later pages included), North Park is yellow.
    await s1.locator('[data-testid="chatroom-map-view-btn"]').click();
    const map = s1.locator('#chatroom-map');
    await expect.poll(async () => s1.evaluate(() => {
      const count = (kind: string) => Array.from(document.querySelectorAll(`[data-testid="map-user-dot-${kind}"]`))
        .reduce((sum, dot) => sum + Number((dot as HTMLElement).dataset.count || '1'), 0);
      return { green: count('room'), yellow: count('other') };
    }), { timeout: 90_000, intervals: [1_000, 2_000, 5_000] }).toEqual({ green: 4, yellow: 1 });
    await expect(map).toBeVisible();
    await s1.locator('[data-testid="chatroom-list-view-btn"]').click();
    await backAction(s1).click();
    await expect.poll(async () => (await nearbyNames(s1)).length, { timeout: 90_000 }).toBe(3);

    // 4a. Travel: S1 picks a point in Los Angeles. A new area, so group 1 again; LA holds two
    // others, so this is the sparse fallback and pages nothing. San Diego is left with R = 3 = C.
    await s1.evaluate((point) => (window as any).__iinpublic_app?.getApp?.()?.uiManager?.emit('travelNearbyAtPoint', point), LOS_ANGELES);
    await expect.poll(() => s1.evaluate(() => {
      const card = (window as any).__iinpublic_app?.getApp?.()?.nearbyV3?.service?.card?.();
      return card ? { latitude: Math.round(card.point.latitude), traveler: card.traveler } : null;
    }), { timeout: 60_000 }).toEqual({ latitude: 34, traveler: true });
    await expectShape(pages, s1, { header: '3 nearby · 8 online', mode: 'nearest', pageable: false });
    expect(await s1.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.nearbyV3?.service?.groupInfo?.()?.group)).toBe(1);
    await expectShape(pages, s2, { header: '3 nearby · 8 online', mode: 'nearest', pageable: false });

    // 4b. A larger area: S2 chooses the 50 km size in Settings. Its area now holds S3–S5 and North
    // Park (R = 4 > C), so it pages; S3's own 1 km area is unchanged and still does not.
    await s2.click('.nav-btn[data-view="settings"]');
    await waitForTabActive(s2, 'settings');
    await openSettingsSection(s2, SETTINGS_SECTION.distanceHome);
    await s2.locator('#settings-nearby-privacy-mode').selectOption('regional');
    await expect.poll(() => s2.evaluate(() =>
      (window as any).__iinpublic_app?.getApp?.()?.nearbyV3?.service?.card?.()?.point?.precisionMeters), { timeout: 60_000 })
      .toBe(50_000);
    await s2.locator('.nav-btn[data-view="chatrooms"]').click();
    await waitForTabActive(s2, 'chatrooms');
    await expectShape(pages, s2, { header: '4 nearby · 8 online', mode: 'area', pageable: true });
    await expectShape(pages, s3, { header: '3 nearby · 8 online', mode: 'nearest', pageable: false });

    // Everyone else stayed where they were.
    for (const page of [l2, s4, s5, north]) expect(await audience(page)).not.toBeNull();
  });
});
