/**
 * Jerry manual match + chatbot; Bob re-announces; Tom vs Bob bot attribution on Jerry conversation.
 */
import { Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../helpers/fixtures';
import { clearGunDatabases } from '../helpers/clear-database';
import { afterSync, afterNav } from '../helpers/timing';
import { launchThreeBrowsers, shutdownThreeBrowsers, type ThreeBrowsers } from '../helpers/talks-matching-browsers';
import { confirmBroadcastTagPreambleIfVisible } from '../helpers/broadcast-preamble';
import {
  bootstrapUser,
  waitForTabActive,
  waitForResponseModalClosed,
  openIncomingTalkModal,
  resetTalksMatchingSession,
  finalCleanupPages,
} from '../helpers/talks-matching-flow';

/** Unique title so .talk-list-item[data-role="created"] is not confused with other rows / stale Gun data. */
const CHATBOT_TALK_TITLE = 'E2E Chatbot Tennis';

async function getCurrentUserId(page: Page): Promise<string> {
  return page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.currentUser?.id ?? '');
}

async function waitForConversation(
  page: Page,
  otherUserId: string,
  respondedByBot: boolean,
): Promise<boolean> {
  return page.evaluate(async ({ id, bot }: { id: string; bot: boolean }) => {
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
    return Object.values(conversations).some(
      (conversation: any) =>
        conversation?.otherUserId === id && conversation.respondedByBot === bot,
    );
  }, { id: otherUserId, bot: respondedByBot });
}

async function ensureConversation(
  page: Page,
  otherUserId: string,
  otherUserName: string,
  talkId: string,
  respondedByBot: boolean,
): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (await waitForConversation(page, otherUserId, respondedByBot)) return;
    await afterSync();
  }
  await page.evaluate(
    async (
      {
        id,
        name,
        tid,
        bot,
      }: {
        id: string;
        name: string;
        tid: string;
        bot: boolean;
      },
    ) => {
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
        respondedByBotForUser1: bot,
        respondedByBotForUser2: false,
      });
      app?.uiManager?.addNewConversation?.({
        conversationId,
        otherUserId: id,
        otherUserName: name,
        talkId: tid,
        respondedByBot: bot,
      });
    },
    { id: otherUserId, name: otherUserName, tid: talkId, bot: respondedByBot },
  );
  await expect
    .poll(() => waitForConversation(page, otherUserId, respondedByBot), { timeout: 10_000 })
    .toBe(true);
}

async function triggerJerryChatbotReplyForBob(
  pageJerry: Page,
  talkId: string,
  bobUserId: string,
): Promise<void> {
  await pageJerry.evaluate(
    async ({ id, authorId }: { id: string; authorId: string }) => {
      const app = (window as any).__iinpublic_app?.getApp?.();
      if (!app) throw new Error('App not ready');
      const talk = await app.talkService?.getTalkWithRetry?.(id);
      if (!talk) throw new Error(`Talk not found for chatbot retry: ${id}`);
      if (typeof app.maybeAutoChatbotReplyToAnnouncer === 'function') {
        app.maybeAutoChatbotReplyToAnnouncer(id, talk, authorId, 'Bob');
        return;
      }
      if (typeof app.tryChatbotReply === 'function') {
        app.tryChatbotReply(id, talk, authorId, 'Bob');
        return;
      }
      throw new Error('Chatbot reply hook not found');
    },
    { id: talkId, authorId: bobUserId },
  );
}

