/**
 * Matched-talk threads (redesign §5, T8): the User layout's messaging area lists one
 * email-style row per matched talk; each row opens a per-talk Thread page (the shared
 * Conversation component scoped by conversationId + talkId) with its own composer;
 * thread messages and DM messages never leak into each other.
 *
 * The matched conversation state is seeded through the app's own conversation
 * service (same records a real match produces); the full match round-trip itself is
 * covered by the talks-matching suites and stage2/00e.
 */
import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { maybeClearGunDatabases, injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { webAppURLStableChatroom } from '../../helpers/ports';
import { afterLoad, afterSync, afterNav } from '../../helpers/timing';

test.describe.configure({ timeout: 120_000 });

const THREAD_TALK_ID = 'talk-thread-e2e';
const THREAD_TALK_TITLE = 'Tennis Thread Talk';

test.describe('Matched-talk threads', () => {
  let browserTom: Browser;
  let browserJerry: Browser;
  let contextTom: BrowserContext | undefined;
  let contextJerry: BrowserContext | undefined;
  let pageTom: Page | undefined;
  let pageJerry: Page | undefined;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await maybeClearGunDatabases();
    browserTom = await chromium.launch();
    browserJerry = await chromium.launch();
  });

  test.afterAll(async () => {
    for (const p of [pageTom, pageJerry]) {
      await p?.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup?.()).catch(() => {});
    }
    await contextTom?.close().catch(() => {});
    await contextJerry?.close().catch(() => {});
    await browserTom?.close().catch(() => {});
    await browserJerry?.close().catch(() => {});
    await maybeClearGunDatabases();
  });

  async function bootstrap(browser: Browser, stageName: string): Promise<{ context: BrowserContext; page: Page }> {
    const context = await browser.newContext();
    const page = await context.newPage();
    await injectIdbClear(page);
    await gotoWebApp(page, webAppURLStableChatroom());
    await afterLoad();
    await page.click('.nav-btn[data-view="settings"]');
    await afterNav();
    await page.fill('#settings-stage-name-input', stageName);
    await page.locator('#settings-stage-name-input').blur();
    await afterNav();
    await page.click('.nav-btn[data-view="chatrooms"]');
    await afterNav();
    await page.click('.chatroom-item:has-text("Global")');
    await afterSync();
    return { context, page };
  }

  /** Seed the matched-talk conversation on a page via the app's own services. */
  async function seedMatchedConversation(page: Page, otherId: string, otherName: string): Promise<string> {
    return page.evaluate(async ({ otherId, otherName, talkId, talkTitle }) => {
      const app = (window as any).__iinpublic_app.getApp();
      const me = app.currentUser;
      const conversationId = await app.conversationService.createConversation({
        userId1: me.id,
        userName1: me.stageName,
        userId2: otherId,
        userName2: otherName,
        talkId,
      });
      app.uiManager.addNewConversation({
        conversationId,
        otherUserId: otherId,
        otherUserName: otherName,
        talkId,
      });
      // Local myTalks entry so the thread row shows the talk title.
      const myTalks = JSON.parse(localStorage.getItem('myTalks') || '{}');
      myTalks[talkId] = { role: 'created', title: talkTitle, fullTalk: { id: talkId, title: talkTitle } };
      localStorage.setItem('myTalks', JSON.stringify(myTalks));
      return conversationId as string;
    }, { otherId, otherName, talkId: THREAD_TALK_ID, talkTitle: THREAD_TALK_TITLE });
  }

  test('thread rows per matched talk; open/reply/back; isolation from DM', async () => {
    ({ context: contextTom, page: pageTom } = await bootstrap(browserTom, 'TomThread'));
    ({ context: contextJerry, page: pageJerry } = await bootstrap(browserJerry, 'JerryThread'));
    const tom = pageTom!;
    const jerry = pageJerry!;

    const tomId = await tom.evaluate(() => (window as any).__iinpublic_app.getApp().currentUser.id);
    const jerryId = await jerry.evaluate(() => (window as any).__iinpublic_app.getApp().currentUser.id);

    const tomConvId = await seedMatchedConversation(tom, jerryId, 'JerryThread');
    const jerryConvId = await seedMatchedConversation(jerry, tomId, 'TomThread');
    expect(tomConvId).toBe(jerryConvId);

    // ── Tom: User layout shows one email-style row for the matched talk ──────
    await tom.waitForSelector('.chatroom-member-item', { timeout: 20_000 });
    const jerryRow = tom.locator('.chatroom-member-item').filter({ hasText: 'JerryThread' }).first();
    await expect(jerryRow).toBeVisible({ timeout: 15_000 });
    await jerryRow.click();
    await expect(tom.locator('#conversation-detail-overlay')).toBeVisible({ timeout: 15_000 });
    await tom.click('#back-from-conversation');

    const threadRow = tom.locator('[data-testid="matched-talk-thread"]');
    await expect(threadRow).toHaveCount(1);
    await expect(threadRow).toContainText(THREAD_TALK_TITLE);
    await expect(tom.locator('[data-testid="dm-thread-entry"]')).toBeVisible();

    // ── Open the Thread page: scoped conversation with its own composer ──────
    await threadRow.click();
    await expect(tom.locator('#conversation-detail-overlay')).toBeVisible();
    await expect(tom.locator('#conversation-thread-scope')).toBeVisible();
    await expect(tom.locator('#conversation-thread-scope')).toContainText(THREAD_TALK_TITLE);

    const threadReply = `thread reply ${Date.now()}`;
    await tom.locator('#conversation-message-input').fill(threadReply);
    await tom.locator('#send-conversation-message').click();
    await expect(tom.locator('#conversation-messages')).toContainText(threadReply, { timeout: 20_000 });

    // Back from the Thread returns to the User layout; the row snippet updated.
    await tom.click('#back-from-conversation');
    await expect(tom.locator('#peer-detail-overlay')).toBeVisible();
    await expect(tom.locator('[data-testid="matched-talk-thread"]')).toContainText(threadReply.slice(0, 20));

    // ── DM isolation on the sender side: DM thread shows no thread messages ──
    await tom.locator('[data-testid="dm-thread-entry"]').click();
    await expect(tom.locator('#conversation-detail-overlay')).toBeVisible();
    await expect(tom.locator('#conversation-thread-scope')).toBeHidden();
    await expect(tom.locator('#conversation-messages')).not.toContainText(threadReply);
    const dmText = `dm text ${Date.now()}`;
    await tom.locator('#conversation-message-input').fill(dmText);
    await tom.locator('#send-conversation-message').click();
    await expect(tom.locator('#conversation-messages')).toContainText(dmText, { timeout: 20_000 });
    await tom.click('#back-from-conversation');

    // ── Receiver side (contact entry): thread reply lands in the thread, not the DM ──
    await jerry.click('.nav-btn[data-view="contacts"]');
    await afterSync();
    const tomRow = jerry.locator('#contacts-list .contact-item').filter({ hasText: 'TomThread' }).first();
    await expect(tomRow).toBeVisible({ timeout: 20_000 });
    await tomRow.click();
    await expect(jerry.locator('#conversation-detail-overlay')).toBeVisible({ timeout: 15_000 });
    // DM view shows the DM text only — never the thread reply.
    await expect(jerry.locator('#conversation-messages')).toContainText(dmText, { timeout: 30_000 });
    await expect(jerry.locator('#conversation-messages')).not.toContainText(threadReply);
    await jerry.click('#back-from-conversation');

    const jerryThreadRow = jerry.locator('[data-testid="matched-talk-thread"]');
    await expect(jerryThreadRow).toHaveCount(1);
    await jerryThreadRow.click();
    await expect(jerry.locator('#conversation-thread-scope')).toBeVisible();
    await expect(jerry.locator('#conversation-messages')).toContainText(threadReply, { timeout: 30_000 });
    await expect(jerry.locator('#conversation-messages')).not.toContainText(dmText);
  });
});
