import { test, expect, chromium, Browser, BrowserContext, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { clearGunDatabases } from './helpers/clear-database';

test.describe('Chatbot: Tom manual match, Bob bot match, bot icon on conversations', () => {
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
  const MATCH_ANSWER = 'Yes, lets play.';

  const screenshotDir = path.join(
    __dirname,
    '../../test-screenshots/15-chatbot-tennis-partner',
  );

  test.beforeAll(async () => {
    await clearGunDatabases();

    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }

    browserTom = await chromium.launch({
      headless: false,
      slowMo: 80,
      args: ['--window-position=0,0', '--window-size=640,1000', '--force-device-scale-factor=1'],
    });
    browserJerry = await chromium.launch({
      headless: false,
      slowMo: 80,
      args: ['--window-position=640,0', '--window-size=640,1000', '--force-device-scale-factor=1'],
    });
    browserBob = await chromium.launch({
      headless: false,
      slowMo: 80,
      args: ['--window-position=1280,0', '--window-size=640,1000', '--force-device-scale-factor=1'],
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

  test('Tom sends tennis talk; Jerry answers manually and matches; Bob sends same talk; Jerry chatbot matches; Tom has no bot icon, Bob has bot icon', async () => {
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

    // 2) Tom creates Tennis talk and broadcasts
    console.log('\n📍 STEP 2: Tom creates Tennis and broadcasts');
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
    await q1.locator('.answer-item').nth(1).locator('.answer-text').fill('No thanks.');
    await q1.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');
    await pageTom.click('#talk-editor-form button[type="submit"]');
    await pageTom.waitForTimeout(2000);

    await pageTom.click('#broadcast-talk-btn');
    await pageTom.waitForTimeout(500);
    await waitForNotification(pageTom, 'Sent 1 talk', 'Tom');
    await pageTom.waitForTimeout(1500);

    // 3) Jerry: enable chatbot, then open Tennis and answer manually (match)
    console.log('\n📍 STEP 3: Jerry enables chatbot then answers Tennis manually');
    await pageJerry.waitForTimeout(4000);
    await pageJerry.click('.nav-btn[data-view="me"]');
    await pageJerry.waitForTimeout(800);
    const chatbotCheckbox = pageJerry.locator('#chatbot-enabled-checkbox');
    await expect(chatbotCheckbox).toBeVisible({ timeout: 5000 });
    if (!(await chatbotCheckbox.isChecked())) {
      await chatbotCheckbox.click();
      await pageJerry.waitForTimeout(500);
    }
    await pageJerry.click('.nav-btn[data-view="talks"]');
    await pageJerry.waitForTimeout(3000);
    await pageJerry.locator('.talk-list-item').filter({ hasText: TALK_TENNIS }).first().click();
    await pageJerry.waitForSelector('#talk-response-modal .modal-content', { timeout: 10000 });
    await pageJerry.locator(`.answer-manual-btn[data-answer-text="${MATCH_ANSWER}"]`).first().click();
    await waitForNotification(pageJerry, 'Match!', 'Jerry');
    await pageJerry.waitForSelector('#talk-response-modal', { state: 'detached', timeout: 5000 });
    await pageJerry.waitForTimeout(500);

    // 4) Get tennis talkId from Tom's talk list (so Bob can re-announce the same talk)
    console.log('\n📍 STEP 4: Get tennis talkId from Tom');
    await pageTom.click('.nav-btn[data-view="talks"]');
    await pageTom.waitForTimeout(2000);
    const tennisItem = pageTom.locator('.talk-list-item').filter({ hasText: TALK_TENNIS }).first();
    await expect(tennisItem).toBeVisible({ timeout: 5000 });
    const talkId = await tennisItem.getAttribute('data-talk-id');
    expect(talkId).toBeTruthy();
    console.log('  talkId:', talkId);

    // 5) Bob re-announces the same talk to the room (triggers Jerry's chatbot)
    console.log('\n📍 STEP 5: Bob sends same talk to room (announceTalkToRoom)');
    await pageBob.evaluate(
      async (id: string) => {
        const app = (window as any).__iinpublic_app?.getApp();
        if (!app || !app.announceTalkToRoom) throw new Error('announceTalkToRoom not found');
        await app.announceTalkToRoom(id);
      },
      talkId!,
    );
    await pageBob.waitForTimeout(3000);

    // 6) Bob should get Match! (chatbot replied for Jerry)
    await waitForNotification(pageBob, 'Match!', 'Bob');
    await pageBob.waitForTimeout(2000);

    // 7) Tom's Me → Conversations: Jerry with NO bot icon
    console.log('\n📍 STEP 7: Tom sees Jerry without bot icon');
    await pageTom.click('.nav-btn[data-view="me"]');
    await pageTom.waitForTimeout(2000);
    const tomJerryConversation = pageTom.locator('.conversation-list-item').filter({ hasText: 'Jerry' }).first();
    await expect(tomJerryConversation).toBeVisible({ timeout: 8000 });
    await expect(tomJerryConversation.locator('.conversation-bot-badge')).not.toBeVisible();
    console.log('✅ Tom: Jerry conversation has no bot badge');

    // 8) Bob's Me → Conversations: Jerry WITH bot icon
    console.log('\n📍 STEP 8: Bob sees Jerry with bot icon');
    await pageBob.click('.nav-btn[data-view="me"]');
    await pageBob.waitForTimeout(2000);
    const bobJerryConversation = pageBob.locator('.conversation-list-item').filter({ hasText: 'Jerry' }).first();
    await expect(bobJerryConversation).toBeVisible({ timeout: 8000 });
    await expect(bobJerryConversation.locator('.conversation-bot-badge')).toBeVisible();
    await expect(bobJerryConversation).toHaveAttribute('data-responded-by-bot', 'true');
    console.log('✅ Bob: Jerry conversation has bot badge');

    // 9) Tom's Talks tab "Matched with" shows Jerry without bot emoji (Tom created the talk)
    await pageTom.click('.nav-btn[data-view="talks"]');
    await pageTom.waitForTimeout(2000);
    const tomMatchedWith = pageTom.getByText(/Matched with:/).first();
    await expect(tomMatchedWith).toBeVisible({ timeout: 5000 });
    await expect(tomMatchedWith).toContainText('Jerry');
    await expect(tomMatchedWith).not.toContainText('🤖');
    console.log('✅ Talks tab: Tom matched with Jerry (no bot icon)');

    await pageTom.screenshot({
      path: path.join(screenshotDir, 'tom-conversations-no-bot.png'),
      fullPage: false,
    });
    await pageBob.screenshot({
      path: path.join(screenshotDir, 'bob-conversations-bot-icon.png'),
      fullPage: false,
    });
  });
});
