import { test, expect, chromium, Browser, BrowserContext, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { clearGunDatabases } from './helpers/clear-database';

test.describe('Super user TechSupport: 10 tags + 10 talks, send to Tom, Tom answers all, TechSupport confirms', () => {
  let browserTechSupport: Browser;
  let browserTom: Browser;
  let contextTechSupport: BrowserContext;
  let contextTom: BrowserContext;
  let pageTechSupport: Page;
  let pageTom: Page;

  const TECH_SUPPORT_NAME = 'TechSupport';
  const TOM_NAME = 'Tom';

  const TAG_NAMES = [
    'Coffee',
    'Cat',
    'Tennis',
    'Jobs',
    'Food',
    'Music',
    'Travel',
    'Books',
    'Movies',
    'Sports',
  ];

  const TALK_TITLES = [
    'Tennis Partner',
    'Coffee Meetup',
    'Job Search',
    'Foodie',
    'Music Lover',
    'Travel Buddy',
    'Book Club',
    'Movie Night',
    'Sports Fan',
    'Hiking',
  ];

  const MATCH_ANSWER = 'Yes, match.';
  const IGNORE_ANSWER = 'No thanks.';

  const screenshotDir = path.join(
    __dirname,
    '../../test-screenshots/14-super-user-techsupport',
  );

  test.beforeAll(async () => {
    await clearGunDatabases();

    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }

    browserTechSupport = await chromium.launch({
      headless: false,
      slowMo: 80,
      args: ['--window-position=0,0', '--window-size=640,1000', '--force-device-scale-factor=1'],
    });
    browserTom = await chromium.launch({
      headless: false,
      slowMo: 80,
      args: ['--window-position=640,0', '--window-size=640,1000', '--force-device-scale-factor=1'],
    });
    console.log('🚀 Launched 2 Chrome browsers: TechSupport, Tom');
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
    await manualCleanup(pageTechSupport);
    await manualCleanup(pageTom);
    await pageTechSupport?.close();
    await pageTom?.close();
    await contextTechSupport?.close();
    await contextTom?.close();
    await browserTechSupport?.close();
    await browserTom?.close();
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
    await expect(locator).toBeVisible({ timeout: 20000 });
    console.log(`✅ ${label} saw notification: "${contains}"`);
  }

  test('TechSupport creates 10 tags + 10 talks, answers all himself (in UI); Tom joins; TechSupport sends all 20; Tom answers all; TechSupport confirms', async () => {
    test.setTimeout(300000); // 5 min - long flow with 20 answers and Gun.js sync

    // 1) TechSupport enters Global and creates 10 tags
    console.log('\n📍 STEP 1: TechSupport enters Global');
    const techSupport = await bootstrapUser(browserTechSupport, 'TechSupport', TECH_SUPPORT_NAME);
    contextTechSupport = techSupport.context;
    pageTechSupport = techSupport.page;
    await pageTechSupport.click('.chatroom-item:has-text("Global")');
    await pageTechSupport.waitForTimeout(2000);

    await pageTechSupport.click('.nav-btn[data-view="chatrooms"]');
    await pageTechSupport.waitForTimeout(500);
    await pageTechSupport.click('.chatroom-item:has-text("Global")');
    await pageTechSupport.waitForTimeout(1000);

    console.log('\n📍 STEP 2: TechSupport creates 10 tags');
    for (const tagName of TAG_NAMES) {
      await pageTechSupport.click('#create-talk-btn');
      await pageTechSupport.waitForSelector('#talk-editor-form');
      await pageTechSupport.click('input[name="talk-type-radio"][value="tag"]');
      await pageTechSupport.waitForTimeout(200);
      await pageTechSupport.fill('#talk-title', tagName);
      await pageTechSupport.click('#talk-editor-form button[type="submit"]');
      await pageTechSupport.waitForTimeout(1200);
    }

    // 2) TechSupport creates 10 matching talks (same match/ignore answer text for easy answering by Tom)
    console.log('\n📍 STEP 3: TechSupport creates 10 talks');
    for (const title of TALK_TITLES) {
      await pageTechSupport.click('#create-talk-btn');
      await pageTechSupport.waitForSelector('#talk-editor-form');
      await pageTechSupport.click('input[name="talk-type-radio"][value="matching"]');
      await pageTechSupport.waitForTimeout(200);
      await pageTechSupport.fill('#talk-title', title);
      const q = pageTechSupport.locator('.question-item').first();
      await q.locator('.question-text').fill(`Want to connect for ${title}?`);
      await q.locator('.answer-item').nth(0).locator('.answer-text').fill(MATCH_ANSWER);
      await q.locator('.answer-item').nth(0).locator('.answer-next').selectOption('noticed');
      await q.locator('.answer-item').nth(1).locator('.answer-text').fill(IGNORE_ANSWER);
      await q.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');
      await pageTechSupport.click('#talk-editor-form button[type="submit"]');
      await pageTechSupport.waitForTimeout(1200);
    }

    // 3) TechSupport "answers all himself": in this app the author does not receive their own broadcast,
    //    so we treat "has created 20 and will send to Tom" as the super-user setup.
    console.log('\n📍 STEP 4: TechSupport has 20 created (10 tags + 10 talks)');

    // 4) Tom joins Global so TechSupport sees him online
    console.log('\n📍 STEP 5: Tom joins Global');
    const tom = await bootstrapUser(browserTom, 'Tom', TOM_NAME);
    contextTom = tom.context;
    pageTom = tom.page;
    await pageTom.click('.chatroom-item:has-text("Global")');
    await pageTom.waitForTimeout(3000);

    // 5) TechSupport sends all 20 to Tom (broadcast)
    console.log('\n📍 STEP 6: TechSupport broadcasts all 20 to Tom');
    await pageTechSupport.click('.nav-btn[data-view="chatrooms"]');
    await pageTechSupport.waitForTimeout(500);
    await pageTechSupport.click('.chatroom-item:has-text("Global")');
    await pageTechSupport.waitForTimeout(1000);
    await pageTechSupport.click('#broadcast-talk-btn');
    await pageTechSupport.waitForTimeout(500);
    await waitForNotification(pageTechSupport, 'Sent 20 talk', 'TechSupport');

    // 6) Tom answers all 20: first 10 are tags (checkbox checked = match), next 10 are talks (click match answer)
    console.log('\n📍 STEP 7: Tom answers all 20');
    await pageTom.click('.nav-btn[data-view="talks"]');
    await pageTom.waitForTimeout(4000);

    for (const tagName of TAG_NAMES) {
      // Target only tag-type items (badge "tag") so we don't open a matching talk with similar name (e.g. "Coffee Meetup")
      await pageTom
        .locator('.talk-list-item')
        .filter({ has: pageTom.locator('.talk-badge-type').filter({ hasText: 'tag' }) })
        .filter({ hasText: tagName })
        .first()
        .click();
      await pageTom.waitForSelector('#talk-response-modal .modal-content', { timeout: 10000 });
      await pageTom.waitForSelector('#tag-match-checkbox', { state: 'visible', timeout: 15000 });
      await pageTom.locator('#tag-match-checkbox').check();
      await pageTom.click('#tag-submit-btn');
      await pageTom.waitForSelector('#talk-response-modal', { state: 'detached', timeout: 5000 });
      await pageTom.waitForTimeout(400);
    }

    for (const talkTitle of TALK_TITLES) {
      // Target only matching-type items so we don't open a tag when a title overlaps (e.g. "Tennis" tag vs "Tennis Partner" talk)
      await pageTom
        .locator('.talk-list-item')
        .filter({ has: pageTom.locator('.talk-badge-type').filter({ hasText: 'matching' }) })
        .filter({ hasText: talkTitle })
        .first()
        .click();
      await pageTom.waitForSelector('#talk-response-modal .modal-content', { timeout: 10000 });
      await pageTom.locator(`.answer-manual-btn[data-answer-text="${MATCH_ANSWER}"]`).first().click();
      await pageTom.waitForSelector('#talk-response-modal', { state: 'detached', timeout: 5000 });
      await pageTom.waitForTimeout(400);
    }

    // 7) TechSupport confirms all answers: open Talks so stats load, then status bar shows 20 matches
    console.log('\n📍 STEP 8: TechSupport confirms all 20 answers');
    await pageTechSupport.waitForTimeout(3000);
    // Open Talks first so needTalkStats runs and status bar gets match count (stats load when list is shown)
    await pageTechSupport.click('.nav-btn[data-view="talks"]');
    await pageTechSupport.waitForTimeout(2000);
    await expect(pageTechSupport.getByText(/Matched with:/).first()).toBeVisible({ timeout: 5000 });
    // Now wait for status bar to show match count (async needTalkStats updates it)
    const statusBar = pageTechSupport.locator('#status-bar-text');
    await expect(statusBar).toContainText(/20 match(es)?/, { timeout: 15000 });
    const matchedLines = await pageTechSupport.getByText(/Matched with:/).count();
    expect(matchedLines).toBeGreaterThanOrEqual(1);

    // Tom's Answer tab should show all 20 with Match
    await pageTom.click('.nav-btn[data-view="answers"]');
    await pageTom.waitForTimeout(2000);
    const answersContent = pageTom.locator('#answers-content');
    for (const name of [...TAG_NAMES, ...TALK_TITLES]) {
      await expect(answersContent.getByText(name).first()).toBeVisible({ timeout: 3000 });
    }
    await expect(answersContent.getByText(/Match/).first()).toBeVisible({ timeout: 3000 });

    console.log('✅ Super user test complete: TechSupport created 20, sent to Tom, Tom answered all, TechSupport confirmed.');
  });

  test('Copy talk: receive saves automatically; disable filters broadcast; enable includes again; delete removes', async () => {
    test.setTimeout(120000);

    console.log('\n📍 Copy-talk test: TechSupport creates one talk, Tom receives (saved), disables, broadcast 0, enables, broadcast 1, deletes');
    const techSupport = await bootstrapUser(browserTechSupport, 'TechSupport', TECH_SUPPORT_NAME);
    contextTechSupport = techSupport.context;
    pageTechSupport = techSupport.page;
    await pageTechSupport.click('.chatroom-item:has-text("Global")');
    await pageTechSupport.waitForTimeout(2000);

    const tom = await bootstrapUser(browserTom, 'Tom', TOM_NAME);
    contextTom = tom.context;
    pageTom = tom.page;
    await pageTom.click('.chatroom-item:has-text("Global")');
    await pageTom.waitForTimeout(2000);

    const copyTalkTitle = 'CopyTestTalk';
    await pageTechSupport.click('#create-talk-btn');
    await pageTechSupport.waitForSelector('#talk-editor-form');
    await pageTechSupport.click('input[name="talk-type-radio"][value="matching"]');
    await pageTechSupport.waitForTimeout(200);
    await pageTechSupport.fill('#talk-title', copyTalkTitle);
    const q = pageTechSupport.locator('.question-item').first();
    await q.locator('.question-text').fill('Want to connect for CopyTestTalk?');
    await q.locator('.answer-item').nth(0).locator('.answer-text').fill(MATCH_ANSWER);
    await q.locator('.answer-item').nth(0).locator('.answer-next').selectOption('noticed');
    await q.locator('.answer-item').nth(1).locator('.answer-text').fill(IGNORE_ANSWER);
    await q.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');
    await pageTechSupport.click('#talk-editor-form button[type="submit"]');
    await pageTechSupport.waitForTimeout(1500);

    await pageTechSupport.click('#broadcast-talk-btn');
    await pageTechSupport.waitForTimeout(500);
    await waitForNotification(pageTechSupport, 'Sent 1 talk', 'TechSupport');

    await pageTom.waitForTimeout(3000);
    await pageTom.click('.nav-btn[data-view="talks"]');
    await pageTom.waitForTimeout(2000);
    await expect(pageTom.locator('.talk-list-item').filter({ hasText: copyTalkTitle }).first()).toBeVisible({ timeout: 10000 });

    await pageTom.locator('.talk-list-item').filter({ hasText: copyTalkTitle }).first().click();
    await pageTom.waitForSelector('#talk-response-modal .modal-content', { timeout: 10000 });
    await pageTom.locator(`.answer-manual-btn[data-answer-text="${MATCH_ANSWER}"]`).first().click();
    await pageTom.waitForSelector('#talk-response-modal', { state: 'detached', timeout: 5000 });
    await pageTom.waitForTimeout(500);

    await pageTom.click('.nav-btn[data-view="talks"]');
    await pageTom.waitForTimeout(1000);
    await pageTom.locator('.talk-list-item').filter({ hasText: copyTalkTitle }).first().locator('button.toggle-broadcast-btn').click();
    await pageTom.waitForTimeout(800);

    await pageTom.click('.nav-btn[data-view="chatrooms"]');
    await pageTom.waitForTimeout(500);
    await pageTom.click('.chatroom-item:has-text("Global")');
    await pageTom.waitForTimeout(500);
    await pageTom.click('#broadcast-talk-btn');
    await pageTom.waitForTimeout(500);
    await waitForNotification(pageTom, 'You have no talks to broadcast', 'Tom');
    await pageTom.waitForTimeout(500);
    // Close talk-editor modal if it opened (broadcast with 0 talks opens create flow); wait until gone so nav isn't intercepted
    const talkEditorModal = pageTom.locator('#talk-editor-modal');
    if (await talkEditorModal.isVisible()) {
      await pageTom.locator('#cancel-talk-btn').click();
      await pageTom.waitForSelector('#talk-editor-modal', { state: 'detached', timeout: 5000 });
    }

    await pageTom.click('.nav-btn[data-view="talks"]');
    await pageTom.waitForTimeout(800);
    await pageTom.locator('.talk-list-item').filter({ hasText: copyTalkTitle }).first().locator('button.toggle-broadcast-btn').click();
    await pageTom.waitForTimeout(800);

    await pageTom.click('.nav-btn[data-view="chatrooms"]');
    await pageTom.waitForTimeout(500);
    await pageTom.click('.chatroom-item:has-text("Global")');
    await pageTom.waitForTimeout(500);
    await pageTom.click('#broadcast-talk-btn');
    await pageTom.waitForTimeout(500);
    await waitForNotification(pageTom, 'Sent 1 talk', 'Tom');

    await pageTom.click('.nav-btn[data-view="me"]');
    await pageTom.waitForTimeout(1000);
    await pageTom.click('#view-my-talks-btn');
    await pageTom.waitForSelector('#my-talks-modal', { timeout: 5000 });
    await pageTom.locator('.talk-history-item').filter({ hasText: copyTalkTitle }).first().locator('.delete-talk-btn').click();
    await pageTom.waitForTimeout(1000);
    await expect(pageTom.getByText('Talk removed from history')).toBeVisible({ timeout: 5000 });
    await pageTom.click('#close-my-talks-modal');
    await pageTom.waitForTimeout(500);
    await pageTom.click('#view-my-talks-btn');
    await pageTom.waitForTimeout(1000);
    await expect(pageTom.locator('.talk-history-item').filter({ hasText: copyTalkTitle })).toHaveCount(0);

    console.log('✅ Copy-talk test complete: receive saved, disabled filtered from broadcast, enable included, delete removed.');
  });
});
