/**
 * Version-2 contextual chatbot memory:
 * Tom sees the same question with different complete choice sets. The chatbot must ask whenever
 * that context changes, then repeat Tom's choice when the identical question + choice set returns.
 */
import { Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage3Spec } from '../../helpers/e2e-stage-pipeline';
import { afterSync } from '../../helpers/timing';
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
import { createFlowOrSurveyTalkViaEditor } from '../../helpers/talk-demo-ui';
import { gunBaseURL, isDirectTalkDeliveryE2e } from '../../helpers/ports';
import { dismissNotificationOverlays } from '../../helpers/durable-ui';

const QUESTION = 'Favorite fruit?';
const TITLE_APPLE = 'E2E Exact Memory Context A';
const TITLE_BANANA = 'E2E Exact Memory Context B';
const TITLE_REUSE_APPLE = 'E2E Exact Memory Reuse Apple';

/** Every fruit talk is a single question, match answer first (real UI id `a_0_0`), ignore
 *  answer second (`a_0_1`) — deterministic from array position, `processTalkForm` (talk-form-processor.ts). */
const FRUIT_MATCH_ID = 'a_0_0';

async function createFruitTalk(
  page: Page,
  title: string,
  matchText: string,
  otherText: string,
  withFollowup = false,
): Promise<{ talkId: string; talkData: any }> {
  await dismissNotificationOverlays(page);
  const created = await createFlowOrSurveyTalkViaEditor(page, {
    title,
    type: 'flow',
    questions: [
      {
        text: QUESTION,
        answers: [
          { text: matchText, outcome: withFollowup ? 'next' : 'match' },
          { text: otherText, outcome: 'ignore' },
        ],
      },
      ...(withFollowup
        ? [{
            text: 'How do you like it?',
            answers: [{ text: 'Fresh', outcome: 'match' as const }, { text: 'Cooked', outcome: 'ignore' as const }],
          }]
        : []),
    ],
  });
  return { talkId: created.talkId, talkData: created.talkData };
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
    const maxAttempts = 5;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
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
        if (attempt === maxAttempts - 1) {
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

async function waitForContextualMemoryAnswer(page: Page, answerText: string): Promise<void> {
  await expect
    .poll(
      () => page.evaluate((expected) => {
        try {
          const parsed = JSON.parse(localStorage.getItem('flattenedAnswerPreferences') || '{}');
          return Object.entries(parsed).some(([key, value]: [string, any]) =>
            key.startsWith('flat_v2_')
            && value?.contextVersion === 2
            && value?.answerText === expected,
          );
        } catch {
          return false;
        }
      }, answerText),
      { timeout: 30_000, intervals: [300, 600, 1000] },
    )
    .toBe(true);
}

test.describe('Talks matching — contextual chatbot Q/A memory', () => {
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
    await clearGunForStage3Spec();
    browsers = await launchThreeBrowsers();
    browserTom = browsers.tom;
    browserJerry = browsers.jerry;
    browserBob = browsers.bob;
  });

  test.beforeEach(async () => {
    await resetTalksMatchingSession(
      { tom: pageTom, jerry: pageJerry, bob: pageBob },
      { tom: contextTom, jerry: contextJerry, bob: contextBob },
      clearGunForStage3Spec,
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
    await clearGunForStage3Spec();
  });

  test('asks on a changed choice set, then repeats Apple when the identical context returns', async () => {
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

    // Context A: Jerry asks Favorite fruit? with the Apple/Banana choice set. Tom asks the
    // chatbot to remember Apple for this exact context.
    const { talkId: appleTalkId, talkData: appleTalkData } = await createFruitTalk(pageJerry, TITLE_APPLE, 'Apple', 'Banana');
    expect(await deliverTalkToReceiver(pageJerry, pageTom, jerryIdentity, tomIdentity, appleTalkId, appleTalkData)).toMatchObject({
      registered: true,
      autoResponded: false,
    });
    await waitForIncomingTalkClusterOnLocalGun(pageTom, TITLE_APPLE, { timeout: 60_000, polling: 500 });
    await syncIncomingFromServer(pageTom);
    await openIncomingTalkModal(pageTom, TITLE_APPLE);
    await chooseAutoAnswer(pageTom, FRUIT_MATCH_ID);
    await waitForRecordedResponse(pageTom, appleTalkId);
    await waitForContextualMemoryAnswer(pageTom, 'Apple');

    // Context B: same exact question, but Apple is absent. Auto mode must not answer;
    // the modal is dispatched to Tom so he can choose Banana.
    const { talkId: bananaTalkId, talkData: bananaTalkData } = await createFruitTalk(pageJerry, TITLE_BANANA, 'Banana', 'Mango');
    expect(await deliverTalkToReceiver(pageJerry, pageTom, jerryIdentity, tomIdentity, bananaTalkId, bananaTalkData)).toMatchObject({
      registered: true,
      autoResponded: false,
    });
    await waitForIncomingTalkClusterOnLocalGun(pageTom, TITLE_BANANA, { timeout: 60_000, polling: 500 });
    await syncIncomingFromServer(pageTom);
    await openIncomingTalkModalWithAutoAnswers(pageTom, TITLE_BANANA);
    const modal = pageTom.locator('#talk-response-modal');
    await expect(modal.locator('.modal-content')).toContainText(QUESTION, { timeout: 60_000 });
    await expect(modal.locator(`input.choice-radio[data-answer-id="${FRUIT_MATCH_ID}"][data-mode="auto"]`)).toBeVisible();
    await chooseAutoAnswer(pageTom, FRUIT_MATCH_ID);
    await waitForRecordedResponse(pageTom, bananaTalkId);
    await waitForContextualMemoryAnswer(pageTom, 'Banana');

    // Bob sends the identical Apple/Banana first-question context inside a different two-question
    // talk. Its different content identity bypasses exchange suppression, while Q1's normalized
    // frame stays identical. The modal opening directly on Q2 proves Apple was repeated for Q1.
    const { talkId: reuseTalkId, talkData: reuseTalkData } = await createFruitTalk(
      pageBob,
      TITLE_REUSE_APPLE,
      'Apple',
      'Banana',
      true,
    );
    expect(await deliverTalkToReceiver(pageBob, pageTom, bobIdentity, tomIdentity, reuseTalkId, reuseTalkData, true)).toMatchObject({
      registered: true,
      autoResponded: false,
    });
    await waitForIncomingTalkClusterOnLocalGun(pageTom, TITLE_REUSE_APPLE, { timeout: 60_000, polling: 500 });
    await syncIncomingFromServer(pageTom);
    await openIncomingTalkModalWithAutoAnswers(pageTom, TITLE_REUSE_APPLE);
    const reviewModal = pageTom.locator('#talk-response-modal');
    await expect(reviewModal.locator('.modal-content')).toContainText('How do you like it?', { timeout: 30_000 });
    await expect(reviewModal.locator('.modal-content')).not.toContainText(QUESTION);
    await reviewModal.locator('input.choice-radio[data-answer-text="Fresh"][data-mode="manual"]').click();
    await waitForResponseModalClosed(pageTom);
    await waitForRecordedResponse(pageTom, reuseTalkId);
  });
});
