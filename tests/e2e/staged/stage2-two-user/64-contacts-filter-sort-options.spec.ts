/**
 * Contacts — filter/sort option matrix (catalog Part 5).
 *
 * Two matched users (so a contact exists): drives the 7 relation filters, 7 sort
 * orders, and the name query. Asserts each control is interactive and the
 * contacts list stays rendered.
 */
import { chromium, Browser } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { headless, afterNav, afterSync } from '../../helpers/timing';
import { setupFastMatchedDm, teardownFastDmPair, FastDmPair } from '../../helpers/fast-dm-setup';
import { openCollapsedFilters } from '../../helpers/filter-bar';

const RELATIONS = ['all', 'friend', 'relative', 'coworker', 'acquaintance', 'partner', 'custom'];
const SORTS = ['recent', 'talks', 'matches', 'match-rate', 'weighted', 'name', 'relationship'];

test.describe('Contacts: filter/sort option matrix', () => {
  let browserA: Browser;
  let browserB: Browser;
  let pair: FastDmPair | undefined;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage2Spec();
    browserA = await chromium.launch({ headless, args: ['--window-position=0,0', '--window-size=1000,1100'] });
    browserB = await chromium.launch({ headless, args: ['--window-position=1000,0', '--window-size=800,1100'] });
  });

  test.afterAll(async () => {
    if (pair) await teardownFastDmPair(pair);
    await browserA?.close().catch(() => {});
    await browserB?.close().catch(() => {});
    await clearGunForStage2Spec();
  });

  test('7 relations, 7 sorts, name query', async () => {
    pair = await setupFastMatchedDm(browserA, browserB, 'ContactA', 'ContactB');
    const { pageA } = pair;

    // The fast-DM helper leaves the conversation open; its composer covers the
    // bottom nav. Close it before navigating.
    if (await pageA.locator('#conversation-detail-overlay').isVisible().catch(() => false)) {
      await pageA.click('#back-from-conversation');
      await afterNav();
    }

    await pageA.locator('.nav-btn[data-view="contacts"]').click();
    await afterNav();
    await openCollapsedFilters(pageA, 'contacts-filter-toggle');
    await expect(pageA.locator('#contacts-view')).toBeVisible();

    for (const value of RELATIONS) {
      await pageA.selectOption('#contacts-filter-relation', value);
      await afterSync();
      await expect(pageA.locator('#contacts-filter-relation')).toHaveValue(value);
    }

    for (const value of SORTS) {
      await pageA.selectOption('#contacts-sort-order', value);
      await afterSync();
      await expect(pageA.locator('#contacts-sort-order')).toHaveValue(value);
    }

    await pageA.fill('#contacts-filter-name', 'ContactB');
    await afterSync();
    await expect(pageA.locator('#contacts-filter-name')).toHaveValue('ContactB');
    await pageA.fill('#contacts-filter-name', 'zzz-no-match');
    await afterSync();

    await expect(pageA.locator('#contacts-view')).toBeVisible();
  });
});
