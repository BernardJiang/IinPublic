import { chromium, expect } from '@playwright/test';
import { test } from '../../helpers/fixtures';
import { isStagePipeline } from '../../helpers/e2e-stage-pipeline';
import { bootstrapTechSupport } from '../../helpers/bootstrap-canonical';
import { assertStatusChecks } from '../../helpers/e2e-status-checks';
import { afterNav, afterSync, headless } from '../../helpers/timing';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';
import { openCollapsedFilters } from '../../helpers/filter-bar';

test.describe('Stage 0 — TechSupport single-user traversal', () => {
  test.skip(!isStagePipeline(), 'only for E2E_STAGE_PIPELINE=1');

  test('TechSupport traverses all single-user tabs before stage0 is saved', async () => {
    const browser = await chromium.launch({ headless, args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=0,0'] });
    const { context, page } = await bootstrapTechSupport(browser, 'TechSupport Stage0');

    await assertStatusChecks(page, [
      { kind: 'headerStageName', name: 'TechSupport' },
      { kind: 'statusBarRoom', substring: 'Global' },
      { kind: 'chatroomHeadcount', roomId: 'global', count: 1 },
    ]);

    await page.click('.nav-btn[data-view="chatrooms"]');
    await afterNav();
    await expect(page.locator('#chatroom-list')).toContainText('Global');
    await expect(page.locator('.chatroom-headcount').first()).toBeVisible();

    await page.click('.nav-btn[data-view="contacts"]');
    await afterNav();
    await expect(page.locator('#contacts-list')).toBeVisible();
    // Below 768px (this browser's default 640px viewport) the filter row collapses
    // behind a "Filters ▾" disclosure — open it before asserting the controls inside.
    await openCollapsedFilters(page, 'contacts-filter-toggle');
    await expect(page.locator('#contacts-filter-name')).toBeVisible();
    await expect(page.locator('#contacts-filter-relation')).toBeVisible();
    await expect(page.locator('#contacts-filter-relation option[value="partner"]')).toHaveText('Partners');
    await expect(page.locator('#contacts-sort-order option[value="weighted"]')).toHaveText('Relevance score');

    await page.click('.nav-btn[data-view="talks"]');
    await afterNav();
    await expect(page.locator('#talks-list')).toBeVisible();
    await expect(page.locator('#talks-filter-incoming')).toBeVisible();
    await expect(page.locator('#talks-filter-outgoing')).toBeVisible();
    await expect(page.locator('.talks-type-checkbox')).toHaveCount(4);
    await expect(page.locator('#talks-out-sort-order option[value="matches"]')).toHaveText('Most matches');
    await expect(page.locator('#talks-out-sort-order option[value="latest-reply"]')).toHaveText('Latest reply');
    await expect(page.locator('#talks-out-sort-order option[value="weighted"]')).toHaveText('Weighted performance');
    // TODO §M1: "Replies To My Talks" panel is hidden for now.
    await expect(page.locator('#creator-replies-panel')).toBeHidden();

    await page.click('.nav-btn[data-view="me"]');
    await afterNav();
    await expect(page.locator('#answers-content')).toBeVisible();
    await expect(page.locator('.me-talk-type-filter')).toHaveCount(4);
    await expect(page.locator('.me-tag-state-checkbox')).toHaveCount(3);

    await page.click('.nav-btn[data-view="settings"]');
    await afterNav();
    await expect(page.locator('#settings-stage-name-input')).toHaveValue('TechSupport');
    await expect(page.locator('#settings-edit-profile-btn')).toBeVisible();
    await expect(page.locator('#settings-credit-visible')).toBeVisible();
    await expect(page.locator('#settings-profile-languages')).toBeVisible();
    await expect(page.locator('#settings-filter-languages')).toBeVisible();
    await expect(page.locator('.settings-filter-language-option[value="en"]')).toBeChecked();
    await expect(page.locator('#settings-storage-inspector')).toBeVisible();

    await afterSync();
    await context.close();
    await browser.close();
  });
});
