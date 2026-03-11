import { test, expect, chromium, Browser, BrowserContext, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { clearGunDatabases } from './helpers/clear-database';
import { ensureWindowFitsViewport } from './helpers/browser-window';

test.describe('Tennis partner: 3-question talk, Jerry ignores Q3 then changes to yes, both get match; Answer tab shows Q&A', () => {
  let browserTom: Browser;
  let browserJerry: Browser;
  let contextTom: BrowserContext;
  let contextJerry: BrowserContext;
  let pageTom: Page;
  let pageJerry: Page;

  const TALK_TITLE = 'Tennis Partner';
  // Q1: Do you play tennis?
  const Q1_YES = 'Yes';
  const Q1_NO = 'No';
  // Q2: What's your skill level? (only amateur → Q3)
  const Q2_BEGINNER = 'beginner';
  const Q2_AMATEUR = 'amateur';
  const Q2_PROFESSIONAL = 'professional';
  // Q3: Are you available at Balboa Center every Sunday?
  const Q3_YES = 'Yes';
  const Q3_NO = 'No';

  const Q1_TEXT = 'Do you play tennis?';
  const Q2_TEXT = "What's your skill level?";
  const Q3_TEXT = 'Are you available at Balboa Center every Sunday?';

  const screenshotDir = path.join(
    __dirname,
    '../../test-screenshots/16-tennis-ignore-then-match',
  );

  test.beforeAll(async () => {
    await clearGunDatabases();

    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }

    browserTom = await chromium.launch({
      headless: false,
      slowMo: 80,
      args: ['--window-position=0,0', '--window-size=640,1200', '--force-device-scale-factor=1'],
    });
    browserJerry = await chromium.launch({
      headless: false,
      slowMo: 80,
      args: ['--window-position=640,0', '--window-size=640,1200', '--force-device-scale-factor=1'],
    });
    console.log('🚀 Launched 2 Chrome browsers: Tom, Jerry');
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
    await pageTom?.close();
    await pageJerry?.close();
    await contextTom?.close();
    await contextJerry?.close();
    await browserTom?.close();
    await browserJerry?.close();
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

  test('Tom sends 3-question tennis talk; Jerry answers Yes/amateur/No then reopens and picks Yes for Q3; both get match; Jerry Answer tab shows 3 Q&A', async () => {
    test.setTimeout(180000); // 3 min - multi-question flow + 5s wait + Gun sync

    // 1) Tom and Jerry enter Global
    console.log('\n📍 STEP 1: Tom and Jerry enter Global');
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

    // 2) Tom creates 3-question Tennis Partner talk
    // Q1: Do you play tennis? Yes → next, No → ignore
    // Q2: What's your skill level? beginner → ignore, amateur → Q3, professional → ignore
    // Q3: Are you available at Balboa Center every Sunday? Yes → match, No → ignore
    console.log('\n📍 STEP 2: Tom creates 3-question Tennis Partner talk');
    await pageTom.click('.nav-btn[data-view="chatrooms"]');
    await pageTom.waitForTimeout(500);
    await pageTom.click('.chatroom-item:has-text("Global")');
    await pageTom.waitForTimeout(1000);

    await pageTom.click('#create-talk-btn');
    await pageTom.waitForSelector('#talk-editor-form');
    await pageTom.fill('#talk-title', TALK_TITLE);
    await pageTom.selectOption('#talk-type', 'matching');

    // Add Question 2 and 3 first so "Go to Question 2/3" options exist in dropdowns
    await pageTom.click('#add-question-btn');
    await pageTom.waitForTimeout(300);
    await pageTom.click('#add-question-btn');
    await pageTom.waitForTimeout(300);

    // Question 1: Do you play tennis? Yes → next, No → ignore
    const q0 = pageTom.locator('.question-item').nth(0);
    await q0.locator('.question-text').fill(Q1_TEXT);
    await q0.locator('.answer-item').nth(0).locator('.answer-text').fill(Q1_YES);
    await q0.locator('.answer-item').nth(0).locator('.answer-next').selectOption('q_1');
    await q0.locator('.answer-item').nth(1).locator('.answer-text').fill(Q1_NO);
    await q0.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');

    // Question 2: What's your skill level? (3 answers: only amateur → Q3)
    const q1 = pageTom.locator('.question-item').nth(1);
    await q1.locator('.question-text').fill(Q2_TEXT);
    await q1.locator('.answer-item').nth(0).locator('.answer-text').fill(Q2_BEGINNER);
    await q1.locator('.answer-item').nth(0).locator('.answer-next').selectOption('ignore');
    await q1.locator('.answer-item').nth(1).locator('.answer-text').fill(Q2_AMATEUR);
    await q1.locator('.answer-item').nth(1).locator('.answer-next').selectOption('q_2');
    await q1.locator('.btn-add-answer').click();
    await pageTom.waitForTimeout(300);
    await q1.locator('.answer-item').nth(2).locator('.answer-text').fill(Q2_PROFESSIONAL);
    await q1.locator('.answer-item').nth(2).locator('.answer-next').selectOption('ignore');

    // Question 3: Balboa Center every Sunday?
    const q2 = pageTom.locator('.question-item').nth(2);
    await q2.locator('.question-text').fill(Q3_TEXT);
    await q2.locator('.answer-item').nth(0).locator('.answer-text').fill(Q3_YES);
    await q2.locator('.answer-item').nth(0).locator('.answer-next').selectOption('noticed');
    await q2.locator('.answer-item').nth(1).locator('.answer-text').fill(Q3_NO);
    await q2.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');

    await pageTom.click('#talk-editor-form button[type="submit"]');
    await pageTom.waitForTimeout(2000);

    await pageTom.click('#broadcast-talk-btn');
    await pageTom.waitForTimeout(500);
    await waitForNotification(pageTom, 'Sent 1 talk', 'Tom');
    await pageTom.waitForTimeout(1500);

    // 3) Jerry opens talk: Q1 Yes, Q2 amateur, Q3 No → no match
    console.log('\n📍 STEP 3: Jerry answers Yes, amateur, No → no match');
    await pageJerry.waitForTimeout(4000);
    await pageJerry.click('.nav-btn[data-view="talks"]');
    await pageJerry.waitForTimeout(3000);
    await pageJerry.locator('.talk-list-item').filter({ hasText: TALK_TITLE }).first().click();
    await pageJerry.waitForSelector('#talk-response-modal .modal-content', { timeout: 10000 });

    await pageJerry.locator(`input.choice-radio[data-answer-text="${Q1_YES}"][data-mode="manual"]`).first().click();
    await pageJerry.waitForTimeout(500);
    await pageJerry.locator(`input.choice-radio[data-answer-text="${Q2_AMATEUR}"][data-mode="manual"]`).first().click();
    await pageJerry.waitForTimeout(500);
    await pageJerry.locator(`input.choice-radio[data-answer-text="${Q3_NO}"][data-mode="manual"]`).first().click();

    await pageJerry.waitForSelector('#talk-response-modal', { state: 'detached', timeout: 5000 });
    console.log('✅ Jerry answered Q1 Yes, Q2 amateur, Q3 No — no match (modal closed)');

    // 4) 5 seconds later Jerry reopens talk and answers Q3 Yes → match
    console.log('\n📍 STEP 4: 5s later Jerry reopens talk and picks Yes for Q3');
    await pageJerry.waitForTimeout(5000);

    await pageJerry.locator('.talk-list-item').filter({ hasText: TALK_TITLE }).first().click();
    await pageJerry.waitForSelector('#talk-response-modal .modal-content', { timeout: 10000 });

    // Previous answers should be displayed: Q1 Yes, Q2 amateur (Q3 was No so not saved)
    await expect(pageJerry.getByText(Q1_TEXT)).toBeVisible();
    await expect(pageJerry.locator(`input.choice-radio[data-answer-text="${Q1_YES}"][data-mode="manual"]`).first()).toBeChecked();
    await pageJerry.locator(`input.choice-radio[data-answer-text="${Q1_YES}"][data-mode="auto"]`).first().click();
    await pageJerry.waitForTimeout(500);

    await expect(pageJerry.getByText(Q2_TEXT)).toBeVisible();
    await expect(pageJerry.locator(`input.choice-radio[data-answer-text="${Q2_AMATEUR}"][data-mode="manual"]`).first()).toBeChecked();
    await pageJerry.locator(`input.choice-radio[data-answer-text="${Q2_AMATEUR}"][data-mode="auto"]`).first().click();
    await pageJerry.waitForTimeout(500);

    await expect(pageJerry.getByText(Q3_TEXT)).toBeVisible();
    await pageJerry.locator(`input.choice-radio[data-answer-text="${Q3_YES}"][data-mode="manual"]`).first().click();

    await waitForNotification(pageJerry, 'Match!', 'Jerry');
    await pageJerry.waitForSelector('#talk-response-modal', { state: 'detached', timeout: 5000 });

    // 5) Tom receives match notification
    console.log('\n📍 STEP 5: Tom receives match notification');
    await waitForNotification(pageTom, 'Match!', 'Tom');
    console.log('✅ Both Tom and Jerry received match notification');

    // 6) Jerry's Answer tab: see Tennis Partner with Match, then View My Answers shows 3 questions and his picks (Yes, amateur, Yes)
    console.log('\n📍 STEP 6: Jerry Answer tab shows talk and View My Answers shows 3 Q&A');
    await pageJerry.click('.nav-btn[data-view="answers"]');
    await pageJerry.waitForTimeout(2000);

    const answersContent = pageJerry.locator('#answers-content');
    await expect(answersContent.getByText(TALK_TITLE).first()).toBeVisible({ timeout: 5000 });
    await expect(answersContent.getByText(/Match/).first()).toBeVisible({ timeout: 5000 });
    console.log('✅ Answer tab shows Tennis Partner with Match');

    await pageJerry.getByRole('button', { name: /View My Answers/i }).click();
    await pageJerry.waitForSelector('#preferences-modal .modal-content', { timeout: 5000 });

    await expect(pageJerry.getByText(Q1_TEXT)).toBeVisible({ timeout: 5000 });
    await expect(pageJerry.getByText(Q2_TEXT)).toBeVisible({ timeout: 5000 });
    await expect(pageJerry.getByText(Q3_TEXT)).toBeVisible({ timeout: 5000 });
    // Jerry's chosen answers: Yes (Q1), amateur (Q2), Yes (Q3). Don't assert option text (hidden in closed <select>); assert select value.
    const modal = pageJerry.locator('#preferences-modal');
    const q1Preference = modal.locator('.preference-item').filter({ hasText: Q1_TEXT });
    await expect(q1Preference.locator('select.answer-select')).toHaveValue('a_0_0');
    const q2Preference = modal.locator('.preference-item').filter({ hasText: 'skill level' });
    await expect(q2Preference.locator('select.answer-select')).toHaveValue('a_1_1');
    const q3Preference = modal.locator('.preference-item').filter({ hasText: Q3_TEXT });
    await expect(q3Preference.locator('select.answer-select')).toHaveValue('a_2_0');
    console.log('✅ View My Answers shows 3 questions and Jerry’s picks: Yes, amateur, Yes');
  });
});
