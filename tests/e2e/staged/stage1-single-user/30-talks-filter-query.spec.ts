/**
 * Talks tab: filter by query.
 * Creates two talks with distinct titles, then verifies #talks-filter-query
 * actually filters the rendered talk list: partial match, case-insensitive
 * match, no-match empty result, and clear-restores-all.
 */
import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { ensureWindowFitsViewport } from '../../helpers/browser-window';
import { afterLoad, afterSync, afterNav, afterAction, delay, headless } from '../../helpers/timing';
import { webBaseURL } from '../../helpers/ports';
import { attachE2eBrowserTabLabel } from '../../helpers/e2e-tab-title';

test.describe('Talks tab: filter by query', () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage1Spec();
    browser = await chromium.launch({
      headless,
      slowMo: headless ? 0 : delay(50, 150),
      args: ['--window-position=0,0', '--window-size=960,1400', '--force-device-scale-factor=1'],
    });
  });

  test.afterAll(async () => {
    if (page) await page.close();
    if (context) await context.close();
    if (browser) await browser.close();
    await clearGunForStage1Spec();
  });

  async function bootstrapUser(stageName: string): Promise<void> {
    context = await browser.newContext({ viewport: { width: 960, height: 1200 }, deviceScaleFactor: 1 });
    page = await context.newPage();
    page.on('console', (m) => console.log('[Browser]:', m.text()));
    await injectIdbClear(page);
    await gotoWebApp(page, webBaseURL());
    await ensureWindowFitsViewport(page, 960, 1200);
    await afterLoad();
    await page.click('.nav-btn[data-view="settings"]');
    await afterNav();
    await page.waitForSelector('#settings-stage-name-input');
    await page.fill('#settings-stage-name-input', stageName);
    await page.locator('#settings-stage-name-input').blur();
    await afterNav();
    await page.click('.nav-btn[data-view="chatrooms"]');
    await afterNav();
    attachE2eBrowserTabLabel(page, stageName);
  }

  // Note: non-tag talk ids are content-hashed from questions (src/shared/cid.ts) — title is
  // NOT part of the identity. Each talk needs distinct question text or the second one dedupes.
  async function createTalk(title: string, questionText: string): Promise<void> {
    await page.click('#create-talk-btn');
    await page.waitForSelector('#talk-editor-form');
    await page.fill('#talk-title', title);
    await page.selectOption('#talk-language', 'en');
    await page.selectOption('#talk-type', 'flow');
    const q = page.locator('.question-item').first();
    await q.locator('.question-text').fill(questionText);
    await q.locator('.answer-item').nth(0).locator('.answer-text').fill('Yes');
    await q.locator('.answer-item').nth(0).locator('.answer-next').selectOption('noticed');
    await q.locator('.answer-item').nth(1).locator('.answer-text').fill('No');
    await q.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');
    await page.click('#talk-editor-form button[type="submit"]');
    await afterSync();
  }

  test('Talks filter: partial match filters list; case-insensitive; garbage empties; clear restores', async () => {
    await bootstrapUser('TalksFilterTestUser');

    await createTalk('Coffee Morning Meetup', 'Do you drink coffee in the morning?');
    await createTalk('Book Club Evening', 'Do you enjoy reading novels?');

    await page.click('.nav-btn[data-view="talks"]');
    await afterNav();
    await afterLoad();

    const filterInput = page.locator('#talks-filter-query');
    await filterInput.waitFor({ state: 'visible', timeout: 15000 });

    const talkItems = page.locator('.talk-list-item[data-talk-id]');
    await expect(talkItems).toHaveCount(2, { timeout: 15000 });

    // 1. Partial lowercase query matches one talk only (render-time filter: non-matches leave the DOM)
    await filterInput.fill('coffee');
    await afterAction();
    await expect(talkItems).toHaveCount(1);
    await expect(talkItems.first()).toContainText('Coffee Morning Meetup');

    // 2. Case-insensitive: uppercase query still matches
    await filterInput.fill('BOOK');
    await afterAction();
    await expect(talkItems).toHaveCount(1);
    await expect(talkItems.first()).toContainText('Book Club Evening');

    // 3. Garbage query matches nothing → empty result
    await filterInput.fill('xyzabc123notfound');
    await afterAction();
    await expect(talkItems).toHaveCount(0);

    // 4. Clearing the query restores the full list
    await filterInput.fill('');
    await afterAction();
    await expect(talkItems).toHaveCount(2);

    await page.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup());
  });
});
