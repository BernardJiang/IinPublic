/**
 * Exact chatbot Q/A memory:
 * Tom sees the same exact question in different talk contexts (different titles / option sets).
 * The chatbot must ask Tom when no exact saved answer is available in the current options,
 * then later auto-answer from older exact history when a compatible option returns.
 */
import { Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { maybeClearGunDatabases } from '../../helpers/clear-database';
import { afterNav, afterSync } from '../../helpers/timing';
import {
  launchThreeBrowsers,
  shutdownThreeBrowsers,
  type ThreeBrowsers,
} from '../../helpers/talks-matching-browsers';
import {
  bootstrapUser,
  finalCleanupPages,
  openIncomingTalkModal,
  openIncomingTalkModalWithAutoAnswers,
  resetTalksMatchingSession,
  syncIncomingFromServer,
  waitForIncomingTalkClusterOnLocalGun,
  waitForResponseModalClosed,
  waitForTabActive,
} from '../../helpers/talks-matching-flow';
import { createTalkFromCompanyPage } from '../../helpers/talk-demo-ui';
import { gunBaseURL, isDirectTalkDeliveryE2e } from '../../helpers/ports';

const QUESTION = 'Favorite fruit?';
const TITLE_APPLE = 'E2E Exact Memory Context A';
const TITLE_BANANA = 'E2E Exact Memory Context B';
const TITLE_DISABLED_APPLE = 'E2E Exact Memory Disabled Apple';
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
  receiverPage: Page,
  sender: { id: string; name: string },
  receiver: { id: string; name: string },
  talkId: string,
  talkData: any,
  chatbotEnabled?: boolean,
): Promise<any> {
  if (isDirectTalkDeliveryE2e()) {
    const title = String(talkData?.title || '');
    const receiverHasTalk = async () =>
      receiverPage.evaluate(async (needle) => {
        const app = (window as unknown as { __iinpublic_app?: { getApp: () => any } }).__iinpublic_app?.getApp?.();
        await app?.syncIncomingClustersFromServer?.();
        const clusters = (await app?.getLocalIncomingClustersForE2e?.()) ?? [];
        return JSON.stringify(clusters).toLowerCase().includes(String(needle).toLowerCase());
      }, title);

    let lastWarmResults: unknown = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const warmResults = await Promise.all([
        senderPage.evaluate(
          async ({ peerId, peerName }) => {
            const app = (window as unknown as { __iinpublic_app?: { getApp: () => any } }).__iinpublic_app?.getApp?.();
            const ready = await app?.warmMeshConnectionToPeer?.(peerId, peerName);
            return {
              ready: ready === true,
              diagnostics: app?.peerMeshService?.getDiagnostics?.() ?? null,
            };
          },
          { peerId: receiver.id, peerName: receiver.name },
        ),
        receiverPage.evaluate(
          async ({ peerId, peerName }) => {
            const app = (window as unknown as { __iinpublic_app?: { getApp: () => any } }).__iinpublic_app?.getApp?.();
            const ready = await app?.warmMeshConnectionToPeer?.(peerId, peerName);
            return {
              ready: ready === true,
              diagnostics: app?.peerMeshService?.getDiagnostics?.() ?? null,
            };
          },
          { peerId: sender.id, peerName: sender.name },
        ),
      ]);
      lastWarmResults = warmResults;
      // Bounded meshes may route this directed frame through another connected peer.
      // warmMeshConnectionToPeer is best-effort and does not require a direct edge.
      await senderPage.evaluate(
        async ({ id, data, peerId, peerName }) => {
          const app = (window as unknown as { __iinpublic_app?: { getApp: () => any } }).__iinpublic_app?.getApp?.();
          if (!app?.sendDirectTalkToPeer) throw new Error('sendDirectTalkToPeer unavailable');
          await app.sendDirectTalkToPeer(id, data, peerId, peerName);
        },
        { id: talkId, data: talkData, peerId: receiver.id, peerName: receiver.name },
      );
      try {
        await expect.poll(receiverHasTalk, { timeout: 15_000, intervals: [500, 1000] }).toBe(true);
        return {
          registered: true,
          autoResponded: false,
          ...(chatbotEnabled === false ? { reason: 'chatbot_disabled' } : {}),
          directDelivery: true,
        };
      } catch (error) {
        if (attempt === 2) {
          throw new Error(
            `mesh talk was not received after retries; warm=${JSON.stringify(lastWarmResults)}; cause=${String(error)}`,
          );
        }
      }
    }
    return {
      registered: true,
      autoResponded: false,
      ...(chatbotEnabled === false ? { reason: 'chatbot_disabled' } : {}),
      directDelivery: true,
    };
  }
  const res = await senderPage.context().request.post(
    `${gunBaseURL()}/api/talks/${encodeURIComponent(talkId)}/received`,
    {
      data: {
        talkData,
        senderId: sender.id,
        senderName: sender.name,
        receiverId: receiver.id,
        receiverName: receiver.name,
        ...(chatbotEnabled !== undefined ? { chatbotEnabled } : {}),
      },
    },
  );
  expect(res.ok()).toBe(true);
  return res.json();
}

