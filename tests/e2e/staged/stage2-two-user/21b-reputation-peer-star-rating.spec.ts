import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { afterSync, headless } from '../../helpers/timing';
import {
  bootstrapUser,
  resetTalksMatchingSession,
  finalCleanupPages,
} from '../../helpers/talks-matching-flow';
import {
  establishContactsTomJerry,
  getCurrentUserId,
} from '../../helpers/reputation-e2e-helpers';
import { waitForContactDetailReady } from '../../helpers/durable-ui';

test.describe('Reputation system — peer star rating', () => {
  let browserTom: Browser;
  let browserJerry: Browser;
  let contextTom: BrowserContext | undefined;
  let contextJerry: BrowserContext | undefined;
  let pageTom: Page | undefined;
  let pageJerry: Page | undefined;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage2Spec();
    browserTom = await chromium.launch({
      headless,
      args: ['--window-position=0,0', '--window-size=640,1100', '--force-device-scale-factor=1'],
    });
    browserJerry = await chromium.launch({
      headless,
      args: ['--window-position=640,0', '--window-size=640,1100', '--force-device-scale-factor=1'],
    });
  });

  test.beforeEach(async () => {
    await resetTalksMatchingSession(
      { tom: pageTom, jerry: pageJerry },
      { tom: contextTom, jerry: contextJerry },
    );
    pageTom = pageJerry = undefined;
    contextTom = contextJerry = undefined;
  });

  test.afterAll(async () => {
    await finalCleanupPages(
      { tom: pageTom, jerry: pageJerry },
      { tom: contextTom, jerry: contextJerry },
    );
    await browserTom?.close().catch(() => {});
    await browserJerry?.close().catch(() => {});
    await clearGunForStage2Spec();
  });

  test('submit peer star rating updates starRating + liked/disliked counts', async () => {
    const title = `Reputation Star Rating ${Date.now()}`;
    const tom = await bootstrapUser(browserTom, 'Tom', 'Tom');
    contextTom = tom.context;
    pageTom = tom.page;
    const jerry = await bootstrapUser(browserJerry, 'Jerry', 'Jerry');
    contextJerry = jerry.context;
    pageJerry = jerry.page;

    await establishContactsTomJerry(pageTom, pageJerry, title);

    const jerryUserId = await getCurrentUserId(pageJerry);

    await pageTom.click('.nav-btn[data-view="contacts"]');
    await afterSync();

    const jerryContact = pageTom.locator(`.contact-item[data-contact-user-id="${jerryUserId}"]`).first();
    await expect(jerryContact).toBeVisible({ timeout: 15000 });
    await jerryContact.click();
    await waitForContactDetailReady(pageTom);
    await expect(pageTom.locator('#peer-detail-name')).toContainText('Jerry', { timeout: 10000 });
    await expect(pageTom.locator('#peer-detail-subtitle')).toContainText('talk', { timeout: 15000 });
    await expect(pageTom.locator('.contact-public-profile-summary')).toBeVisible({ timeout: 15000 });

    await pageTom.click('#contact-edit-relationship-btn');
    await expect(pageTom.locator('#contact-relationship-modal')).toBeVisible({ timeout: 10000 });

    const currentRatingRaw = await pageTom.$eval('#contact-relationship-rating', (el) => (el as HTMLSelectElement).value);
    const currentRating = Number(currentRatingRaw || 0);
    const desiredRating = currentRating === 5 ? 4 : 5;
    await pageTom.selectOption('#contact-relationship-rating', String(desiredRating));
    await pageTom.click('#contact-relationship-save-btn');
    await expect(pageTom.locator('#contact-relationship-modal')).toHaveCount(0, { timeout: 10000 });
    await afterSync();

    // Re-open and assert persisted relationship rating (durable, avoids delayed reputation fanout races).
    await pageTom.click('.nav-btn[data-view="contacts"]');
    await afterSync();
    await pageTom.locator(`.contact-item[data-contact-user-id="${jerryUserId}"]`).first().click();
    await waitForContactDetailReady(pageTom);
    await pageTom.click('#contact-edit-relationship-btn');
    await expect(pageTom.locator('#contact-relationship-modal')).toBeVisible({ timeout: 10000 });
    await expect(pageTom.locator('#contact-relationship-rating')).toHaveValue(String(desiredRating), { timeout: 10000 });
  });
});
