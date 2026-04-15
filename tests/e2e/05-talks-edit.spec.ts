import { test, expect, chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { clearGunDatabases, injectIdbClear } from './helpers/clear-database';
import { ensureWindowFitsViewport } from './helpers/browser-window';
import { afterLoad, afterSync, afterNav, afterAction, delay, headless } from './helpers/timing';

test.describe('Talks: create and edit', () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;
  const TALK_TITLE = 'Coffee Meetup';
  const TALK_TITLE_EDITED = 'Coffee Meetup (Edited)';

  test.beforeAll(async () => {
    await clearGunDatabases();
    browser = await chromium.launch({
      headless,
      slowMo: delay(50, 150),
      args: ['--window-position=0,0', '--window-size=960,1400', '--force-device-scale-factor=1'],
    });
  });

  test.afterAll(async () => {
    if (page) await page.close();
    if (context) await context.close();
    if (browser) await browser.close();
    await clearGunDatabases();
  });

  async function bootstrapUser(stageName: string): Promise<void> {
    context = await browser.newContext({ viewport: { width: 960, height: 1200 }, deviceScaleFactor: 1 });
    page = await context.newPage();
    page.on('console', (m) => console.log('[Browser]:', m.text()));
    await injectIdbClear(page);
    await page.goto('/');
    await page.waitForLoadState('load');
    await ensureWindowFitsViewport(page, 960, 1200);
    await afterLoad();
    await page.click('.nav-btn[data-view="me"]');
    await afterNav();
    await page.waitForSelector('#edit-stagename-btn');
    await page.click('#edit-stagename-btn');
    await afterAction();
    await page.fill('#new-stage-name', stageName);
    await page.click('#edit-stagename-form button[type="submit"]');
    await afterNav();
    await page.click('.nav-btn[data-view="chatrooms"]');
    await afterNav();
  }

  test('Create talk, Talks tab shows it with Edit; Edit opens with prefilled data', async () => {
    await bootstrapUser('EditTestUser');

    await page.click('#create-talk-btn');
    await page.waitForSelector('#talk-editor-form');
    await page.fill('#talk-title', TALK_TITLE);
    await page.selectOption('#talk-type', 'matching');
    const q = page.locator('.question-item').first();
    await q.locator('.question-text').fill('Do you drink coffee?');
    await q.locator('.answer-item').nth(0).locator('.answer-text').fill('Yes');
    await q.locator('.answer-item').nth(0).locator('.answer-next').selectOption('noticed');
    await q.locator('.answer-item').nth(1).locator('.answer-text').fill('No');
    await q.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');
    await page.click('#talk-editor-form button[type="submit"]');
    await afterSync();

    await page.click('.nav-btn[data-view="talks"]');
    await afterSync();
    const talkItem = page.locator('.talk-list-item').filter({ hasText: TALK_TITLE }).first();
    await talkItem.waitFor({ state: 'visible', timeout: 15000 });
    await expect(talkItem.locator('.talk-badge-created')).toBeVisible();
    await expect(talkItem.locator('.edit-talk-btn')).toBeVisible();

    await talkItem.locator('.edit-talk-btn').click();
    await page.waitForSelector('#talk-editor-modal');
    await expect(page.locator('#talk-title')).toHaveValue(TALK_TITLE);
    await expect(page.locator('#talk-type')).toHaveValue('matching');
    await page.fill('#talk-title', TALK_TITLE_EDITED);
    await page.click('#talk-editor-form button[type="submit"]');
    await afterSync();
    await expect(page.locator('.talk-list-item').filter({ hasText: TALK_TITLE_EDITED })).toBeVisible({ timeout: 15000 });
  });
});
