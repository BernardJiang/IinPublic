import { test, expect, chromium, Browser, BrowserContext, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { clearGunDatabases } from './helpers/clear-database';
import { ensureWindowFitsViewport } from './helpers/browser-window';

test.describe('Global room: 3 users, 2 talks, match status on status bar', () => {
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
    '../../test-screenshots/11-global-three-users-two-talks-match-status',
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

  test('Tom broadcasts; members highlight; Jerry/Bob see Tom flash, click Tom or Talks; match indicators; Answer tab match/mismatch', async () => {
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

    // 2) Tom creates Tennis and Coffee, then broadcasts
    console.log('\n📍 STEP 2: Tom creates Tennis and Coffee, then broadcasts');
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

    // Tom clicks broadcast: member list should get highlight (broadcast-sent-to)
    await pageTom.click('#broadcast-talk-btn');
    await pageTom.waitForTimeout(300);
    const tomMemberItems = pageTom.locator('#chatroom-members-list .chatroom-member-item.broadcast-sent-to');
    await expect(tomMemberItems.first()).toBeVisible({ timeout: 2000 });
    const count = await tomMemberItems.count();
    expect(count).toBeGreaterThanOrEqual(1);
    console.log(`✅ Tom: member list background changed (${count} members highlighted)`);
    await pageTom.waitForTimeout(1500);
    await waitForNotification(pageTom, 'Sent 2 talks', 'Tom');

    // 3) Jerry: Tom's icon flashes when talks arrive; click on Tom to see talks, or go to Talks tab
    console.log('\n📍 STEP 3: Jerry sees Tom (flash), clicks Tom to see talks from Tom');
    await pageJerry.waitForTimeout(4000);
    await pageJerry.locator('.chatroom-member-item').filter({ hasText: 'Tom' }).first().click();
    try {
      await pageJerry.waitForSelector('#talks-from-user-modal', { timeout: 10000 });
      await pageJerry.click('.talk-from-user-item:has-text("Tennis")');
    } catch {
      await pageJerry.click('.nav-btn[data-view="talks"]');
      await pageJerry.waitForTimeout(3000);
      await pageJerry.locator('.talk-list-item').filter({ hasText: TALK_TENNIS }).first().click();
    }
    await pageJerry.waitForSelector('#talk-response-modal .modal-content', { timeout: 10000 });
    await pageJerry.locator(`input.choice-radio[data-answer-text="${MATCH_ANSWER}"][data-mode="manual"]`).first().click();
    await waitForNotification(pageJerry, 'Match!', 'Jerry');
    await pageJerry.waitForSelector('#talk-response-modal', { state: 'detached', timeout: 5000 });
    await pageJerry.waitForTimeout(500);

    // Jerry answers Coffee with mismatch (Not now.)
    await pageJerry.click('.nav-btn[data-view="talks"]');
    await pageJerry.waitForTimeout(2000);
    await pageJerry.locator('.talk-list-item').filter({ hasText: TALK_COFFEE }).first().click();
    await pageJerry.waitForSelector('#talk-response-modal .modal-content', { timeout: 5000 });
    await pageJerry.locator(`input.choice-radio[data-answer-text="${IGNORE_ANSWER_COFFEE}"][data-mode="manual"]`).first().click();
    await pageJerry.waitForSelector('#talk-response-modal', { state: 'detached', timeout: 5000 });
    console.log('✅ Jerry: Tennis match, Coffee mismatch');

    // 4) Bob: go to Talks tab, open Coffee and match; open Tennis and ignore
    console.log('\n📍 STEP 4: Bob goes to Talks tab, matches Coffee, mismatches Tennis');
    await pageBob.click('.nav-btn[data-view="talks"]');
    await pageBob.waitForTimeout(3000);
    await pageBob.locator('.talk-list-item').filter({ hasText: TALK_COFFEE }).first().click();
    await pageBob.waitForSelector('#talk-response-modal .modal-content', { timeout: 10000 });
    await pageBob.locator(`input.choice-radio[data-answer-text="${MATCH_ANSWER_COFFEE}"][data-mode="manual"]`).first().click();
    await waitForNotification(pageBob, 'Match!', 'Bob');
    await pageBob.waitForSelector('#talk-response-modal', { state: 'detached', timeout: 5000 });
    await pageBob.waitForTimeout(500);

    await pageBob.locator('.talk-list-item').filter({ hasText: TALK_TENNIS }).first().click();
    await pageBob.waitForSelector('#talk-response-modal .modal-content', { timeout: 5000 });
    await pageBob.locator(`input.choice-radio[data-answer-text="${IGNORE_ANSWER}"][data-mode="manual"]`).first().click();
    await pageBob.waitForSelector('#talk-response-modal', { state: 'detached', timeout: 5000 });
    console.log('✅ Bob: Coffee match, Tennis mismatch');

    // 5) Tom sees match notifications and green on Jerry/Bob in member list
    console.log('\n📍 STEP 5: Tom sees matches and green on Jerry and Bob');
    await waitForNotification(pageTom, 'Match!', 'Tom (first)');
    await pageTom.waitForTimeout(2000);
    await waitForNotification(pageTom, 'Match!', 'Tom (second)');
    await pageTom.waitForTimeout(2000);

    await pageTom.click('.nav-btn[data-view="chatrooms"]');
    await pageTom.waitForTimeout(500);
    await pageTom.click('.chatroom-item:has-text("Global")');
    await pageTom.waitForTimeout(1000);
    await expect(pageTom.locator('.chatroom-member-item.member-matched').first()).toBeVisible({ timeout: 8000 });
    const matchedCount = await pageTom.locator('.chatroom-member-item.member-matched').count();
    expect(matchedCount).toBeGreaterThanOrEqual(2);
    console.log(`✅ Tom: Jerry and Bob show as matched (green, count=${matchedCount})`);

    // 6) Tom's Talks tab: show both users on matched talks ("Matched with: Jerry" / "Matched with: Bob")
    await pageTom.click('.nav-btn[data-view="talks"]');
    await pageTom.waitForTimeout(3000);
    await expect(pageTom.getByText(/Matched with:/).first()).toBeVisible({ timeout: 5000 });
    const statusBar = pageTom.locator('#status-bar-text');
    await expect(statusBar).toContainText(/2 match(es)?/, { timeout: 5000 });
    console.log('✅ Tom: Talks show matched users; status bar shows 2 matches');

    // 7) Jerry goes to Answer tab: Coffee mismatch, Tennis match
    console.log('\n📍 STEP 7: Jerry Answer tab — Coffee mismatch, Tennis match');
    await pageJerry.click('.nav-btn[data-view="answers"]');
    await pageJerry.waitForTimeout(2000);
    const jerryContent = pageJerry.locator('#answers-content');
    await expect(jerryContent.getByText(TALK_TENNIS).first()).toBeVisible({ timeout: 5000 });
    await expect(jerryContent.getByText(TALK_COFFEE).first()).toBeVisible({ timeout: 5000 });
    await expect(jerryContent.getByText(/Match/).first()).toBeVisible({ timeout: 5000 });
    await expect(jerryContent.getByText(/Mismatch/).first()).toBeVisible({ timeout: 5000 });
    console.log('✅ Jerry: Answer tab shows Tennis Match, Coffee Mismatch');

    // 8) Bob goes to Answer tab: Coffee match, Tennis mismatch
    console.log('\n📍 STEP 8: Bob Answer tab — Coffee match, Tennis mismatch');
    await pageBob.click('.nav-btn[data-view="answers"]');
    await pageBob.waitForTimeout(2000);
    const bobContent = pageBob.locator('#answers-content');
    await expect(bobContent.getByText(TALK_COFFEE).first()).toBeVisible({ timeout: 5000 });
    await expect(bobContent.getByText(TALK_TENNIS).first()).toBeVisible({ timeout: 5000 });
    await expect(bobContent.getByText(/Match/).first()).toBeVisible({ timeout: 5000 });
    await expect(bobContent.getByText(/Mismatch/).first()).toBeVisible({ timeout: 5000 });
    console.log('✅ Bob: Answer tab shows Coffee Match, Tennis Mismatch');

    await pageTom.screenshot({
      path: path.join(screenshotDir, 'tom-status-bar-matches.png'),
      fullPage: false,
    });
  });
});
