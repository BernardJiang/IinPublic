/**
 * Exact chatbot Q/A memory:
 * Tom sees the same exact question in different talk contexts (different titles / option sets).
 * The chatbot must ask Tom when no exact saved answer is available in the current options,
 * then later auto-answer from older exact history when a compatible option returns.
 */
import { Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../helpers/fixtures';
import { clearGunDatabases } from '../helpers/clear-database';
import { afterSync } from '../helpers/timing';
import {
  launchThreeBrowsers,
  shutdownThreeBrowsers,
  type ThreeBrowsers,
} from '../helpers/talks-matching-browsers';
import {
  bootstrapUser,
  finalCleanupPages,
  openIncomingTalkModal,
  openIncomingTalkModalWithAutoAnswers,
  resetTalksMatchingSession,
  waitForResponseModalClosed,
  waitForTabActive,
} from '../helpers/talks-matching-flow';
import { createTalkFromCompanyPage } from '../helpers/talk-demo-ui';
import { gunBaseURL } from '../helpers/ports';

const QUESTION = 'Favorite fruit?';
const TITLE_APPLE = 'E2E Exact Memory Context A';
const TITLE_BANANA = 'E2E Exact Memory Context B';
const TITLE_REUSE_APPLE = 'E2E Exact Memory Reuse Apple';

function fruitTalk(title: string, matchAnswerId: string, matchAnswerText: string, otherAnswerId: string, otherAnswerText: string) {
  return {
    title,
    type: 'flow',
    isAdult: false,
    language: 'en',
    tags: [],
    questions: [
      {
        id: 'q_fruit',
        text: QUESTION,
        answers: [
          { id: matchAnswerId, text: matchAnswerText, isMatch: true, isTerminal: true },
          { id: otherAnswerId, text: otherAnswerText, isIgnore: true, isTerminal: true },
        ],
        contextHashId: '',
      },
    ],
    createdAt: new Date(),
    isTemplate: false,
    usageCount: 0,
  };
}

async function chooseAutoAnswer(page: Page, answerId: string): Promise<void> {
  const modal = page.locator('#talk-response-modal');
  await expect(modal.locator('.modal-content')).toContainText(QUESTION, { timeout: 60_000 });
  const radio = modal.locator(`input.choice-radio[data-answer-id="${answerId}"][data-mode="auto"]`).first();
  await expect(radio).toBeVisible({ timeout: 30_000 });
  await radio.click();
  await waitForResponseModalClosed(page);
  await afterSync();
}

async function currentUser(page: Page): Promise<{ id: string; name: string }> {
  return page.evaluate(() => {
    const app = (window as unknown as { __iinpublic_app?: { getApp: () => any } }).__iinpublic_app?.getApp?.();
    return {
      id: String(app?.currentUser?.id || ''),
      name: String(app?.currentUser?.stageName || 'Someone'),
    };
  });
}

async function deliverTalkToReceiver(
  senderPage: Page,
  sender: { id: string; name: string },
  receiver: { id: string; name: string },
  talkId: string,
  talkData: any,
): Promise<any> {
  const res = await senderPage.context().request.post(
    `${gunBaseURL()}/api/talks/${encodeURIComponent(talkId)}/received`,
    {
      data: {
        talkData,
        senderId: sender.id,
        senderName: sender.name,
        receiverId: receiver.id,
        receiverName: receiver.name,
      },
    },
  );
  expect(res.ok()).toBe(true);
  return res.json();
}

async function waitForRecordedResponse(page: Page, talkId: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const res = await page.context().request.get(
          `${gunBaseURL()}/api/stats/talks/${encodeURIComponent(talkId)}/summary`,
          { headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' } },
        );
        if (!res.ok()) return 0;
        const summary = (await res.json()) as { total?: number };
        return Number(summary.total ?? 0);
      },
      { timeout: 30_000, intervals: [300, 600, 1000] },
    )
    .toBeGreaterThanOrEqual(1);
}

