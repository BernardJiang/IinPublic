/**
 * Unread badge lifecycle:
 * 1. A new match immediately marks the conversation unread → badge on Me nav.
 * 2. Opening the conversation clears the badge.
 * 3. A new message arriving while the overlay is closed marks it unread again.
 * 4. Opening the conversation clears the badge once more.
 */
import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { selectTalkEditorType } from '../../helpers/talk-editor-e2e';
import { injectIdbClear } from '../../helpers/clear-database';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { ensureWindowFitsViewport } from '../../helpers/browser-window';
import { afterLoad, afterSync, afterNav, afterAction, delay, headless } from '../../helpers/timing';
import { gunBaseURL, webAppURLStableChatroom } from '../../helpers/ports';
import { openIncomingTalkModal, waitForResponseModalClosed } from '../../helpers/talks-matching-flow';
import {
  clickBroadcastUntilBulkAck,
  waitForBroadcastableTalkIds,
  waitForDistinctGunPeersExcludingSelf,
} from '../../helpers/talk-demo-ui';
import { attachE2eBrowserTabLabel } from '../../helpers/e2e-tab-title';

test.describe('Unread badge on Me tab after match and new message', () => {
  let browserTom: Browser;
  let browserJerry: Browser;
  let contextTom: BrowserContext;
  let contextJerry: BrowserContext;
  let pageTom: Page;
  let pageJerry: Page;

  const MATCH_ANSWER = 'Yes, lets play.';
  const IGNORE_ANSWER = 'No thanks.';
  const TOM_MESSAGE_1 = 'Hey Jerry, first message!';

  test.setTimeout(420_000);

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage2Spec();
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
    await clearGunForStage2Spec();
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
    await page.click('.nav-btn[data-view="settings"]');
    await afterNav();
    await page.waitForSelector('#settings-stage-name-input');
    await page.fill('#settings-stage-name-input', stageName);
    await page.locator('#settings-stage-name-input').blur();
    await afterNav();
    await page.click('.nav-btn[data-view="chatrooms"]');
    await afterNav();
    attachE2eBrowserTabLabel(page, label);
    return { context, page };
  }

  async function waitForConversationEntry(page: Page, otherUserId: string): Promise<void> {
    await expect
      .poll(
        async () => {
          return page.evaluate((id: string) => {
            const raw = localStorage.getItem('myConversations');
            const conversations = raw ? JSON.parse(raw) : {};
            return Object.values(conversations).some((v: any) => v?.otherUserId === id);
          }, otherUserId);
        },
        { timeout: 120_000, message: `Conversation entry for ${otherUserId} should appear` },
      )
      .toBe(true);
  }

  async function openConversationByOtherUserId(page: Page, otherUserId: string): Promise<void> {
    await waitForConversationEntry(page, otherUserId);
    await page.evaluate((id: string) => {
      const app = (window as any).__iinpublic_app?.getApp?.();
      const conversations = JSON.parse(localStorage.getItem('myConversations') || '{}');
      const entry = Object.entries(conversations).find(([, conversation]: any) => conversation?.otherUserId === id);
      if (!entry) throw new Error(`Conversation entry missing for ${id}`);
      app?.uiManager?.showConversationDetail?.(entry[0]);
    }, otherUserId);
    await expect(page.locator('#conversation-detail-overlay')).toBeVisible({ timeout: 20_000 });
    await afterSync();
  }

  async function expectConversationUnread(page: Page, otherUserId: string, expected: boolean): Promise<void> {
    await expect
      .poll(
        async () =>
          page.evaluate((id: string) => {
            const conversations = JSON.parse(localStorage.getItem('myConversations') || '{}');
            const entry = Object.values(conversations).find((conversation: any) => conversation?.otherUserId === id);
            return !!(entry as any)?.unread;
          }, otherUserId),
        { timeout: 30_000 },
      )
      .toBe(expected);
  }

  test('Unread badge appears after match, clears on open; reappears after new message, clears on open', async () => {
    const talkTitle = `E2E Unread Badge Tennis ${Date.now()}`;
    // ── Bootstrap ────────────────────────────────────────────────────────────
    const tom = await bootstrapUser(browserTom, 'Tom', 'Tom');
    contextTom = tom.context;
    pageTom = tom.page;
    const tomUserId = await pageTom.evaluate(
      () =>
        String(
          (window as unknown as { __iinpublic_app?: { getApp: () => { currentUser?: { id: string } } } }).__iinpublic_app?.getApp?.()?.currentUser?.id ||
            '',
        ),
    );
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
    await pageTom.fill('#talk-title', talkTitle);
    await selectTalkEditorType(pageTom, 'flow');
    const q = pageTom.locator('.question-item').first();
    await q.locator('.question-text').fill('Want a tennis partner?');
    await q.locator('.answer-item').nth(0).locator('.answer-text').fill(MATCH_ANSWER);
    await q.locator('.answer-item').nth(0).locator('.answer-next').selectOption('noticed');
    await q.locator('.answer-item').nth(1).locator('.answer-text').fill(IGNORE_ANSWER);
    await q.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');
    await pageTom.click('#talk-editor-form button[type="submit"]');
    await afterSync();
    await pageTom.click('.nav-btn[data-view="chatrooms"]');
    await afterAction();
    await pageTom.click('.chatroom-item:has-text("Global")');
    await afterNav();
    await waitForBroadcastableTalkIds(pageTom, 120_000);
    await waitForDistinctGunPeersExcludingSelf(pageTom, 1, 240_000);
    await clickBroadcastUntilBulkAck(pageTom);
    await afterSync();

    const jerryUserId = await pageJerry.evaluate(
      () =>
        String(
          (window as unknown as { __iinpublic_app?: { getApp: () => { currentUser?: { id: string } } } }).__iinpublic_app?.getApp?.()?.currentUser?.id ||
            '',
        ),
    );
    await expect
      .poll(
        async () => {
          const res = await pageTom.request.get(
            `${gunBaseURL()}/api/users/${encodeURIComponent(jerryUserId)}/incoming-talks`,
          );
          if (!res.ok()) return 0;
          return (await res.json() as unknown[]).length;
        },
        { message: 'Jerry should have incoming talks after broadcast', timeout: 120_000 },
      )
      .toBeGreaterThanOrEqual(1);

    // ── Jerry matches ────────────────────────────────────────────────────────
    await openIncomingTalkModal(pageJerry, talkTitle);
    await pageJerry
      .locator(`input.choice-radio[data-answer-text="${MATCH_ANSWER}"][data-mode="manual"]`)
      .first()
      .click();
    await waitForResponseModalClosed(pageJerry);
    await afterSync();
    await waitForConversationEntry(pageJerry, tomUserId);
    await waitForConversationEntry(pageTom, jerryUserId);

    // ── Phase 1: unread badge appears for Jerry immediately after new match ──
    // The new conversation is created with unread=true; the Me nav button should show a badge.
    // Jerry is currently on the Talks tab — navigate to Me without opening the conversation.
    await pageJerry.click('.nav-btn[data-view="me"]');
    await afterNav();

    const meNavJerry = pageJerry.locator('.nav-btn[data-view="me"]');
    // First ensure the durable local conversation state exists, then require the unread badge signal.
    await expectConversationUnread(pageJerry, tomUserId, true);
    await expect(meNavJerry.locator('.notification-badge')).toBeVisible({ timeout: 30_000 });

    // ── Phase 2: opening the conversation clears the badge ───────────────────
    await openConversationByOtherUserId(pageJerry, tomUserId);

    // Navigate away to trigger Me-tab re-render with updated state
    await pageJerry.click('#back-from-conversation');
    await afterAction();

    await expectConversationUnread(pageJerry, tomUserId, false);
    await expect(meNavJerry.locator('.notification-badge')).not.toBeVisible({ timeout: 10000 });

    // ── Phase 3: Tom sends a message while Jerry's overlay is closed ─────────
    // Tom opens conversation first
    await openConversationByOtherUserId(pageTom, jerryUserId);

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

    await expectConversationUnread(pageJerry, tomUserId, true);

    // ── Phase 5: Jerry opens conversation — badge clears ─────────────────────
    await openConversationByOtherUserId(pageJerry, tomUserId);
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
    await expectConversationUnread(pageJerry, tomUserId, false);
    await expect(meNavJerry.locator('.notification-badge')).not.toBeVisible({ timeout: 10000 });
  });
});
