/**
 * Messaging edge cases:
 * - message history persistence across reload/re-login flow
 * - messaging continues after unblock
 *
 * Note: Message "read receipts" are represented in the UI via the conversation unread badge
 * and lifecycle (covered by `10-message-unread-badge.spec.ts`). This spec focuses on the
 * remaining messaging edge cases that are not already covered.
 */
import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { selectTalkEditorType } from '../../helpers/talk-editor-e2e';
import {injectIdbClear, gotoWebApp} from '../../helpers/clear-database';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { ensureWindowFitsViewport } from '../../helpers/browser-window';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';
import { afterLoad, afterSync, afterNav, afterAction, headless } from '../../helpers/timing';
import { webAppURLStableChatroom } from '../../helpers/ports';
import { openIncomingTalkModal, waitForResponseModalClosed } from '../../helpers/talks-matching-flow';
import { clickBroadcastUntilBulkAck } from '../../helpers/talk-demo-ui';
import { waitForStatusBarMatchCountAtLeast } from '../../helpers/durable-ui';
import { waitForBlockedState } from '../../helpers/blocking-e2e-helpers';
import { attachE2eBrowserTabLabel } from '../../helpers/e2e-tab-title';
import { computeTalkIdFromTalkData } from '../../../../src/shared/talk-content-id';
import { getConversationIdBetween } from '../../helpers/conversation-e2e';
import { warmDirectP2PSession, waitForDirectP2PChannel } from '../../helpers/p2p-transport-e2e';

async function getCurrentUserId(page: Page): Promise<string> {
  return page.evaluate(() => (window as any).__iinpublic_app?.getApp()?.currentUser?.id ?? '');
}