test.describe('Talks matching — exact chatbot Q/A memory', () => {
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

  test.beforeAll(async () => {
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

  test('asks Tom when no exact option matches, then auto-reuses older exact history when Apple returns', async () => {
    const tom = await bootstrapUser(browserTom, 'Tom', 'Tom');
    contextTom = tom.context;
    pageTom = tom.page;
    await pageTom.click('.chatroom-item:has-text("Global")');
    await waitForTabActive(pageTom, 'chatrooms');
    await afterSync();

    const jerry = await bootstrapUser(browserJerry, 'Jerry', 'Jerry');
    contextJerry = jerry.context;
    pageJerry = jerry.page;
    await pageJerry.click('.chatroom-item:has-text("Global")');
    await waitForTabActive(pageJerry, 'chatrooms');
    await afterSync();

    const bob = await bootstrapUser(browserBob, 'Bob', 'Bob');
    contextBob = bob.context;
    pageBob = bob.page;
    await pageBob.click('.chatroom-item:has-text("Global")');
    await waitForTabActive(pageBob, 'chatrooms');
    await afterSync();

    const tomIdentity = await currentUser(pageTom);
    const jerryIdentity = await currentUser(pageJerry);
    const bobIdentity = await currentUser(pageBob);

    // Context A: Jerry asks Favorite fruit? with Apple available. Tom saves Apple as TEMPORARY.
    const applePayload = fruitTalk(TITLE_APPLE, 'a_apple', 'Apple', 'a_banana_ignore', 'Banana');
    const appleTalkId = await createTalkFromCompanyPage(pageJerry, applePayload);
    const appleTalkData = { ...applePayload, id: appleTalkId, authorId: jerryIdentity.id };
    expect(await deliverTalkToReceiver(pageJerry, jerryIdentity, tomIdentity, appleTalkId, appleTalkData)).toMatchObject({
      registered: true,
      autoResponded: false,
    });
    await openIncomingTalkModal(pageTom, TITLE_APPLE);
    await chooseAutoAnswer(pageTom, 'a_apple');
    await waitForRecordedResponse(pageTom, appleTalkId);

    // Context B: same exact question, but Apple is absent. Auto mode must not answer;
    // the modal is dispatched to Tom so he can choose Banana.
    const bananaPayload = fruitTalk(TITLE_BANANA, 'a_banana', 'Banana', 'a_mango_ignore', 'Mango');
    const bananaTalkId = await createTalkFromCompanyPage(pageJerry, bananaPayload);
    const bananaTalkData = { ...bananaPayload, id: bananaTalkId, authorId: jerryIdentity.id };
    expect(await deliverTalkToReceiver(pageJerry, jerryIdentity, tomIdentity, bananaTalkId, bananaTalkData)).toMatchObject({
      registered: true,
      autoResponded: false,
    });
    await openIncomingTalkModalWithAutoAnswers(pageTom, TITLE_BANANA);
    const modal = pageTom.locator('#talk-response-modal');
    await expect(modal.locator('.modal-content')).toContainText(QUESTION, { timeout: 60_000 });
    await expect(modal.locator('input.choice-radio[data-answer-id="a_banana"][data-mode="auto"]')).toBeVisible();
    await chooseAutoAnswer(pageTom, 'a_banana');
    await waitForRecordedResponse(pageTom, bananaTalkId);

    // Bob sends another context with Apple available and Banana absent.
    // The chatbot should skip newest Banana history, reuse older Apple, and create a bot-marked match for Bob.
    const reusePayload = fruitTalk(TITLE_REUSE_APPLE, 'a_apple', 'Apple', 'a_orange_ignore', 'Orange');
    const reuseTalkId = await createTalkFromCompanyPage(pageBob, reusePayload);
    const reuseTalkData = { ...reusePayload, id: reuseTalkId, authorId: bobIdentity.id };
    const autoJson = await deliverTalkToReceiver(pageBob, bobIdentity, tomIdentity, reuseTalkId, reuseTalkData);
    expect(autoJson).toMatchObject({
      registered: true,
      autoResponded: true,
      isMatch: true,
      reason: 'exact_chatbot_memory',
    });
    expect(autoJson.matches?.[0]?.senderId).toBe(bobIdentity.id);
  });
});
