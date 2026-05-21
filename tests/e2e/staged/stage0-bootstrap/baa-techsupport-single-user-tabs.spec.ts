import { chromium, expect } from '@playwright/test';
import { test } from '../../helpers/fixtures';
import { isStagePipeline } from '../../helpers/e2e-stage-pipeline';
import { bootstrapTechSupport } from '../../helpers/bootstrap-canonical';
import { assertStatusChecks } from '../../helpers/e2e-status-checks';
import { afterNav, afterSync, headless } from '../../helpers/timing';

test.describe('Stage 0 — TechSupport single-user traversal', () => {
  test.skip(!isStagePipeline(), 'only for E2E_STAGE_PIPELINE=1');

  test('TechSupport traverses all single-user tabs before stage0 is saved', async () => {
    const browser = await chromium.launch({ headless, args: ['--window-position=0,0'] });
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
    await expect(page.locator('#contacts-filter-name')).toBeVisible();
    await expect(page.locator('#contacts-filter-relation')).toBeVisible();

    await page.click('.nav-btn[data-view="talks"]');
    await afterNav();
    await expect(page.locator('#talks-list')).toBeVisible();
    await expect(page.locator('#talks-nav-all')).toBeVisible();
    await expect(page.locator('#talks-nav-in')).toBeVisible();
    await expect(page.locator('#talks-nav-out')).toBeVisible();

    await page.click('.nav-btn[data-view="me"]');
    await afterNav();
    await expect(page.locator('#answers-content')).toBeVisible();
    await expect(page.locator('.me-answer-filter[data-me-answer-filter="all"]')).toBeVisible();
    await expect(page.locator('#me-view-preferences-btn')).toBeVisible();

    await page.click('.nav-btn[data-view="settings"]');
    await afterNav();
    await expect(page.locator('#settings-stage-name-input')).toHaveValue('TechSupport');
    await expect(page.locator('#settings-profile-languages')).toBeVisible();
    await expect(page.locator('#settings-filter-languages')).toBeVisible();
    await expect(page.locator('.settings-filter-language-option[value="en"]')).toBeChecked();
    await expect(page.locator('#settings-storage-inspector')).toBeVisible();

    await afterSync();
    await context.close();
    await browser.close();
  });
});

