/**
 * Version-2 contextual chatbot memory:
 * Bob teaches a root answer once. The chatbot can carry that exact question frame into any later
 * flow position, while reordered choices remain equivalent and changed membership remains new.
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
  resetTalksMatchingSession,
  syncIncomingFromServer,
  waitForIncomingTalkClusterOnLocalGun,
  waitForResponseModalClosed,
  waitForTabActive,
} from '../../helpers/talks-matching-flow';
import { createFlowOrSurveyTalkViaEditor } from '../../helpers/talk-demo-ui';
import { gunBaseURL, isDirectTalkDeliveryE2e } from '../../helpers/ports';
import { dismissNotificationOverlays } from '../../helpers/durable-ui';

const QUESTION = 'Which fruit do you like?';
const INTRO_QUESTION = 'Do you like fruits?';
const TITLE_ADAM = 'E2E Root Fruit Adam';
const TITLE_ALICE = 'E2E Reordered Fruit Alice';
const TITLE_TOM = 'E2E Changed Fruit Tom';
const TITLE_JERRY = 'E2E Nested Fruit Jerry';

async function createFruitTalk(
  page: Page,
  title: string,
  choices: string[],
  afterIntro = false,
): Promise<{ talkId: string; talkData: any }> {
  await dismissNotificationOverlays(page);
  const created = await createFlowOrSurveyTalkViaEditor(page, {
    title,
    type: 'flow',
    questions: [
      ...(afterIntro
        ? [{
            text: INTRO_QUESTION,
            answers: [
              { text: 'Yes', outcome: 'next' as const },
              { text: 'No', outcome: 'ignore' as const },
            ],
          }]
        : []),
      {
        text: QUESTION,
        answers: choices.map((choice) => ({
          text: choice,
          outcome: choice.toLowerCase() === 'apple' ? 'match' as const : 'ignore' as const,
        })),
      },
    ],
  });
  return { talkId: created.talkId, talkData: created.talkData };
}

async function chooseRememberedAnswer(page: Page, questionText: string, answerText: string): Promise<void> {
  const modal = page.locator('#talk-response-modal');
  await expect(modal.locator('.modal-content')).toContainText(questionText, { timeout: 60_000 });
  const radio = modal.locator(`input.choice-radio[data-answer-text="${answerText}"][data-mode="auto"]`).first();
  await expect(radio).toBeVisible({ timeout: 30_000 });
  await radio.click();
  await waitForResponseModalClosed(page);
  await afterSync();
}

async function joinGlobal(page: Page): Promise<void> {
  // This spec covers same-context memory; the app default is now "Whenever offered".
  await page.evaluate(() => localStorage.setItem('iinpublic_auto_answer_scope', 'same-context'));
  await page.click('.chatroom-item:has-text("Global")');
  await waitForTabActive(page, 'chatrooms');
  await afterSync();
}

async function openTalkDataWithAutoAnswers(page: Page, talkData: any): Promise<void> {
  await page.evaluate((talk) => {
    const app = (window as any).__iinpublic_app?.getApp?.();
    if (!app?.uiManager?.showTalkResponseDialog) throw new Error('showTalkResponseDialog unavailable');
    app.uiManager.showTalkResponseDialog(talk, { skipAutoAnswer: false });
  }, talkData);
  await page.waitForSelector('#talk-response-modal .modal-content', { timeout: 30_000 });
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

async function completedAnswerTexts(page: Page, talkId: string): Promise<string[]> {
  return page.evaluate((id) => {
    const talks = JSON.parse(localStorage.getItem('myTalks') || '{}');
    const direct = talks[id];
    const entry = direct || Object.values(talks).find((candidate: any) =>
      candidate?.talkId === id || candidate?.fullTalk?.id === id,
    );
    return Array.isArray((entry as any)?.completedAnswers)
      ? (entry as any).completedAnswers.map((answer: any) => String(answer?.answerText || ''))
      : [];
  }, talkId);
}

test.describe('Talks matching — contextual chatbot Q/A memory', () => {
  let browsers: ThreeBrowsers;
  let browserTom: Browser;
  let browserJerry: Browser;
  let browserBob: Browser;
  let contextTom: BrowserContext | undefined;
  let contextJerry: BrowserContext | undefined;
  let contextBob: BrowserContext | undefined;
  let contextAdam: BrowserContext | undefined;
  let contextAlice: BrowserContext | undefined;
  let pageTom: Page | undefined;
  let pageJerry: Page | undefined;
  let pageBob: Page | undefined;
  let pageAdam: Page | undefined;
  let pageAlice: Page | undefined;

  test.beforeAll(async () => {
    await clearGunForStage3Spec();
    browsers = await launchThreeBrowsers();
    browserTom = browsers.tom;
    browserJerry = browsers.jerry;
    browserBob = browsers.bob;
  });

  test.beforeEach(async () => {
    for (const page of [pageAdam, pageAlice]) {
      await page?.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup()).catch(() => {});
      await page?.close().catch(() => {});
    }
    await contextAdam?.close().catch(() => {});
    await contextAlice?.close().catch(() => {});
    await resetTalksMatchingSession(
      { tom: pageTom, jerry: pageJerry, bob: pageBob },
      { tom: contextTom, jerry: contextJerry, bob: contextBob },
      clearGunForStage3Spec,
    );
    pageAdam = pageAlice = pageTom = pageJerry = pageBob = undefined;
    contextAdam = contextAlice = contextTom = contextJerry = contextBob = undefined;
  });

  test.afterAll(async () => {
    for (const page of [pageAdam, pageAlice]) {
      await page?.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup()).catch(() => {});
      await page?.close().catch(() => {});
    }
    await contextAdam?.close().catch(() => {});
    await contextAlice?.close().catch(() => {});
    await finalCleanupPages(
      { tom: pageTom, jerry: pageJerry, bob: pageBob },
      { tom: contextTom, jerry: contextJerry, bob: contextBob },
    );
    await shutdownThreeBrowsers(browsers);
    await clearGunForStage3Spec();
  });

  test('reuses Bob\'s root fruit choice across order and position, but not changed membership', async () => {
    const adam = await bootstrapUser(browserTom, 'Adam', 'Adam');
    contextAdam = adam.context;
    pageAdam = adam.page;
    await joinGlobal(pageAdam);

    const alice = await bootstrapUser(browserJerry, 'Alice', 'Alice');
    contextAlice = alice.context;
    pageAlice = alice.page;
    await joinGlobal(pageAlice);

    const tom = await bootstrapUser(browserTom, 'Tom', 'Tom');
    contextTom = tom.context;
    pageTom = tom.page;
    await joinGlobal(pageTom);

    const jerry = await bootstrapUser(browserJerry, 'Jerry', 'Jerry');
    contextJerry = jerry.context;
    pageJerry = jerry.page;
    await joinGlobal(pageJerry);

    const bob = await bootstrapUser(browserBob, 'Bob', 'Bob');
    contextBob = bob.context;
    pageBob = bob.page;
    await joinGlobal(pageBob);

    const adamIdentity = await currentUser(pageAdam);
    const aliceIdentity = await currentUser(pageAlice);
    const tomIdentity = await currentUser(pageTom);
    const jerryIdentity = await currentUser(pageJerry);
    const bobIdentity = await currentUser(pageBob);

    // Adam teaches Bob a root default for the complete Apple/Banana/Pears frame.
    const { talkId: adamTalkId, talkData: adamTalkData } = await createFruitTalk(
      pageAdam,
      TITLE_ADAM,
      ['Apple', 'Banana', 'Pears'],
    );
    expect(await deliverTalkToReceiver(pageAdam, pageBob, adamIdentity, bobIdentity, adamTalkId, adamTalkData)).toMatchObject({
      registered: true,
      autoResponded: false,
    });
    await waitForIncomingTalkClusterOnLocalGun(pageBob, TITLE_ADAM, { timeout: 60_000, polling: 500 });
    await syncIncomingFromServer(pageBob);
    await openTalkDataWithAutoAnswers(pageBob, adamTalkData);
    await chooseRememberedAnswer(pageBob, QUESTION, 'Apple');
    await waitForRecordedResponse(pageBob, adamTalkId);
    await waitForContextualMemoryAnswer(pageBob, 'Apple');

    // Alice changes display order only. The root hash is identical, so Apple is pre-filled.
    const { talkId: aliceTalkId, talkData: aliceTalkData } = await createFruitTalk(
      pageAlice,
      TITLE_ALICE,
      ['Banana', 'Pears', 'Apple'],
    );
    expect(await deliverTalkToReceiver(pageAlice, pageBob, aliceIdentity, bobIdentity, aliceTalkId, aliceTalkData)).toMatchObject({
      registered: true,
      autoResponded: false,
    });
    await waitForIncomingTalkClusterOnLocalGun(pageBob, TITLE_ALICE, { timeout: 60_000, polling: 500 });
    await syncIncomingFromServer(pageBob);
    // Adam and Alice's talks deliberately have the same normalized content identity, so the
    // incoming list groups them. Open Alice's delivered payload directly instead of depending
    // on a second visible row; this is the response path the grouped row invokes internally.
    await openTalkDataWithAutoAnswers(pageBob, aliceTalkData);
    const review = pageBob.locator('#talk-response-modal');
    await expect(review.locator(`input[type="radio"][data-answer-text="Apple"]`)).toBeChecked();
    await expect(review.locator('.modal-content')).toContainText('(pre-filled)');
    await review.locator('#review-submit-btn').click();
    await waitForResponseModalClosed(pageBob);
    await waitForRecordedResponse(pageBob, aliceTalkId);

    // Tom changes Pears to Kiwi. Apple is still present, but the frame is different; Bob must
    // answer personally and can teach a separate root context.
    const { talkId: tomTalkId, talkData: tomTalkData } = await createFruitTalk(
      pageTom,
      TITLE_TOM,
      ['Banana', 'Kiwi', 'Apple'],
    );
    expect(await deliverTalkToReceiver(pageTom, pageBob, tomIdentity, bobIdentity, tomTalkId, tomTalkData)).toMatchObject({
      registered: true,
      autoResponded: false,
    });
    await waitForIncomingTalkClusterOnLocalGun(pageBob, TITLE_TOM, { timeout: 60_000, polling: 500 });
    await syncIncomingFromServer(pageBob);
    await openTalkDataWithAutoAnswers(pageBob, tomTalkData);
    const changedModal = pageBob.locator('#talk-response-modal');
    await expect(changedModal.locator('.modal-content')).toContainText(QUESTION);
    await expect(changedModal.locator('#review-submit-btn')).toHaveCount(0);
    await chooseRememberedAnswer(pageBob, QUESTION, 'Apple');
    await waitForRecordedResponse(pageBob, tomTalkId);

    // Jerry asks an unknown root question first. Once Bob manually chooses Yes, the identical
    // fruit frame appears at Q2. Bob's original root Apple default follows it to this position.
    const { talkId: jerryTalkId, talkData: jerryTalkData } = await createFruitTalk(
      pageJerry,
      TITLE_JERRY,
      ['Banana', 'Pears', 'Apple'],
      true,
    );
    expect(await deliverTalkToReceiver(pageJerry, pageBob, jerryIdentity, bobIdentity, jerryTalkId, jerryTalkData)).toMatchObject({
      registered: true,
      autoResponded: false,
    });
    await waitForIncomingTalkClusterOnLocalGun(pageBob, TITLE_JERRY, { timeout: 60_000, polling: 500 });
    await syncIncomingFromServer(pageBob);
    await openTalkDataWithAutoAnswers(pageBob, jerryTalkData);
    await chooseRememberedAnswer(pageBob, INTRO_QUESTION, 'Yes');
    await waitForRecordedResponse(pageBob, jerryTalkId);
    await expect.poll(() => completedAnswerTexts(pageBob!, jerryTalkId), {
      timeout: 30_000,
      intervals: [300, 600, 1000],
    }).toEqual(['Yes', 'Apple']);
  });
});
