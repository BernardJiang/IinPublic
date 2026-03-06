import { test, expect, chromium, Browser, BrowserContext, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { clearGunDatabases } from './helpers/clear-database';
import { ensureWindowFitsViewport } from './helpers/browser-window';

test.describe('Edit Talk - Talks tab list and edit created talks', () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;

  const TALK_TITLE = 'Coffee Meetup';
  const TALK_TITLE_EDITED = 'Coffee Meetup (Edited)';
  const screenshotDir = path.join(__dirname, '../../test-screenshots/edit-talk');

  test.beforeAll(async () => {
    await clearGunDatabases();

    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }

    browser = await chromium.launch({
      headless: false,
      slowMo: 100,
      args: ['--window-position=0,0', '--window-size=960,1400', '--force-device-scale-factor=1'],
    });
    console.log('🚀 Launched Chrome browser');
  });

  test.afterAll(async () => {
    if (page) await page.close();
    if (context) await context.close();
    if (browser) await browser.close();
    await clearGunDatabases();
    console.log('✅ Cleanup complete');
  });

  async function bootstrapUser(stageName: string): Promise<void> {
    context = await browser.newContext({
      viewport: { width: 960, height: 1200 },
      deviceScaleFactor: 1,
    });
    page = await context.newPage();
    page.on('console', (msg) => console.log('[Browser]:', msg.text()));

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await ensureWindowFitsViewport(page, 960, 1200);
    await page.waitForTimeout(3000);

    await page.click('.nav-btn[data-view="me"]');
    await page.waitForTimeout(1000);
    await page.waitForSelector('#edit-stagename-btn');
    await page.click('#edit-stagename-btn');
    await page.waitForTimeout(500);
    await page.fill('#new-stage-name', stageName);
    await page.click('#edit-stagename-form button[type="submit"]');
    await page.waitForTimeout(1000);
    await page.click('.nav-btn[data-view="chatrooms"]');
    await page.waitForTimeout(1000);
    console.log(`✅ Bootstrapped user "${stageName}"`);
  }

  test('Talks tab shows only created talks with stats and Edit opens editor with prefilled data', async () => {
    await bootstrapUser('EditTestUser');

    // 1) Create a talk from Chatrooms (header + button)
    await page.click('#create-talk-btn');
    await page.waitForSelector('#talk-editor-form');

    await page.fill('#talk-title', TALK_TITLE);
    await page.selectOption('#talk-type', 'matching');

    const question = page.locator('.question-item').first();
    await question.locator('.question-text').fill('Do you drink coffee?');
    const firstAnswer = question.locator('.answer-item').nth(0);
    const secondAnswer = question.locator('.answer-item').nth(1);
    await firstAnswer.locator('.answer-text').fill('Yes');
    await firstAnswer.locator('.answer-next').selectOption('noticed');
    await secondAnswer.locator('.answer-text').fill('No');
    await secondAnswer.locator('.answer-next').selectOption('ignore');

    await page.click('#talk-editor-form button[type="submit"]');
    await page.waitForTimeout(2000);

    await expect(page.getByText(/Talk created and sent to chatroom/i)).toBeVisible({ timeout: 10000 });
    console.log('✅ Talk created and broadcast');

    // 2) Go to Talks tab – should see only created talk (not answered), with stats and Edit
    await page.click('.nav-btn[data-view="talks"]');
    await page.waitForTimeout(2000);

    const talkItem = page.locator('.talk-list-item').filter({ hasText: TALK_TITLE }).first();
    await talkItem.waitFor({ state: 'visible', timeout: 15000 });

    await expect(talkItem).toBeVisible();
    await expect(talkItem.locator('.talk-badge-created')).toBeVisible();
    await expect(talkItem.locator('.edit-talk-btn')).toBeVisible();

    // Stats line: either "—" or "Responses: N · Matches: N · Ignores: N"
    const statsLine = talkItem.locator('.talk-item-stats');
    await expect(statsLine).toBeVisible();

    await page.screenshot({
      path: path.join(screenshotDir, '01-talks-list-created.png'),
      fullPage: true,
    });
    console.log('✅ Talks list shows created talk with Edit and stats');

    // 3) Click Edit – editor should open with prefilled title and type
    await talkItem.locator('.edit-talk-btn').click();
    await page.waitForSelector('#talk-editor-modal');
    await page.waitForSelector('#talk-editor-form');
    await page.waitForTimeout(500);

    await expect(page.getByRole('heading', { name: /Edit Talk/i })).toBeVisible();
    await expect(page.locator('#talk-title')).toHaveValue(TALK_TITLE);
    await expect(page.locator('#talk-type')).toHaveValue('matching');

    const questionText = page.locator('.question-item').first().locator('.question-text');
    await expect(questionText).toHaveValue('Do you drink coffee?');

    await page.screenshot({
      path: path.join(screenshotDir, '02-edit-dialog-prefilled.png'),
      fullPage: true,
    });
    console.log('✅ Edit dialog opened with prefilled data');

    // 4) Change title and save
    await page.fill('#talk-title', TALK_TITLE_EDITED);
    await page.click('#talk-editor-form button[type="submit"]');
    await page.waitForTimeout(2000);

    await expect(page.getByText(/Talk updated/i)).toBeVisible({ timeout: 10000 });
    console.log('✅ Talk updated notification shown');

    // 5) Talks list should show updated title
    await page.waitForTimeout(1500);
    const updatedItem = page.locator('.talk-list-item').filter({ hasText: TALK_TITLE_EDITED }).first();
    await expect(updatedItem).toBeVisible({ timeout: 8000 });
    await expect(updatedItem.locator('.talk-item-title')).toContainText(TALK_TITLE_EDITED);

    await page.screenshot({
      path: path.join(screenshotDir, '03-talks-list-after-edit.png'),
      fullPage: true,
    });
    console.log('✅ Talks list shows updated title');
  });
});
