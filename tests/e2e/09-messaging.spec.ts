import { test, expect, chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { clearGunDatabases, injectIdbClear } from './helpers/clear-database';
import { ensureWindowFitsViewport } from './helpers/browser-window';
import { afterLoad, afterSync, afterNav, afterAction, delay, headless } from './helpers/timing';
import { openIncomingTalkModal, waitForResponseModalClosed } from './helpers/talks-matching-flow';

test.describe('Direct messaging between matched users', () => {
  let browserTom: Browser;
  let browserJerry: Browser;
  let contextTom: BrowserContext;
  let contextJerry: BrowserContext;
  let pageTom: Page;
  let pageJerry: Page;

  const TALK_TITLE = 'Tennis Partner';
  const MATCH_ANSWER = 'Yes, lets play.';
  const IGNORE_ANSWER = 'No thanks.';
  const TOM_MESSAGE = 'Hey Jerry, want to play tennis tomorrow?';
  const JERRY_REPLY = 'Sounds great! Meet at the courts at 9am?';

  test.setTimeout(120_000);

  test.beforeAll(async () => {
    await clearGunDatabases();
    browserTom = await chromium.launch({
      headless,
      slowMo: delay(50, 120),
      args: ['--window-position=0,0', '--window-size=640,1200', '--force-device-scale-factor=1'],
    });
    browserJerry = await chromium.launch({
      headless,
      slowMo: delay(50, 120),
      args: ['--window-position=640,0', '--window-size=640,1200', '--force-device-scale-factor=1'],
    });
  });

  test.afterAll(async () => {
    const cleanup = async (p?: Page) => {
      if (!p) return;
      try {
        await p.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup());
      } catch {}
    };
    await cleanup(pageTom);
    await cleanup(pageJerry);
    await pageTom?.close();
    await pageJerry?.close();
    await contextTom?.close();
    await contextJerry?.close();
    await browserTom?.close();
    await browserJerry?.close();
    await clearGunDatabases();
  });

  async function bootstrapUser(
    browser: Browser,
    label: string,
    stageName: string,
  ): Promise<{ context: BrowserContext; page: Page }> {
    const context = await browser.newContext({ viewport: { width: 640, height: 1000 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on('console', (m) => console.log(`[${label}]:`, m.text()));
    await injectIdbClear(page);
    await page.goto('/');
    await page.waitForLoadState('load');
    await ensureWindowFitsViewport(page, 640, 1000);
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
    return { context, page };
  }

  test('Tom and Jerry match on talk, then Tom sends message to Jerry and receives reply', async () => {
    // Bootstrap Tom
    const tom = await bootstrapUser(browserTom, 'Tom', 'Tom');
    contextTom = tom.context;
    pageTom = tom.page;
    await pageTom.click('.chatroom-item:has-text("Global")');
    await afterSync();

    // Bootstrap Jerry
    const jerry = await bootstrapUser(browserJerry, 'Jerry', 'Jerry');
    contextJerry = jerry.context;
    pageJerry = jerry.page;
    await pageJerry.click('.chatroom-item:has-text("Global")');
    await afterSync();

    // Tom creates a matching talk "Tennis Partner"
    await pageTom.click('#create-talk-btn');
    await pageTom.waitForSelector('#talk-editor-form');
    await pageTom.fill('#talk-title', TALK_TITLE);
    await pageTom.selectOption('#talk-type', 'matching');
    const q = pageTom.locator('.question-item').first();
    await q.locator('.question-text').fill('Want a tennis partner?');
    await q.locator('.answer-item').nth(0).locator('.answer-text').fill(MATCH_ANSWER);
    await q.locator('.answer-item').nth(0).locator('.answer-next').selectOption('noticed');
    await q.locator('.answer-item').nth(1).locator('.answer-text').fill(IGNORE_ANSWER);
    await q.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');
    await pageTom.click('#talk-editor-form button[type="submit"]');
    await afterSync();

    // Tom broadcasts the talk
    await pageTom.click('#broadcast-talk-btn');
    await afterAction();
    await afterSync();

    // Jerry answers the match
    await openIncomingTalkModal(pageJerry, TALK_TITLE);
    await pageJerry
      .locator(`input.choice-radio[data-answer-text="${MATCH_ANSWER}"][data-mode="manual"]`)
      .first()
      .click();
    await expect(pageJerry.getByText('Match!').first()).toBeVisible({ timeout: 15000 });
    await waitForResponseModalClosed(pageJerry);
    await afterSync();

    // Tom should see match toast too
    await expect(pageTom.getByText('Match!').first()).toBeVisible({ timeout: 15000 });
    await afterSync();

    // Tom navigates to Contacts tab
    await pageTom.click('.nav-btn[data-view="contacts"]');
    await afterAction();
    await expect(pageTom.locator('#contacts-list .contact-item')).toHaveCount(1, { timeout: 15000 });

    // Tom clicks on Jerry's contact
    await pageTom.locator('.contact-item').filter({ hasText: 'Jerry' }).first().click();
    await afterNav();
    await expect(pageTom.locator('#contact-detail-name')).toContainText('Jerry', { timeout: 10000 });

    // Tom clicks the Message button on Jerry's contact detail
    // Try multiple selectors to find the message button
    let messageBtn = pageTom.locator('#message-btn').first();
    if (!(await messageBtn.isVisible().catch(() => false))) {
      messageBtn = pageTom.locator('.message-btn').first();
    }
    if (!(await messageBtn.isVisible().catch(() => false))) {
      messageBtn = pageTom.locator('[data-testid="message-btn"]').first();
    }
    await expect(messageBtn).toBeVisible({ timeout: 10000 });
    await messageBtn.click();
    await afterNav();

    // Tom types and sends a message
    let messageInput = pageTom.locator('#message-input').first();
    if (!(await messageInput.isVisible().catch(() => false))) {
      messageInput = pageTom.locator('.message-input').first();
    }
    if (!(await messageInput.isVisible().catch(() => false))) {
      messageInput = pageTom.locator('#conversation-input').first();
    }
    await expect(messageInput).toBeVisible({ timeout: 10000 });
    await messageInput.fill(TOM_MESSAGE);
    await afterAction();

    let sendBtn = pageTom.locator('#send-message-btn').first();
    if (!(await sendBtn.isVisible().catch(() => false))) {
      sendBtn = pageTom.locator('.send-message-btn').first();
    }
    await expect(sendBtn).toBeVisible({ timeout: 5000 });
    await sendBtn.click();
    await afterSync();

    // Verify Tom's message appears in his conversation view
    await expect(
      pageTom.locator('.message-item, .message-bubble, .chat-message').filter({ hasText: TOM_MESSAGE }).first(),
    ).toBeVisible({ timeout: 10000 });

    // Jerry navigates to Me tab or Conversations to see the message
    await pageJerry.click('.nav-btn[data-view="me"]');
    await afterNav();

    // Check for message in Me tab or look for Conversations section
    let jerryMessageVisible = await pageJerry
      .locator('.message-item, .message-bubble, .chat-message')
      .filter({ hasText: TOM_MESSAGE })
      .first()
      .isVisible()
      .catch(() => false);

    if (!jerryMessageVisible) {
      // Try clicking on Conversations if Me tab doesn't show it
      const conversationLink = pageJerry.locator('[data-view="conversations"], #conversations-tab, .conversations-link').first();
      if (await conversationLink.isVisible().catch(() => false)) {
        await conversationLink.click();
        await afterNav();
      }
    }

    // Wait for Tom's message to appear to Jerry
    await expect
      .poll(
        async () => {
          const found = await pageJerry
            .locator('.message-item, .message-bubble, .chat-message')
            .filter({ hasText: TOM_MESSAGE })
            .first()
            .isVisible()
            .catch(() => false);
          return found ? 'found' : 'not found';
        },
        { message: 'Jerry should see Tom\'s message', timeout: 30000 },
      )
      .toBe('found');

    // Jerry replies to Tom
    let jerryMessageInput = pageJerry.locator('#message-input').first();
    if (!(await jerryMessageInput.isVisible().catch(() => false))) {
      jerryMessageInput = pageJerry.locator('.message-input').first();
    }
    if (!(await jerryMessageInput.isVisible().catch(() => false))) {
      jerryMessageInput = pageJerry.locator('#conversation-input').first();
    }
    await expect(jerryMessageInput).toBeVisible({ timeout: 10000 });
    await jerryMessageInput.fill(JERRY_REPLY);
    await afterAction();

    let jerrySendBtn = pageJerry.locator('#send-message-btn').first();
    if (!(await jerrySendBtn.isVisible().catch(() => false))) {
      jerrySendBtn = pageJerry.locator('.send-message-btn').first();
    }
    await expect(jerrySendBtn).toBeVisible({ timeout: 5000 });
    await jerrySendBtn.click();
    await afterSync();

    // Verify Jerry's message appears in his conversation view
    await expect(
      pageJerry.locator('.message-item, .message-bubble, .chat-message').filter({ hasText: JERRY_REPLY }).first(),
    ).toBeVisible({ timeout: 10000 });

    // Tom should see Jerry's reply
    await expect
      .poll(
        async () => {
          const found = await pageTom
            .locator('.message-item, .message-bubble, .chat-message')
            .filter({ hasText: JERRY_REPLY })
            .first()
            .isVisible()
            .catch(() => false);
          return found ? 'found' : 'not found';
        },
        { message: 'Tom should see Jerry\'s reply', timeout: 30000 },
      )
      .toBe('found');
  });
});