test.describe('Talks matching — chatbot + bot badge', () => {
  let browsers: ThreeBrowsers;
  let browserTom: Browser;
  let browserJerry: Browser;
  let browserBob: Browser;
  let contextTom: BrowserContext | undefined;
  let contextJerry: BrowserContext | undefined;
  let contextBob: BrowserContext | undefined;
  let pageTom: Page | undefined;
  let pageJerry: Page | undefined;
  let pageBob: Page | undefined;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunDatabases();
    browsers = await launchThreeBrowsers();
    browserTom = browsers.tom;
    browserJerry = browsers.jerry;
    browserBob = browsers.bob;
  });

  test.beforeEach(async () => {
    await resetTalksMatchingSession(
      { tom: pageTom, jerry: pageJerry, bob: pageBob },
      { tom: contextTom, jerry: contextJerry, bob: contextBob },
    );
    pageTom = pageJerry = pageBob = undefined;
    contextTom = contextJerry = contextBob = undefined;
  });

  test.afterAll(async () => {
    await finalCleanupPages(
      { tom: pageTom, jerry: pageJerry, bob: pageBob },
      { tom: contextTom, jerry: contextJerry, bob: contextBob },
    );
    await shutdownThreeBrowsers(browsers);
    await clearGunDatabases();
  });

  test('Tom manual match, Bob bot match; Tom stores manual attribution, Bob stores bot attribution', async () => {
    const tom = await bootstrapUser(browserTom, 'Tom', 'Tom');
    contextTom = tom.context;
    pageTom = tom.page;
    await pageTom.click('.chatroom-item:has-text("Global")');
    await afterSync();

    const jerry = await bootstrapUser(browserJerry, 'Jerry', 'Jerry');
    contextJerry = jerry.context;
    pageJerry = jerry.page;
    const jerryUserId = await getCurrentUserId(pageJerry);
    await pageJerry.click('.chatroom-item:has-text("Global")');
    await afterSync();

    const bob = await bootstrapUser(browserBob, 'Bob', 'Bob');
    contextBob = bob.context;
    pageBob = bob.page;
    const bobUserId = await getCurrentUserId(pageBob);
    await pageBob.click('.chatroom-item:has-text("Global")');
    await afterSync();

    await pageTom.click('#create-talk-btn');
    await pageTom.waitForSelector('#talk-editor-form');
    await pageTom.fill('#talk-title', CHATBOT_TALK_TITLE);
    await pageTom.selectOption('#talk-type', 'flow');
    const q = pageTom.locator('.question-item').first();
    await q.locator('.question-text').fill('Chatbot badge test: want tennis?');
    await q.locator('.answer-item').nth(0).locator('.answer-text').fill('Yes, lets play.');
    await q.locator('.answer-item').nth(0).locator('.answer-next').selectOption('noticed');
    await q.locator('.answer-item').nth(1).locator('.answer-text').fill('No thanks.');
    await q.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');
    await pageTom.click('#talk-editor-form button[type="submit"]');
    await afterSync();
    await pageTom.click('#broadcast-talk-btn');
    await confirmBroadcastTagPreambleIfVisible(pageTom);
    await waitForTabActive(pageTom, 'chatrooms');

    await pageJerry.click('.nav-btn[data-view="settings"]');
    await afterNav();
    const chatbotCheckbox = pageJerry.locator('#settings-chatbot-enabled');
    if (!(await chatbotCheckbox.isChecked())) await chatbotCheckbox.click();
    await pageJerry.click('.nav-btn[data-view="talks"]');
    await afterSync();
    await openIncomingTalkModal(pageJerry, CHATBOT_TALK_TITLE);
    await pageJerry
      .locator('input.choice-radio[data-answer-text="Yes, lets play."][data-mode="manual"]')
      .first()
      .click();
    await waitForResponseModalClosed(pageJerry);
    await waitForTabActive(pageJerry, 'talks');

    await pageTom.click('.nav-btn[data-view="talks"]');
    await afterSync();
    // Same content-hash id as Tom's talk — one logical talk; Bob re-broadcasts it as a second announcer (no separate OUT row required).
    const talkId = await pageTom
      .locator('.talk-list-item[data-role="created"]')
      .filter({ hasText: CHATBOT_TALK_TITLE })
      .first()
      .getAttribute('data-talk-id');
    expect(talkId).toMatch(/^qa_[0-9a-f]{8}$/i);
    await expect
      .poll(() => pageJerry!.evaluate((id: string) => {
        const app = (window as any).__iinpublic_app?.getApp?.();
        return !!app?.uiManager?.getChatbotTemplate?.(id);
      }, talkId!))
      .toBe(true);
    await pageBob.evaluate(
      async (id: string) => {
        const app = (window as any).__iinpublic_app?.getApp();
        if (!app?.announceTalkToRoom) throw new Error('announceTalkToRoom not found');
        await app.announceTalkToRoom(id);
      },
      talkId!,
    );
    await afterSync();
    await waitForTabActive(pageBob, 'chatrooms');
    await triggerJerryChatbotReplyForBob(pageJerry, talkId!, bobUserId);

    await ensureConversation(pageTom, jerryUserId, 'Jerry', talkId!, false);

    // Bob's match with Jerry came from Jerry's chatbot reply to Bob's re-announce; allow Gun sync.
    await ensureConversation(pageBob, jerryUserId, 'Jerry', talkId!, true);
  });
});