async function waitForRecordedResponse(page: Page, talkId: string): Promise<void> {
  await expect
    .poll(
      () => page.evaluate((id) => {
        const doc = (window as any).__iinpublic_app?.getApp?.()?.getTalkLedgerDocForE2e?.();
        return Object.values(doc?.exchanged || {}).filter((row: any) =>
          row?.role === 'responder' && row?.talkId === id && Number(row?.version || 0) >= 1,
        ).length;
      }, talkId),
      { timeout: 30_000, intervals: [300, 600, 1000] },
    )
    .toBeGreaterThanOrEqual(1);
}

async function waitForExactMemoryAnswer(page: Page, userId: string, answerText: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const localMemoryHasAnswer = await page
          .evaluate(
            ({ expected }) => {
              try {
                const raw = localStorage.getItem('exactChatbotMemory');
                if (!raw) return false;
                const parsed = JSON.parse(raw);
                const localUserMemory = parsed?.users?.local || {};
                return JSON.stringify(localUserMemory).includes(expected);
              } catch {
                return false;
              }
            },
            { expected: answerText },
          )
          .catch(() => false);
        if (localMemoryHasAnswer) return true;

        const memoryRes = await page.context().request.get(
          `${gunBaseURL()}/api/test/exact-chatbot-memory/${encodeURIComponent(userId)}`,
          { headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' } },
        );
        if (!memoryRes.ok()) return false;
        const raw = JSON.stringify(await memoryRes.json());
        return raw.includes(userId) && raw.includes(answerText);
      },
      { timeout: 90_000, intervals: [300, 600, 1000, 2000] },
    )
    .toBe(true);
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
    await maybeClearGunDatabases();
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
    await maybeClearGunDatabases();
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
    expect(await deliverTalkToReceiver(pageJerry, pageTom, jerryIdentity, tomIdentity, appleTalkId, appleTalkData)).toMatchObject({
      registered: true,
      autoResponded: false,
    });
    await waitForIncomingTalkClusterOnLocalGun(pageTom, TITLE_APPLE, { timeout: 60_000, polling: 500 });
    await syncIncomingFromServer(pageTom);
    await openIncomingTalkModal(pageTom, TITLE_APPLE);
    await chooseAutoAnswer(pageTom, 'a_apple');
    await waitForRecordedResponse(pageTom, appleTalkId);
    await waitForExactMemoryAnswer(pageTom, tomIdentity.id, 'Apple');

    // Context B: same exact question, but Apple is absent. Auto mode must not answer;
    // the modal is dispatched to Tom so he can choose Banana.
    const bananaPayload = fruitTalk(TITLE_BANANA, 'a_banana', 'Banana', 'a_mango_ignore', 'Mango');
    const bananaTalkId = await createTalkFromCompanyPage(pageJerry, bananaPayload);
    const bananaTalkData = { ...bananaPayload, id: bananaTalkId, authorId: jerryIdentity.id };
    expect(await deliverTalkToReceiver(pageJerry, pageTom, jerryIdentity, tomIdentity, bananaTalkId, bananaTalkData)).toMatchObject({
      registered: true,
      autoResponded: false,
    });
    await waitForIncomingTalkClusterOnLocalGun(pageTom, TITLE_BANANA, { timeout: 60_000, polling: 500 });
    await syncIncomingFromServer(pageTom);
    await openIncomingTalkModalWithAutoAnswers(pageTom, TITLE_BANANA);
    const modal = pageTom.locator('#talk-response-modal');
    await expect(modal.locator('.modal-content')).toContainText(QUESTION, { timeout: 60_000 });
    await expect(modal.locator('input.choice-radio[data-answer-id="a_banana"][data-mode="auto"]')).toBeVisible();
    await chooseAutoAnswer(pageTom, 'a_banana');
    await waitForRecordedResponse(pageTom, bananaTalkId);
    await waitForExactMemoryAnswer(pageTom, tomIdentity.id, 'Banana');

    // With the receiver's Talk Behavior toggle off, a compatible saved answer must remain manual.
    await pageTom.click('.nav-btn[data-view="settings"]');
    await afterNav();
    await pageTom.locator('#settings-chatbot-enabled').uncheck();
    await expect
      .poll(() => pageTom!.evaluate(() => localStorage.getItem('chatbotEnabled')))
      .toBe('false');
    const disabledPayload = fruitTalk(TITLE_DISABLED_APPLE, 'a_apple', 'Apple', 'a_orange_ignore', 'Orange');
    const disabledTalkId = await createTalkFromCompanyPage(pageBob, disabledPayload);
    const disabledTalkData = { ...disabledPayload, id: disabledTalkId, authorId: bobIdentity.id };
    expect(await deliverTalkToReceiver(pageBob, pageTom, bobIdentity, tomIdentity, disabledTalkId, disabledTalkData, false)).toMatchObject({
      registered: true,
      autoResponded: false,
      reason: 'chatbot_disabled',
    });

    await pageTom.locator('#settings-chatbot-enabled').check();
    await expect
      .poll(() => pageTom!.evaluate(() => localStorage.getItem('chatbotEnabled')))
      .toBe('true');

    // Bob sends another context with Apple available and Banana absent.
    // In direct P2P mode Tom's browser owns exact memory, so it pre-fills Apple locally
    // and Tom confirms the reviewed auto answer.
    const reusePayload = fruitTalk(TITLE_REUSE_APPLE, 'a_apple', 'Apple', 'a_pear_ignore', 'Pear');
    const reuseTalkId = await createTalkFromCompanyPage(pageBob, reusePayload);
    const reuseTalkData = { ...reusePayload, id: reuseTalkId, authorId: bobIdentity.id };
    expect(await deliverTalkToReceiver(pageBob, pageTom, bobIdentity, tomIdentity, reuseTalkId, reuseTalkData, true)).toMatchObject({
      registered: true,
      autoResponded: false,
    });
    await waitForIncomingTalkClusterOnLocalGun(pageTom, TITLE_REUSE_APPLE, { timeout: 60_000, polling: 500 });
    await syncIncomingFromServer(pageTom);
    await openIncomingTalkModalWithAutoAnswers(pageTom, TITLE_REUSE_APPLE);
    const reviewModal = pageTom.locator('#talk-response-modal');
    await expect(reviewModal.locator('input[type="radio"][data-answer-id="a_apple"]')).toBeChecked({ timeout: 30_000 });
    await reviewModal.locator('#review-submit-btn').click();
    await waitForResponseModalClosed(pageTom);
    await waitForRecordedResponse(pageTom, reuseTalkId);
  });
});