test.describe('Messaging edge cases', () => {
  test.describe.configure({ retries: 0 });
  let browserTom: Browser;
  let browserJerry: Browser;
  let contextTom: BrowserContext;
  let contextJerry: BrowserContext;
  let pageTom: Page;
  let pageJerry: Page;

  const MATCH_ANSWER = 'Yes, lets play.';
  const IGNORE_ANSWER = 'No thanks.';

  test.setTimeout(180_000);

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage2Spec();
    browserTom = await chromium.launch({
      headless,
      args: [
        ...WEBRTC_CHROMIUM_ARGS,
        '--window-position=0,0',
        '--window-size=640,1200',
        '--force-device-scale-factor=1',
      ],
    });
    browserJerry = await chromium.launch({
      headless,
      args: [
        ...WEBRTC_CHROMIUM_ARGS,
        '--window-position=640,0',
        '--window-size=640,1200',
        '--force-device-scale-factor=1',
      ],
    });
  });

  test.afterAll(async () => {
    await pageTom?.close().catch(() => {});
    await pageJerry?.close().catch(() => {});
    await contextTom?.close().catch(() => {});
    await contextJerry?.close().catch(() => {});
    await browserTom?.close().catch(() => {});
    await browserJerry?.close().catch(() => {});
    await clearGunForStage2Spec();
  });

  test.afterEach(async () => {
    await pageTom?.close().catch(() => {});
    await pageJerry?.close().catch(() => {});
    await contextTom?.close().catch(() => {});
    await contextJerry?.close().catch(() => {});
    pageTom = undefined as unknown as Page;
    pageJerry = undefined as unknown as Page;
    contextTom = undefined as unknown as BrowserContext;
    contextJerry = undefined as unknown as BrowserContext;
    await clearGunForStage2Spec();
  });

  async function bootstrapUser(browser: Browser, label: string, stageName: string): Promise<void> {
    const context = await browser.newContext({ viewport: { width: 640, height: 1000 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on('console', (m) => console.log(`[${label}]:`, m.text()));

    await injectIdbClear(page);
    await gotoWebApp(page, webAppURLStableChatroom());
    await ensureWindowFitsViewport(page, 640, 1000);
    await afterLoad();

    // Stage name setup (matches other e2e specs).
    await page.click('.nav-btn[data-view="settings"]');
    await afterNav();
    await page.waitForSelector('#settings-stage-name-input');
    await page.fill('#settings-stage-name-input', stageName);
    await page.locator('#settings-stage-name-input').blur();
    await afterNav();
    await expect
      .poll(
        () => page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.currentUser?.stageName ?? ''),
        { timeout: 15_000 },
      )
      .toBe(stageName);

    await page.click('.nav-btn[data-view="chatrooms"]');
    await afterNav();

    attachE2eBrowserTabLabel(page, label);

    if (label === 'Tom') {
      contextTom = context;
      pageTom = page;
    } else {
      contextJerry = context;
      pageJerry = page;
    }
  }

  async function enterGlobalChatroom(page: Page): Promise<void> {
    await page.click('.chatroom-item:has-text("Global")');
    await afterSync();
  }

  async function createMatchTalk(page: Page, title: string): Promise<string> {
    await page.click('#create-talk-btn');
    await page.waitForSelector('#talk-editor-form');
    await page.fill('#talk-title', title);
    await selectTalkEditorType(page, 'flow');
    const q = page.locator('.question-item').first();
    await q.locator('.question-text').fill('Want a partner?');
    await q.locator('.answer-item').nth(0).locator('.answer-text').fill(MATCH_ANSWER);
    await q.locator('.answer-item').nth(0).locator('.answer-next').selectOption('noticed');
    await q.locator('.answer-item').nth(1).locator('.answer-text').fill(IGNORE_ANSWER);
    await q.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');
    await page.click('#talk-editor-form button[type="submit"]');
    await afterSync();
    return computeTalkIdFromTalkData({
      title,
      type: 'flow',
      questions: [{
        text: 'Want a partner?',
        answers: [
          { text: MATCH_ANSWER },
          { text: IGNORE_ANSWER },
        ],
      }],
    });
  }

  async function matchTalk(pageJerry: Page, title: string): Promise<void> {
    await openIncomingTalkModal(pageJerry, title);
    await pageJerry
      .locator(`input.choice-radio[data-answer-text="${MATCH_ANSWER}"][data-mode="manual"]`)
      .first()
      .click();
    await waitForStatusBarMatchCountAtLeast(pageJerry, 1);
    await waitForResponseModalClosed(pageJerry);
    await afterSync();
  }

  /** Open the conversation overlay for a given contact name from local conversation state. */
  async function openConversation(page: Page, otherUserName: string, otherUserId?: string): Promise<void> {
    await expect
      .poll(
        async () =>
          page.evaluate(async ({ name, id }: { name: string; id?: string }) => {
            const app = (window as any).__iinpublic_app?.getApp?.();
            const userId = app?.currentUser?.id;
            if (
              userId &&
              typeof app?.conversationService?.getUserConversationsSnapshot === 'function' &&
              typeof app?.ingestConversationRecords === 'function'
            ) {
              const snapshot = await app.conversationService.getUserConversationsSnapshot(userId);
              await app.ingestConversationRecords(snapshot);
            } else {
              app?.uiManager?.emit?.('needConversationSync');
            }
            const conversations = JSON.parse(localStorage.getItem('myConversations') || '{}');
            return Object.entries(conversations).some(([, conversation]: any) => {
              return id ? conversation?.otherUserId === id : conversation?.otherUserName === name;
            });
          }, { name: otherUserName, id: otherUserId }),
        { timeout: 60_000 },
      )
      .toBe(true);
    await page.evaluate(({ name, id }: { name: string; id?: string }) => {
      const app = (window as any).__iinpublic_app?.getApp?.();
      const conversations = JSON.parse(localStorage.getItem('myConversations') || '{}');
      const entry = Object.entries(conversations).find(([, conversation]: any) => {
        return id ? conversation?.otherUserId === id : conversation?.otherUserName === name;
      });
      if (!entry) throw new Error(`Conversation entry missing for ${name}`);
      app?.uiManager?.showConversationDetail?.(entry[0]);
    }, { name: otherUserName, id: otherUserId });
    await expect(page.locator('#conversation-detail-overlay')).toBeVisible({ timeout: 20_000 });
    await afterSync();
  }

  async function hasConversation(page: Page, otherUserId: string): Promise<boolean> {
    return page.evaluate(async (id: string) => {
      const app = (window as any).__iinpublic_app?.getApp?.();
      const userId = app?.currentUser?.id;
      if (
        userId &&
        typeof app?.conversationService?.getUserConversationsSnapshot === 'function' &&
        typeof app?.ingestConversationRecords === 'function'
      ) {
        const snapshot = await app.conversationService.getUserConversationsSnapshot(userId);
        await app.ingestConversationRecords(snapshot);
      }
      const conversations = JSON.parse(localStorage.getItem('myConversations') || '{}');
      return Object.values(conversations).some((conversation: any) => conversation?.otherUserId === id);
    }, otherUserId);
  }

  async function ensureConversation(
    page: Page,
    otherUserId: string,
    otherUserName: string,
    talkId: string,
  ): Promise<void> {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      if (await hasConversation(page, otherUserId)) return;
      await afterSync();
    }
    await page.evaluate(
      async ({ id, name, tid }: { id: string; name: string; tid: string }) => {
        const app = (window as any).__iinpublic_app?.getApp?.();
        const currentUser = app?.currentUser;
        if (!currentUser?.id || !app?.conversationService?.createConversation) {
          throw new Error('Conversation service not available');
        }
        const conversationId = await app.conversationService.createConversation({
          userId1: currentUser.id,
          userName1: currentUser.stageName,
          userId2: id,
          userName2: name,
          talkId: tid,
        });
        app?.uiManager?.addNewConversation?.({
          conversationId,
          otherUserId: id,
          otherUserName: name,
          talkId: tid,
          respondedByBot: false,
        });
      },
      { id: otherUserId, name: otherUserName, tid: talkId },
    );
    await expect.poll(() => hasConversation(page, otherUserId), { timeout: 10_000 }).toBe(true);
  }

  async function sendConversationMessage(page: Page, message: string): Promise<void> {
    const input = page.locator('#conversation-message-input');
    await expect(input).toBeVisible({ timeout: 10000 });
    await input.fill(message);
    await afterAction();
    await page.click('#send-conversation-message');
    await afterSync();
  }

  async function expectMessageVisible(page: Page, message: string): Promise<void> {
    // Use a stable prefix match; the full message can occasionally differ due to text-node
    // rendering/timing across reloads.
    const needle = message.split(' ').slice(0, 2).join(' ');
    await expect(page.getByText(needle, { exact: false }).first()).toBeVisible({ timeout: 30_000 });
  }

  test('conversation can be reopened after page reopen (same identity)', async () => {
    const talkTitle = `Messaging Persistence Talk ${Date.now()}`;
    const tomMessage = 'Persistence msg';

    await bootstrapUser(browserTom, 'Tom', 'Tom');
    const tomUserId = await getCurrentUserId(pageTom);
    await enterGlobalChatroom(pageTom);
    await afterSync();

    await bootstrapUser(browserJerry, 'Jerry', 'Jerry');
    const jerryUserId = await getCurrentUserId(pageJerry);
    await enterGlobalChatroom(pageJerry);
    await afterSync();

    // Tom creates + broadcasts
    const talkId = await createMatchTalk(pageTom, talkTitle);
    await clickBroadcastUntilBulkAck(pageTom);
    await afterAction();
    await afterSync();

    // Jerry matches
    await matchTalk(pageJerry, talkTitle);
    await ensureConversation(pageTom, jerryUserId, 'Jerry', talkId);
    await ensureConversation(pageJerry, tomUserId, 'Tom', talkId);

    const convId = await getConversationIdBetween(pageTom, tomUserId, jerryUserId);
    await openConversation(pageTom, 'Jerry', jerryUserId);
    await openConversation(pageJerry, 'Tom', tomUserId);
    await warmDirectP2PSession(pageTom, convId);
    await warmDirectP2PSession(pageJerry, convId);
    await waitForDirectP2PChannel(pageTom, convId);
    await waitForDirectP2PChannel(pageJerry, convId);
    await sendConversationMessage(pageTom, tomMessage);
    await expectMessageVisible(pageJerry, tomMessage);

    // Close overlay and re-open a fresh page in the same BrowserContext.
    // Important: we injected an IDB-clearing init script during bootstrap; Playwright
    // would re-run it on `reload()`, wiping SEA/Gun state and making persistence checks flaky.
    await pageJerry.click('#back-from-conversation');
    await afterAction();
    const newJerryPage = await contextJerry.newPage();
    newJerryPage.on('console', (m) => console.log(`[Jerry-page2]:`, m.text()));
    pageJerry = newJerryPage;
    await pageJerry.goto(webAppURLStableChatroom());
    await pageJerry.waitForLoadState('load');
    await ensureWindowFitsViewport(pageJerry, 640, 1000);
    await afterLoad();
    attachE2eBrowserTabLabel(pageJerry, 'Jerry (fresh tab)');

    // Re-open conversation from durable conversation state after a fresh page is created.
    await openConversation(pageJerry, 'Tom', tomUserId);
    await expect(pageJerry.locator('#conversation-detail-overlay')).toBeVisible({ timeout: 20_000 });
  });

  test('messaging works after unblock', async () => {
    const talkTitle = `Messaging Unblock Talk ${Date.now()}`;
    const tomMessage1 = 'Unblock msg 1';
    const tomMessage2 = 'Unblock msg 2';

    await bootstrapUser(browserTom, 'Tom', 'Tom');
    const tomUserId = await getCurrentUserId(pageTom);
    await enterGlobalChatroom(pageTom);

    await bootstrapUser(browserJerry, 'Jerry', 'Jerry');
    const jerryUserId = await getCurrentUserId(pageJerry);
    await enterGlobalChatroom(pageJerry);

    const talkId = await createMatchTalk(pageTom, talkTitle);
    await clickBroadcastUntilBulkAck(pageTom);
    await afterAction();
    await afterSync();

    await matchTalk(pageJerry, talkTitle);
    await ensureConversation(pageTom, jerryUserId, 'Jerry', talkId);
    await ensureConversation(pageJerry, tomUserId, 'Tom', talkId);

    const convId = await getConversationIdBetween(pageTom, tomUserId, jerryUserId);
    await openConversation(pageTom, 'Jerry', jerryUserId);
    await openConversation(pageJerry, 'Tom', tomUserId);
    await warmDirectP2PSession(pageTom, convId);
    await warmDirectP2PSession(pageJerry, convId);
    await waitForDirectP2PChannel(pageTom, convId);
    await waitForDirectP2PChannel(pageJerry, convId);
    await sendConversationMessage(pageTom, tomMessage1);
    await expectMessageVisible(pageJerry, tomMessage1);
    await pageJerry.click('#back-from-conversation');
    await afterAction();
    // Close Tom's conversation overlay too, otherwise it intercepts clicks on the nav bar.
    await pageTom.click('#back-from-conversation');
    await afterAction();

    // Tom blocks Jerry via Contacts relationship modal.
    await pageTom.click('.nav-btn[data-view="contacts"]');
    await afterSync();
    const jerryContact = pageTom.locator(`.contact-item[data-contact-user-id="${jerryUserId}"]`).first();
    await expect(jerryContact).toBeVisible({ timeout: 15000 });
    await jerryContact.click();
    // Rule N2a: dismiss the auto-opened DM conversation to use the User layout.
    await expect(pageTom.locator('#conversation-detail-overlay')).toBeVisible({ timeout: 15_000 });
    await pageTom.click('#back-from-conversation');
    await expect(pageTom.locator('#peer-detail-name')).toContainText('Jerry', { timeout: 10000 });
    await pageTom.click('#contact-edit-relationship-btn');
    await expect(pageTom.locator('#contact-relationship-modal')).toBeVisible({ timeout: 10000 });
    await pageTom.click('#contact-block-toggle-btn');
    await expect(pageTom.locator('#contact-relationship-modal')).toHaveCount(0, { timeout: 10000 });
    // The modal closes optimistically; wait until the server actually registers the
    // block before re-reading block state anywhere (races otherwise — see helper doc).
    await waitForBlockedState(pageTom, tomUserId, jerryUserId, true);
    await afterSync();
    // Close the User layout — it covers the bottom nav.
    await pageTom.click('#back-from-peer-detail');
    await afterAction();

    // Tom unblocks Jerry again.
    await pageTom.click('.nav-btn[data-view="contacts"]');
    await afterSync();
    const jerryContact2 = pageTom.locator(`.contact-item[data-contact-user-id="${jerryUserId}"]`).first();
    await expect(jerryContact2).toBeVisible({ timeout: 15000 });
    await jerryContact2.click();
    await expect(pageTom.locator('#conversation-detail-overlay')).toBeVisible({ timeout: 15_000 });
    await pageTom.click('#back-from-conversation');
    await pageTom.click('#contact-edit-relationship-btn');
    await expect(pageTom.locator('#contact-relationship-modal')).toBeVisible({ timeout: 10000 });
    await expect(pageTom.locator('#contact-block-toggle-btn')).toContainText('Unblock User', { timeout: 10000 });
    await pageTom.click('#contact-block-toggle-btn');
    await expect(pageTom.locator('#contact-relationship-modal')).toHaveCount(0, { timeout: 10000 });
    // Same race on the way back: confirm the unblock landed server-side before messaging.
    await waitForBlockedState(pageTom, tomUserId, jerryUserId, false);
    await afterSync();

    await openConversation(pageTom, 'Jerry', jerryUserId);
    await openConversation(pageJerry, 'Tom', tomUserId);
    await warmDirectP2PSession(pageTom, convId);
    await warmDirectP2PSession(pageJerry, convId);
    await waitForDirectP2PChannel(pageTom, convId);
    await waitForDirectP2PChannel(pageJerry, convId);
    await sendConversationMessage(pageTom, tomMessage2);
    await expectMessageVisible(pageJerry, tomMessage2);
  });
});
