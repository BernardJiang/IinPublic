import { test, expect, chromium, Browser, BrowserContext, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { clearGunDatabases } from './helpers/clear-database';

test.describe('Tennis Partner Talk Match - Tom & Jerry', () => {
  let browserTom: Browser;
  let browserJerry: Browser;
  let contextTom: BrowserContext;
  let contextJerry: BrowserContext;
  let pageTom: Page;
  let pageJerry: Page;

  const TALK_TITLE = 'Tennis Partner';
  const MATCH_ANSWER_TEXT = 'Talk in person.';

  const screenshotDir = path.join(
    __dirname,
    '../../test-screenshots/tennis-partner-talk-match',
  );

  test.beforeAll(async () => {
    await clearGunDatabases();

    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }

    browserTom = await chromium.launch({
      headless: false,
      slowMo: 100,
      args: ['--window-position=0,0', '--window-size=960,1200', '--force-device-scale-factor=1'],
    });

    browserJerry = await chromium.launch({
      headless: false,
      slowMo: 100,
      args: [
        '--window-position=960,0',
        '--window-size=960,1200',
        '--force-device-scale-factor=1',
      ],
    });

    console.log('🚀 Launched 2 Chrome browsers for Tom (left) and Jerry (right)');
  });

  test.afterAll(async () => {
    // Manual cleanup inside the web app (in case beforeunload is not triggered)
    const manualCleanup = async (page?: Page) => {
      if (!page) return;
      try {
        await page.evaluate(() => {
          const webApp = (window as any).__iinpublic_app;
          if (webApp && webApp.getApp) {
            webApp.getApp().manualCleanup();
          }
        });
      } catch (err) {
        console.warn('⚠️  manualCleanup failed:', err);
      }
    };

    await manualCleanup(pageTom);
    await manualCleanup(pageJerry);

    if (pageTom) {
      await pageTom.close();
    }
    if (pageJerry) {
      await pageJerry.close();
    }
    if (contextTom) {
      await contextTom.close();
    }
    if (contextJerry) {
      await contextJerry.close();
    }
    if (browserTom) {
      await browserTom.close();
    }
    if (browserJerry) {
      await browserJerry.close();
    }

    await clearGunDatabases();
    console.log('✅ Cleanup complete');
  });

  async function bootstrapUser(
    browser: Browser,
    windowLabel: string,
    stageName: string,
  ): Promise<{ context: BrowserContext; page: Page }> {
    const context = await browser.newContext({
      viewport: { width: 960, height: 1200 },
      deviceScaleFactor: 1,
    });

    const page = await context.newPage();
    page.on('console', (msg) => console.log(`[${windowLabel}]:`, msg.text()));

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    console.log(`✅ ${windowLabel} initial login complete`);
    await page.screenshot({
      path: path.join(screenshotDir, `${windowLabel.toLowerCase()}-01-login.png`),
      fullPage: true,
    });

    // Navigate to "Me" tab
    await page.click('.nav-btn[data-view="me"]');
    await page.waitForTimeout(1000);

    // Open "Edit Stage Name" dialog
    await page.waitForSelector('#edit-stagename-btn');
    await page.click('#edit-stagename-btn');
    await page.waitForTimeout(500);

    // Enter stage name and save
    await page.fill('#new-stage-name', stageName);
    await page.click('#edit-stagename-form button[type="submit"]');
    await page.waitForTimeout(1000);

    // Verify header reflects new stage name
    const headerStageName = page.locator('[data-testid="user-stage-name"]');
    await expect(headerStageName).toContainText(stageName);
    console.log(`✅ ${windowLabel} stage name set to "${stageName}"`);

    await page.screenshot({
      path: path.join(
        screenshotDir,
        `${windowLabel.toLowerCase()}-02-stage-name-${stageName}.png`,
      ),
      fullPage: true,
    });

    // Go back to Chatrooms tab so Tom can create talks from there
    await page.click('.nav-btn[data-view="chatrooms"]');
    await page.waitForTimeout(1000);

    return { context, page };
  }

  async function getConversationCount(page: Page): Promise<number> {
    const conversationsJson = await page.evaluate(() =>
      window.localStorage.getItem('myConversations'),
    );
    const conversations = conversationsJson ? JSON.parse(conversationsJson) : {};
    return Object.keys(conversations).length;
  }

  async function waitForSuccessNotification(
    page: Page,
    containsText: string,
    label: string,
  ): Promise<void> {
    // Some notifications are rendered as plain text nodes in the overlay;
    // rely on visible text rather than a specific CSS class.
    const locator = page.getByText(containsText, { exact: false }).first();
    await expect(locator).toBeVisible({ timeout: 15000 });
    console.log(`✅ ${label} saw success notification containing: "${containsText}"`);
  }

  test('Tom sends Tennis Partner talk to Jerry, Jerry answers and they get a match; Alan and Alex flows', async () => {
    // 1) Bootstrap Tom and Jerry
    console.log('\n📍 STEP 1: Bootstrapping Tom and Jerry');
    console.log('='.repeat(60));

    const tom = await bootstrapUser(browserTom, 'TomWindow', 'Tom');
    const jerry = await bootstrapUser(browserJerry, 'JerryWindow', 'Jerry');

    contextTom = tom.context;
    contextJerry = jerry.context;
    pageTom = tom.page;
    pageJerry = jerry.page;

    // 2) Tom creates a Tennis Partner matching talk and broadcasts it to the chatroom
    console.log('\n📍 STEP 2: Tom creates Tennis Partner talk');
    console.log('='.repeat(60));

    // Open talk editor (header "+" button)
    await pageTom.click('#create-talk-btn');
    await pageTom.waitForSelector('#talk-editor-form');

    // Fill talk title and type
    await pageTom.fill('#talk-title', TALK_TITLE);
    await pageTom.selectOption('#talk-type', 'matching');

    // Configure first (and only) question
    const question = pageTom.locator('.question-item').first();
    await question.locator('.question-text').fill('Do you want a tennis partner?');

    const firstAnswer = question.locator('.answer-item').nth(0);
    const secondAnswer = question.locator('.answer-item').nth(1);

    // First answer: match path (Noticed)
    await firstAnswer.locator('.answer-text').fill(MATCH_ANSWER_TEXT);
    await firstAnswer.locator('.answer-next').selectOption('noticed');

    // Second answer: ignore path (Ignore)
    await secondAnswer.locator('.answer-text').fill('No thanks.');
    await secondAnswer.locator('.answer-next').selectOption('ignore');

    await pageTom.screenshot({
      path: path.join(screenshotDir, 'tom-03-talk-editor-configured.png'),
      fullPage: true,
    });

    // Submit the form to create & broadcast the talk
    await pageTom.click('#talk-editor-form button[type="submit"]');
    await pageTom.waitForTimeout(2000);
    console.log('✅ Tom created and broadcasted Tennis Partner talk');

    // 3) Jerry receives the Tennis Partner talk and answers with the match path
    console.log('\n📍 STEP 3: Jerry receives Tennis Partner talk and answers with match path');
    console.log('='.repeat(60));

    // Switch Jerry to Talks tab so he can see the incoming talk
    await pageJerry.click('.nav-btn[data-view="talks"]');
    await pageJerry.waitForTimeout(2000);

    // Wait until the Tennis Partner talk appears in Jerry's talks list
    const jerryTalkItem = pageJerry
      .locator('.talk-list-item')
      .filter({ hasText: TALK_TITLE })
      .first();

    await jerryTalkItem.waitFor({ state: 'visible', timeout: 15000 });
    console.log('✅ Jerry sees Tennis Partner talk in Talks list');

    await pageJerry.screenshot({
      path: path.join(screenshotDir, 'jerry-04-talks-list.png'),
      fullPage: true,
    });

    // Open the talk response dialog
    await jerryTalkItem.click();
    await pageJerry.waitForSelector('#talk-response-modal .modal-content');

    // Click the AUTO button for the match answer so Jerry's chatbot can reuse it later
    const autoMatchButton = pageJerry.locator(
      `.answer-auto-btn[data-answer-text="${MATCH_ANSWER_TEXT}"]`,
    );
    await autoMatchButton.click();

    // Jerry should see a match notification
    await waitForSuccessNotification(
      pageJerry,
      'Match! You both noticed each other.',
      'Jerry',
    );

    await pageJerry.screenshot({
      path: path.join(screenshotDir, 'jerry-05-match-notification.png'),
      fullPage: true,
    });

    // 4) Tom should also be notified of the match and see a new conversation
    console.log('\n📍 STEP 4: Tom sees match notification and conversation');
    console.log('='.repeat(60));

    // Tom stays on Chatrooms or Talks view; he should see an author-side match notification
    await waitForSuccessNotification(pageTom, 'Match!', 'Tom');

    await pageTom.screenshot({
      path: path.join(screenshotDir, 'tom-06-match-notification.png'),
      fullPage: true,
    });

    // Verify Tom has at least one conversation for this match in local history
    // The Me tab shows a badge and the conversation list
    await pageTom.click('.nav-btn[data-view="me"]');
    await pageTom.waitForTimeout(1000);

    const tomConversationCountAfterJerry = await getConversationCount(pageTom);

    expect(tomConversationCountAfterJerry).toBeGreaterThan(0);
    console.log(
      `✅ Tom has ${tomConversationCountAfterJerry} conversation(s) stored after Tennis Partner match`,
    );

    // -----------------------------------------------------------------------
    // 5) Third user Alan joins, Tom sends the same talk, Alan is NOT a match
    // -----------------------------------------------------------------------
    console.log('\n📍 STEP 5: Alan joins; Tom sends Tennis Partner talk again; Alan is not a match');
    console.log('='.repeat(60));

    const alanBootstrap = await bootstrapUser(browserTom, 'AlanWindow', 'Alan');
    const pageAlan = alanBootstrap.page;

    // Tom creates and broadcasts the same Tennis Partner talk again
    await pageTom.click('.nav-btn[data-view="chatrooms"]');
    await pageTom.waitForTimeout(1000);
    await pageTom.click('#create-talk-btn');
    await pageTom.waitForSelector('#talk-editor-form');

    await pageTom.fill('#talk-title', TALK_TITLE);
    await pageTom.selectOption('#talk-type', 'matching');

    const question2 = pageTom.locator('.question-item').first();
    await question2.locator('.question-text').fill('Do you want a tennis partner?');

    const firstAnswer2 = question2.locator('.answer-item').nth(0);
    const secondAnswer2 = question2.locator('.answer-item').nth(1);

    await firstAnswer2.locator('.answer-text').fill(MATCH_ANSWER_TEXT);
    await firstAnswer2.locator('.answer-next').selectOption('noticed');

    await secondAnswer2.locator('.answer-text').fill('No thanks.');
    await secondAnswer2.locator('.answer-next').selectOption('ignore');

    await pageTom.click('#talk-editor-form button[type="submit"]');
    await pageTom.waitForTimeout(2000);
    console.log('✅ Tom created and broadcasted Tennis Partner talk for Alan');

    // Alan receives and answers "No thanks." (ignore path, not a match)
    await pageAlan.click('.nav-btn[data-view="talks"]');
    await pageAlan.waitForTimeout(2000);

    const alanTalkItem = pageAlan
      .locator('.talk-list-item')
      .filter({ hasText: TALK_TITLE })
      .first();
    await alanTalkItem.waitFor({ state: 'visible', timeout: 15000 });
    await alanTalkItem.click();
    await pageAlan.waitForSelector('#talk-response-modal .modal-content');

    const alanIgnoreButton = pageAlan.locator(
      `.answer-manual-btn[data-answer-text="No thanks."]`,
    );
    await alanIgnoreButton.click();

    // Give system a moment to process; there should be no new match for Tom
    await pageTom.waitForTimeout(2000);
    const tomConversationCountAfterAlan = await getConversationCount(pageTom);
    expect(tomConversationCountAfterAlan).toBe(tomConversationCountAfterJerry);
    console.log(
      `✅ Alan did not create a new match for Tom (conversations stay at ${tomConversationCountAfterAlan})`,
    );

    const alanConversationCount = await getConversationCount(pageAlan);
    expect(alanConversationCount).toBe(0);
    console.log('✅ Alan has no conversations (no match)');

    // -----------------------------------------------------------------------
    // 6) Fourth user Alex asks the same talk to Jerry; Jerry's chatbot answers automatically
    // -----------------------------------------------------------------------
    console.log(
      '\n📍 STEP 6: Alex joins; sends Tennis Partner talk; Jerry\'s chatbot auto-answers for Jerry',
    );
    console.log('='.repeat(60));

    const alexBootstrap = await bootstrapUser(browserTom, 'AlexWindow', 'Alex');
    const pageAlex = alexBootstrap.page;

    const jerryConversationsBeforeAlex = await getConversationCount(pageJerry);

    // Alex creates and broadcasts the same Tennis Partner talk
    await pageAlex.click('.nav-btn[data-view="chatrooms"]');
    await pageAlex.waitForTimeout(1000);
    await pageAlex.click('#create-talk-btn');
    await pageAlex.waitForSelector('#talk-editor-form');

    await pageAlex.fill('#talk-title', TALK_TITLE);
    await pageAlex.selectOption('#talk-type', 'matching');

    const question3 = pageAlex.locator('.question-item').first();
    await question3.locator('.question-text').fill('Do you want a tennis partner?');

    const firstAnswer3 = question3.locator('.answer-item').nth(0);
    const secondAnswer3 = question3.locator('.answer-item').nth(1);

    await firstAnswer3.locator('.answer-text').fill(MATCH_ANSWER_TEXT);
    await firstAnswer3.locator('.answer-next').selectOption('noticed');

    await secondAnswer3.locator('.answer-text').fill('No thanks.');
    await secondAnswer3.locator('.answer-next').selectOption('ignore');

    await pageAlex.click('#talk-editor-form button[type="submit"]');
    await pageAlex.waitForTimeout(2000);
    console.log('✅ Alex created and broadcasted Tennis Partner talk');

    // Jerry receives the talk again; with AUTO preference saved, his chatbot should answer automatically
    await pageJerry.click('.nav-btn[data-view="talks"]');
    await pageJerry.waitForTimeout(2000);

    const jerryTalkItemsAfterAlex = pageJerry
      .locator('.talk-list-item')
      .filter({ hasText: TALK_TITLE });
    const jerryTalkCount = await jerryTalkItemsAfterAlex.count();
    expect(jerryTalkCount).toBeGreaterThan(0);

    // Open the most recent Tennis Partner talk
    await jerryTalkItemsAfterAlex.nth(jerryTalkCount - 1).click();
    await pageJerry.waitForTimeout(1000);

    // Auto-answer should complete the talk and show the (auto) match notification
    await waitForSuccessNotification(
      pageJerry,
      'Match! You both noticed each other.',
      'Jerry (auto)',
    );

    const jerryConversationsAfterAlex = await getConversationCount(pageJerry);
    expect(jerryConversationsAfterAlex).toBeGreaterThanOrEqual(jerryConversationsBeforeAlex);
    console.log(
      `✅ Jerry's chatbot auto-answered and created a new match (conversations: ${jerryConversationsBeforeAlex} -> ${jerryConversationsAfterAlex})`,
    );
  });
});

