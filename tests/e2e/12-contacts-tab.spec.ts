import { test, expect, chromium, Browser, BrowserContext, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { clearGunDatabases } from './helpers/clear-database';
import { ensureWindowFitsViewport } from './helpers/browser-window';

test.describe('Contacts tab: list of users with matches, click to see matching talks', () => {
  let browserTom: Browser;
  let browserJerry: Browser;
  let browserBob: Browser;
  let contextTom: BrowserContext;
  let contextJerry: BrowserContext;
  let contextBob: BrowserContext;
  let pageTom: Page;
  let pageJerry: Page;
  let pageBob: Page;

  const TALK_TENNIS = 'Tennis';
  const TALK_COFFEE = 'Coffee';
  const MATCH_ANSWER = 'Yes, lets play.';
  const MATCH_ANSWER_COFFEE = 'Yes, coffee sounds good.';
  const IGNORE_ANSWER = 'No thanks.';
  const IGNORE_ANSWER_COFFEE = 'Not now.';

  const screenshotDir = path.join(
    __dirname,
    '../../test-screenshots/12-contacts-tab',
  );

  test.beforeAll(async () => {
    await clearGunDatabases();

    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }

    browserTom = await chromium.launch({
      headless: false,
      slowMo: 100,
      args: ['--window-position=0,0', '--window-size=640,1200', '--force-device-scale-factor=1'],
    });
    browserJerry = await chromium.launch({
      headless: false,
      slowMo: 100,
      args: ['--window-position=640,0', '--window-size=640,1200', '--force-device-scale-factor=1'],
    });
    browserBob = await chromium.launch({
      headless: false,
      slowMo: 100,
      args: ['--window-position=1280,0', '--window-size=640,1200', '--force-device-scale-factor=1'],
    });
    console.log('🚀 Launched 3 Chrome browsers: Tom, Jerry, Bob');
  });

  test.afterAll(async () => {
    const manualCleanup = async (page?: Page) => {
      if (!page) return;
      try {
        await page.evaluate(() => {
          const webApp = (window as any).__iinpublic_app;
          if (webApp?.getApp) webApp.getApp().manualCleanup();
        });
      } catch {
        // ignore
      }
    };
    await manualCleanup(pageTom);
    await manualCleanup(pageJerry);
    await manualCleanup(pageBob);
    await pageTom?.close();
    await pageJerry?.close();
    await pageBob?.close();
    await contextTom?.close();
    await contextJerry?.close();
    await contextBob?.close();
    await browserTom?.close();
    await browserJerry?.close();
    await browserBob?.close();
    await clearGunDatabases();
    console.log('✅ Cleanup complete');
  });

  async function bootstrapUser(
    browser: Browser,
    label: string,
    stageName: string,
  ): Promise<{ context: BrowserContext; page: Page }> {
    const context = await browser.newContext({
      viewport: { width: 640, height: 1000 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    page.on('console', (msg) => console.log(`[${label}]:`, msg.text()));

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await ensureWindowFitsViewport(page, 640, 1000);
    await page.waitForTimeout(3000);

    await page.click('.nav-btn[data-view="me"]');
    await page.waitForTimeout(1000);
    await page.waitForSelector('#edit-stagename-btn');
    await page.click('#edit-stagename-btn');
    await page.waitForTimeout(500);
    await page.fill('#new-stage-name', stageName);
    await page.click('#edit-stagename-form button[type="submit"]');
    await page.waitForTimeout(1000);

    const headerStageName = page.locator('[data-testid="user-stage-name"]');
    await expect(headerStageName).toContainText(stageName);

    await page.click('.nav-btn[data-view="chatrooms"]');
    await page.waitForTimeout(1000);
    return { context, page };
  }

  async function waitForNotification(page: Page, contains: string, label: string): Promise<void> {
    const locator = page.getByText(contains, { exact: false }).first();
    await expect(locator).toBeVisible({ timeout: 15000 });
    console.log(`✅ ${label} saw notification: "${contains}"`);
  }

  test('Contacts tab shows users with matches; click contact shows list of matching talks', async () => {
    // 1) Tom, Jerry, Bob enter Global
    console.log('\n📍 STEP 1: Tom, Jerry, Bob enter Global');
    const tom = await bootstrapUser(browserTom, 'Tom', 'Tom');
    contextTom = tom.context;
    pageTom = tom.page;
    await pageTom.click('.chatroom-item:has-text("Global")');
    await pageTom.waitForTimeout(2000);

    const jerry = await bootstrapUser(browserJerry, 'Jerry', 'Jerry');
    contextJerry = jerry.context;
    pageJerry = jerry.page;
    await pageJerry.click('.chatroom-item:has-text("Global")');
    await pageJerry.waitForTimeout(2000);

    const bob = await bootstrapUser(browserBob, 'Bob', 'Bob');
    contextBob = bob.context;
    pageBob = bob.page;
    await pageBob.click('.chatroom-item:has-text("Global")');
    await pageBob.waitForTimeout(2000);

    // 2) Tom creates Tennis and Coffee, broadcasts
    console.log('\n📍 STEP 2: Tom creates Tennis and Coffee, broadcasts');
    await pageTom.click('.nav-btn[data-view="chatrooms"]');
    await pageTom.waitForTimeout(500);
    await pageTom.click('.chatroom-item:has-text("Global")');
    await pageTom.waitForTimeout(1000);

    await pageTom.click('#create-talk-btn');
    await pageTom.waitForSelector('#talk-editor-form');
    await pageTom.fill('#talk-title', TALK_TENNIS);
    await pageTom.selectOption('#talk-type', 'matching');
    const q1 = pageTom.locator('.question-item').first();
    await q1.locator('.question-text').fill('Want a tennis partner?');
    await q1.locator('.answer-item').nth(0).locator('.answer-text').fill(MATCH_ANSWER);
    await q1.locator('.answer-item').nth(0).locator('.answer-next').selectOption('noticed');
    await q1.locator('.answer-item').nth(1).locator('.answer-text').fill(IGNORE_ANSWER);
    await q1.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');
    await pageTom.click('#talk-editor-form button[type="submit"]');
    await pageTom.waitForTimeout(2000);

    await pageTom.click('#create-talk-btn');
    await pageTom.waitForSelector('#talk-editor-form');
    await pageTom.fill('#talk-title', TALK_COFFEE);
    await pageTom.selectOption('#talk-type', 'matching');
    const q2 = pageTom.locator('.question-item').first();
    await q2.locator('.question-text').fill('Want to grab coffee?');
    await q2.locator('.answer-item').nth(0).locator('.answer-text').fill(MATCH_ANSWER_COFFEE);
    await q2.locator('.answer-item').nth(0).locator('.answer-next').selectOption('noticed');
    await q2.locator('.answer-item').nth(1).locator('.answer-text').fill(IGNORE_ANSWER_COFFEE);
    await q2.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');
    await pageTom.click('#talk-editor-form button[type="submit"]');
    await pageTom.waitForTimeout(2000);

    await pageTom.click('#broadcast-talk-btn');
    await pageTom.waitForTimeout(1500);
    await waitForNotification(pageTom, 'Sent 2 talks', 'Tom');

    // 3) Jerry: answer Tennis (match), Coffee (mismatch)
    console.log('\n📍 STEP 3: Jerry matches Tennis, mismatches Coffee');
    await pageJerry.waitForTimeout(4000);
    try {
      await pageJerry.locator('.chatroom-member-item').filter({ hasText: 'Tom' }).first().click();
      await pageJerry.waitForSelector('#talks-from-user-modal', { timeout: 10000 });
      await pageJerry.click('.talk-from-user-item:has-text("Tennis")');
    } catch {
      await pageJerry.click('.nav-btn[data-view="talks"]');
      await pageJerry.waitForTimeout(3000);
      await pageJerry.locator('.talk-list-item').filter({ hasText: TALK_TENNIS }).first().click();
    }
    await pageJerry.waitForSelector('#talk-response-modal .modal-content', { timeout: 10000 });
    await pageJerry.locator(`.answer-manual-btn[data-answer-text="${MATCH_ANSWER}"]`).first().click();
    await waitForNotification(pageJerry, 'Match!', 'Jerry');
    await pageJerry.waitForSelector('#talk-response-modal', { state: 'detached', timeout: 5000 });
    await pageJerry.waitForTimeout(500);

    await pageJerry.click('.nav-btn[data-view="talks"]');
    await pageJerry.waitForTimeout(2000);
    await pageJerry.locator('.talk-list-item').filter({ hasText: TALK_COFFEE }).first().click();
    await pageJerry.waitForSelector('#talk-response-modal .modal-content', { timeout: 5000 });
    await pageJerry.locator(`.answer-manual-btn[data-answer-text="${IGNORE_ANSWER_COFFEE}"]`).first().click();
    await pageJerry.waitForSelector('#talk-response-modal', { state: 'detached', timeout: 5000 });

    // 4) Bob: answer Coffee (match), Tennis (mismatch)
    console.log('\n📍 STEP 4: Bob matches Coffee, mismatches Tennis');
    await pageBob.click('.nav-btn[data-view="talks"]');
    await pageBob.waitForTimeout(3000);
    await pageBob.locator('.talk-list-item').filter({ hasText: TALK_COFFEE }).first().click();
    await pageBob.waitForSelector('#talk-response-modal .modal-content', { timeout: 10000 });
    await pageBob.locator(`.answer-manual-btn[data-answer-text="${MATCH_ANSWER_COFFEE}"]`).first().click();
    await waitForNotification(pageBob, 'Match!', 'Bob');
    await pageBob.waitForSelector('#talk-response-modal', { state: 'detached', timeout: 5000 });
    await pageBob.waitForTimeout(500);

    await pageBob.locator('.talk-list-item').filter({ hasText: TALK_TENNIS }).first().click();
    await pageBob.waitForSelector('#talk-response-modal .modal-content', { timeout: 5000 });
    await pageBob.locator(`.answer-manual-btn[data-answer-text="${IGNORE_ANSWER}"]`).first().click();
    await pageBob.waitForSelector('#talk-response-modal', { state: 'detached', timeout: 5000 });

    // Wait for Tom to receive both match notifications
    await waitForNotification(pageTom, 'Match!', 'Tom (first)');
    await pageTom.waitForTimeout(2000);
    await waitForNotification(pageTom, 'Match!', 'Tom (second)');
    await pageTom.waitForTimeout(2000);

    // 5) Tom: Contacts tab — should see Jerry and Bob, each with 1 match
    console.log('\n📍 STEP 5: Tom opens Contacts, sees Jerry and Bob with match counts');
    await pageTom.click('.nav-btn[data-view="contacts"]');
    await pageTom.waitForTimeout(500);

    await expect(pageTom.locator('#contacts-list .contact-item')).toHaveCount(2, { timeout: 10000 });
    const contactsList = pageTom.locator('#contacts-list');
    await expect(contactsList.getByText('Jerry')).toBeVisible();
    await expect(contactsList.getByText('Bob')).toBeVisible();
    await expect(contactsList.getByText('1 match(es)').first()).toBeVisible();
    console.log('✅ Tom: Contacts list shows Jerry and Bob, each 1 match');

    // Tom: click Jerry → see Tennis in matching talks list
    await pageTom.locator('.contact-item').filter({ hasText: 'Jerry' }).first().click();
    await pageTom.waitForTimeout(1000);
    await expect(pageTom.locator('#contact-detail-name')).toContainText('Jerry');
    await expect(pageTom.locator('#contact-detail-matches')).toContainText('1 match');
    await expect(pageTom.locator('.contact-talk-item').filter({ hasText: TALK_TENNIS })).toBeVisible();
    console.log('✅ Tom: Click Jerry → see Tennis in matching talks');

    // Tom: back to contacts list, click Bob → see Coffee
    await pageTom.click('#back-to-contacts-list');
    await pageTom.waitForTimeout(500);
    await pageTom.locator('.contact-item').filter({ hasText: 'Bob' }).first().click();
    await pageTom.waitForTimeout(1000);
    await expect(pageTom.locator('#contact-detail-name')).toContainText('Bob');
    await expect(pageTom.locator('.contact-talk-item').filter({ hasText: TALK_COFFEE })).toBeVisible();
    console.log('✅ Tom: Click Bob → see Coffee in matching talks');

    // 6) Jerry: Contacts tab — should see Tom with 1 match; click Tom → see Tennis
    console.log('\n📍 STEP 6: Jerry opens Contacts, sees Tom with 1 match');
    await pageJerry.click('.nav-btn[data-view="contacts"]');
    await pageJerry.waitForTimeout(2000);

    await expect(pageJerry.locator('#contacts-list .contact-item')).toHaveCount(1);
    await expect(pageJerry.locator('#contacts-list').getByText('Tom')).toBeVisible();
    await pageJerry.locator('.contact-item').filter({ hasText: 'Tom' }).first().click();
    await pageJerry.waitForTimeout(1000);
    await expect(pageJerry.locator('#contact-detail-name')).toContainText('Tom');
    await expect(pageJerry.locator('.contact-talk-item').filter({ hasText: TALK_TENNIS })).toBeVisible();
    console.log('✅ Jerry: Contacts shows Tom; click Tom → see Tennis');

    // 7) Bob: Contacts tab — should see Tom with 1 match; click Tom → see Coffee
    console.log('\n📍 STEP 7: Bob opens Contacts, sees Tom with 1 match');
    await pageBob.click('.nav-btn[data-view="contacts"]');
    await pageBob.waitForTimeout(2000);

    await expect(pageBob.locator('#contacts-list .contact-item')).toHaveCount(1);
    await expect(pageBob.locator('#contacts-list').getByText('Tom')).toBeVisible();
    await pageBob.locator('.contact-item').filter({ hasText: 'Tom' }).first().click();
    await pageBob.waitForTimeout(1000);
    await expect(pageBob.locator('#contact-detail-name')).toContainText('Tom');
    await expect(pageBob.locator('.contact-talk-item').filter({ hasText: TALK_COFFEE })).toBeVisible();
    console.log('✅ Bob: Contacts shows Tom; click Tom → see Coffee');

    await pageTom.screenshot({
      path: path.join(screenshotDir, 'tom-contacts-list.png'),
      fullPage: false,
    });
  });
});
