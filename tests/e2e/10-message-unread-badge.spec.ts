/**
 * Unread badge lifecycle on the Me tab:
 * 1. A new match immediately marks the conversation unread → badge on Me nav.
 * 2. Opening the conversation clears the badge.
 * 3. A new message arriving while the overlay is closed marks it unread again.
 * 4. Opening the conversation clears the badge once more.
 */
import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from './helpers/fixtures';
import { clearGunDatabases, injectIdbClear } from './helpers/clear-database';
import { ensureWindowFitsViewport } from './helpers/browser-window';
import { afterLoad, afterSync, afterNav, afterAction, delay, headless } from './helpers/timing';
import { webAppURLStableChatroom } from './helpers/ports';
import { openIncomingTalkModal, waitForResponseModalClosed } from './helpers/talks-matching-flow';

test.describe('Unread badge on Me tab after match and new message', () => {
  let browserTom: Browser;
  let browserJerry: Browser;
  let contextTom: BrowserContext;
  let contextJerry: BrowserContext;
  let pageTom: Page;
  let pageJerry: Page;

  const TALK_TITLE = 'E2E Unread Badge Tennis';
  const MATCH_ANSWER = 'Yes, lets play.';
  const IGNORE_ANSWER = 'No thanks.';
  const TOM_MESSAGE_1 = 'Hey Jerry, first message!';

  test.setTimeout(180_000);

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunDatabases();
    browserTom = await chromium.launch({
      headless,
      slowMo: headless ? 0 : delay(50, 120),
      args: ['--window-position=0,0', '--window-size=640,1200', '--force-device-scale-factor=1'],
    });
    browserJerry = await chromium.launch({
      headless,
      slowMo: headless ? 0 : delay(50, 120),
      args: ['--window-position=640,0', '--window-size=640,1200', '--force-device-scale-factor=1'],
    });
  });

  test.afterAll(async () => {
    const cleanup = async (p?: Page) => {
      if (!p) return;
      try {
        await p.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup());
      } catch { }
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
    await page.goto(webAppURLStableChatroom());
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

  test('Unread badge appears after match, clears on open; reappears after new message, clears on open', async () => {
    // ── Bootstrap ────────────────────────────────────────────────────────────
    const tom = await bootstrapUser(browserTom, 'Tom', 'Tom');
    contextTom = tom.context;
    pageTom = tom.page;
    await pageTom.click('.chatroom-item:has-text("Global")');
    await afterSync();

    const jerry = await bootstrapUser(browserJerry, 'Jerry', 'Jerry');
    contextJerry = jerry.context;
    pageJerry = jerry.page;
    await pageJerry.click('.chatroom-item:has-text("Global")');
    await afterSync();

    // ── Tom creates and broadcasts ───────────────────────────────────────────
    await pageTom.click('#create-talk-btn');
    await pageTom.waitForSelector('#talk-editor-form');
    await pageTom.fill('#talk-title', TALK_TITLE);
    await pageTom.selectOption('#talk-type', 'flow');
    const q = pageTom.locator('.question-item').first();
    await q.locator('.question-text').fill('Want a tennis partner?');
    await q.locator('.answer-item').nth(0).locator('.answer-text').fill(MATCH_ANSWER);
    await q.locator('.answer-item').nth(0).locator('.answer-next').selectOption('noticed');
    await q.locator('.answer-item').nth(1).locator('.answer-text').fill(IGNORE_ANSWER);
    await q.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');
    await pageTom.click('#talk-editor-form button[type="submit"]');
    await afterSync();
    await pageTom.click('#broadcast-talk-btn');
    await afterAction();
    await afterSync();

    // ── Jerry matches ────────────────────────────────────────────────────────
    await openIncomingTalkModal(pageJerry, TALK_TITLE);
    await pageJerry
      .locator(`input.choice-radio[data-answer-text="${MATCH_ANSWER}"][data-mode="manual"]`)
      .first()
      .click();
    await expect(pageJerry.getByText('Match!').first()).toBeVisible({ timeout: 15000 });
    await waitForResponseModalClosed(pageJerry);
    await afterSync();

    // ── Phase 1: unread badge appears for Jerry immediately after new match ──
    // The new conversation is created with unread=true; the Me nav button should show a badge.
    // Jerry is currently on the Talks tab — navigate to Me without opening the conversation.
    await pageJerry.click('.nav-btn[data-view="me"]');
    await afterNav();

    const meNavJerry = pageJerry.locator('.nav-btn[data-view="me"]');
    // Wait for the notification badge first: this confirms addNewConversation() has fired and
    // the conversation is in localStorage. The badge is updated directly by updateMatchBadge();
    // the conversation list itself only re-renders on the next displayConversationsList() call.
    await expect(meNavJerry.locator('.notification-badge')).toBeVisible({ timeout: 15000 });

    // Re-navigate to Me so displayConversationsList() runs again with the latest localStorage state.
    // (addNewConversation does not call displayConversationsList when the user is already on Me.)
    await pageJerry.click('.nav-btn[data-view="chatrooms"]');
    await afterNav();
    await pageJerry.click('.nav-btn[data-view="me"]');
    await afterNav();

    // The conversation-list-item should carry the .unread class and .unread-badge element
    const convItemJerry = pageJerry
      .locator('.conversation-list-item')
      .filter({ hasText: 'Tom' })
      .first();
    await expect(convItemJerry).toBeVisible({ timeout: 15000 });
    await expect(convItemJerry.locator('.unread-badge')).toBeVisible({ timeout: 5000 });

    // ── Phase 2: opening the conversation clears the badge ───────────────────
    await convItemJerry.click();
    await expect(pageJerry.locator('#conversation-detail-overlay')).toBeVisible({ timeout: 10000 });
    await afterSync();

    // Navigate away to trigger Me-tab re-render with updated state
    await pageJerry.click('#back-from-conversation');
    await afterAction();

    await expect(meNavJerry.locator('.notification-badge')).not.toBeVisible({ timeout: 10000 });

    // ── Phase 3: Tom sends a message while Jerry's overlay is closed ─────────
    // Tom opens conversation first
    await pageTom.click('.nav-btn[data-view="me"]');
    await afterNav();
    await expect(
      pageTom.locator('.conversation-list-item').filter({ hasText: 'Jerry' }).first(),
    ).toBeVisible({ timeout: 20000 });
    await pageTom.locator('.conversation-list-item').filter({ hasText: 'Jerry' }).first().click();
    await expect(pageTom.locator('#conversation-detail-overlay')).toBeVisible({ timeout: 10000 });

    const tomInput = pageTom.locator('#conversation-message-input');
    await expect(tomInput).toBeVisible({ timeout: 10000 });
    await tomInput.fill(TOM_MESSAGE_1);
    await afterAction();
    await pageTom.click('#send-conversation-message');
    await afterSync();

    // ── Phase 4: Jerry's badge reappears for the new incoming message ────────
    // Jerry is on the Me tab but conversation overlay is closed.
    await expect
      .poll(
        async () => meNavJerry.locator('.notification-badge').isVisible().catch(() => false),
        { message: "Jerry's unread badge should reappear after Tom's message", timeout: 30000 },
      )
      .toBe(true);

    // The conversation item also shows unread-badge again
    await expect(convItemJerry.locator('.unread-badge')).toBeVisible({ timeout: 10000 });

    // ── Phase 5: Jerry opens conversation — badge clears ─────────────────────
    await convItemJerry.click();
    await expect(pageJerry.locator('#conversation-detail-overlay')).toBeVisible({ timeout: 10000 });
    // Verify Tom's message arrived
    await expect
      .poll(
        async () =>
          pageJerry
            .locator('#conversation-messages .message-text')
            .filter({ hasText: TOM_MESSAGE_1 })
            .first()
            .isVisible()
            .catch(() => false),
        { message: "Jerry should see Tom's message", timeout: 30000 },
      )
      .toBe(true);

    await pageJerry.click('#back-from-conversation');
    await afterAction();
    await expect(meNavJerry.locator('.notification-badge')).not.toBeVisible({ timeout: 10000 });
  });
});
