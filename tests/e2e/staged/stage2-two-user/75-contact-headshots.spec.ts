/**
 * TODO §M6: ordinary contact rows show a headshot — real photo or emoji when set, the same
 * "?" fallback the Relationship modal already uses when not. Prefetch is cached per peer
 * (ui-manager.ts's peerHeadshotCache) so re-sorting/filtering the list doesn't re-fetch.
 */
import { chromium, Browser } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { gunBaseURL } from '../../helpers/ports';
import { headless, afterAction, afterNav, reloadAppReady } from '../../helpers/timing';
import { setupFastMatchedDm, teardownFastDmPair, FastDmPair } from '../../helpers/fast-dm-setup';
import { openCollapsedFilters } from '../../helpers/filter-bar';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';
import { openSettingsSection, SETTINGS_SECTION } from '../../helpers/settings-nav';

test.describe('Contact headshots (M6)', () => {
  let browserA: Browser;
  let browserB: Browser;
  let pair: FastDmPair | undefined;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage2Spec();
    browserA = await chromium.launch({ headless, args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=0,0', '--window-size=640,1100'] });
    browserB = await chromium.launch({ headless, args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=640,0', '--window-size=640,1100'] });
  });

  test.beforeEach(async () => {
    await clearGunForStage2Spec();
  });

  test.afterEach(async () => {
    if (pair) await teardownFastDmPair(pair);
    pair = undefined;
  });

  test.afterAll(async () => {
    await browserA?.close().catch(() => {});
    await browserB?.close().catch(() => {});
    await clearGunForStage2Spec();
  });

  test('no headshot shows "?" fallback; a set headshot renders (fresh session); re-sort does not re-fetch', async () => {
    pair = await setupFastMatchedDm(browserA, browserB, 'HeadshotTom', 'HeadshotJerry');
    const { pageA, pageB, userIdB } = pair;

    await pageA.locator('#back-from-conversation').click();
    await afterNav();
    await pageA.click('.nav-btn[data-view="contacts"]');
    await afterNav();

    const jerryRow = pageA.locator(`.contact-item[data-contact-user-id="${userIdB}"]`);
    await expect(jerryRow).toBeVisible({ timeout: 15_000 });
    // No headshot set yet: falls back to "?", same as the Relationship modal's convention.
    await expect
      .poll(() => jerryRow.locator('.contact-item-avatar').textContent(), { timeout: 10_000 })
      .toBe('?');

    // Jerry sets an emoji headshot (same pattern as 04-profile-edit-stage-name.spec.ts).
    await pageB.locator('#back-from-conversation').click();
    await afterNav();
    await pageB.click('.nav-btn[data-view="settings"]');
    await afterNav();
    await openSettingsSection(pageB, SETTINGS_SECTION.profile);
    await pageB.selectOption('#settings-headshot-select', '😎');
    await pageB.evaluate(async () => {
      const app = (window as any).__iinpublic_app?.getApp?.();
      const user = app?.currentUser;
      await app.uiManager.onProfileChange(user.id, {
        headshot: '😎',
        languages: user.languages || ['en'],
        interests: [],
        profile: [],
      });
    });
    const publicHeadshot = async () => {
      const res = await pageB.request.get(`${gunBaseURL()}/api/users/${encodeURIComponent(userIdB)}`);
      if (!res.ok()) return '';
      const user = await res.json() as any;
      return String(user?.headshot || '');
    };
    await expect.poll(publicHeadshot, { timeout: 30_000 }).toBe('😎');

    // peerHeadshotCache already resolved and cached `null` for Jerry from the first render
    // (by design — like peerLocationCache, a resolved "no headshot" isn't re-checked live
    // mid-session, only re-sort/filter within the SAME render is guarded against re-fetching).
    // A fresh session picks it up normally: reload Tom's page.
    await reloadAppReady(pageA);
    await pageA.click('.nav-btn[data-view="contacts"]');
    await afterNav();
    const jerryRowAfterReload = pageA.locator(`.contact-item[data-contact-user-id="${userIdB}"]`);
    await expect
      .poll(() => jerryRowAfterReload.locator('.contact-item-avatar').textContent(), { timeout: 15_000 })
      .toBe('😎');

    // Re-sort must not re-fetch: count Gun reads for Jerry's public profile from here on.
    const fetchCountBefore = await pageA.evaluate((jerryId: string) => {
      const app = (window as any).__iinpublic_app?.getApp?.();
      (window as any).__headshotFetchCount = 0;
      const originalGet = app.gunService.get.bind(app.gunService);
      app.gunService.get = (path: string, ...rest: any[]) => {
        if (path === `user-public-profile/${jerryId}`) (window as any).__headshotFetchCount++;
        return originalGet(path, ...rest);
      };
      return (window as any).__headshotFetchCount;
    }, userIdB);
    expect(fetchCountBefore).toBe(0);

    await openCollapsedFilters(pageA, 'contacts-filter-toggle');
    await pageA.selectOption('#contacts-sort-order', 'match-rate');
    await afterAction();
    await pageA.selectOption('#contacts-sort-order', 'recent');
    await afterAction();

    await expect(jerryRowAfterReload.locator('.contact-item-avatar')).toHaveText('😎');
    const fetchCountAfter = await pageA.evaluate(() => (window as any).__headshotFetchCount);
    expect(fetchCountAfter).toBe(0);
  });
});
