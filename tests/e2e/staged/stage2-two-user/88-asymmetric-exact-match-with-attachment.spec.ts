/**
 * Asymmetric unidirectional exact match + mutual deal confirmation + IPFS photo auto-share
 * (spec §30.2).
 *
 * Eve (seller) lists many attributes of her iPhone on a separate, detailed matchThreshold route
 * talk (color / condition / storage) for buyers who care about specifics. But Adam (buyer) just
 * wants "an iPhone, any condition" — he should never have to walk through Eve's detailed spec
 * tree to get a match. So Eve ALSO authors a minimal, single-question exact-match talk with her
 * photo attached. Adam responds to ONLY that simple talk: an exact, unidirectional match decided
 * purely by his one answer, entirely independent of Eve's separate detailed listing — which he
 * never opens, and which never blocks or dilutes the match. Matching is inherently one-directional
 * per exchange (`checkIfMatch` only ever evaluates the *responder's* answers against the *matched
 * talk's* own structure), so this asymmetry falls out of the existing engine with zero new code —
 * see the two-talk pattern in `docs/TODO.md` §BB and `80-route-multi-spec-match-percent.spec.ts`
 * for the companion "buyer cares about specifics" case.
 *
 * The match auto-shares Eve's IPFS-attached photo into their conversation
 * (`autoShareMatchedTalkAttachments`, app.ts) — the link, never the raw bytes, rides the
 * conversation channel. A "deal" is a SEPARATE, bidirectional step layered on top: the match
 * alone isn't exclusive or final (spec §30.2 replaced the old automatic busy-guard) — both Adam
 * and Eve must independently click "Confirm Deal" before Eve's matched talk disables. Eve's
 * separate detailed route talk is untouched by this: it declares no Pair-tag question
 * (docs/TODO.md §LL follow-up, `Question.reciprocalTagContext`), so it isn't deal-eligible
 * (`isDealEligibleTalk`, app.ts) and stays enabled after the simple talk's deal is confirmed — a
 * real, documented gap in `maybeFinalizeConfirmedDeal` (app.ts) that happens to give the right
 * answer here (it disables every deal-eligible talk the confirming user owns, not just the one
 * that matched; the detailed talk simply never qualifies).
 */
import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { afterAction, afterSync, headless } from '../../helpers/timing';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';
import {
  answerSurveyByAnswerIds,
  clickBroadcastUntilBulkAck,
  createFlowOrSurveyTalkViaEditor,
  createRouteTalkViaEditor,
  expectTalkResponsesLine,
  talkRouteQuestionsToUiSpec,
  waitForDistinctGunPeersExcludingSelf,
} from '../../helpers/talk-demo-ui';
import { bootstrapUser, waitForTabActive } from '../../helpers/talks-matching-flow';

const RUN_ID = 880100;
const SIMPLE_TITLE = `Selling an iPhone ${RUN_ID}`;
const DETAILED_TITLE = `iPhone full specs ${RUN_ID}`;
const ATTACHMENT_NAME = 'iphone.jpg';
const ATTACHMENT_BYTES_TEXT = `E2E fake iPhone photo bytes ${RUN_ID}`;

/** The picky-buyer path (§30.2 matchThreshold route) — exists purely to prove Adam never has to
 *  touch it. Declares no Pair-tag question, so it is also never deal-eligible. */
function buildDetailedRouteTalkPayload(): Record<string, unknown> {
  return {
    id: `demo-detailed-iphone-${RUN_ID}`,
    title: DETAILED_TITLE,
    authorId: 'eve',
    type: 'route',
    matchThreshold: 2,
    isAdult: false,
    language: 'en',
    tags: [],
    createdAt: new Date(),
    isTemplate: false,
    usageCount: 0,
    questions: [
      {
        id: 'q_root',
        text: 'iPhone specs',
        contextPath: [],
        answers: [
          { id: 'a_root_color', text: 'Color', nextQuestionId: 'q_color' },
          { id: 'a_root_condition', text: 'Condition', nextQuestionId: 'q_condition' },
          { id: 'a_root_storage', text: 'Storage', nextQuestionId: 'q_storage' },
        ],
      },
      {
        id: 'q_color',
        text: 'Is it white?',
        contextPath: [{ questionId: 'q_root', answerId: 'a_root_color' }],
        answers: [
          { id: 'a_color_yes', text: 'White', isMatch: true, isTerminal: true },
          { id: 'a_color_no', text: 'Not white', isIgnore: true, isTerminal: true },
        ],
      },
      {
        id: 'q_condition',
        text: 'Is it used?',
        contextPath: [{ questionId: 'q_root', answerId: 'a_root_condition' }],
        answers: [
          { id: 'a_condition_yes', text: 'Used', isMatch: true, isTerminal: true },
          { id: 'a_condition_no', text: 'Not used', isIgnore: true, isTerminal: true },
        ],
      },
      {
        id: 'q_storage',
        text: 'Is it 128GB?',
        contextPath: [{ questionId: 'q_root', answerId: 'a_root_storage' }],
        answers: [
          { id: 'a_storage_yes', text: '128GB', isMatch: true, isTerminal: true },
          { id: 'a_storage_no', text: 'Not 128GB', isIgnore: true, isTerminal: true },
        ],
      },
    ],
  };
}

async function getConversationIdForPeer(page: Page, peerId: string): Promise<string> {
  return page.evaluate((otherUserId) => {
    const conversations = JSON.parse(localStorage.getItem('myConversations') || '{}');
    const hit = Object.entries(conversations).find(([, value]: [string, any]) =>
      value?.otherUserId === otherUserId && value?.supportChannel !== true,
    );
    return String(hit?.[0] || '');
  }, peerId);
}

async function isTalkDisabled(page: Page, title: string): Promise<boolean> {
  return page.evaluate((needle: string) => {
    const talks = JSON.parse(localStorage.getItem('myTalks') || '{}');
    return Object.values(talks).some((t: any) => t?.title === needle && t?.disabled === true);
  }, title);
}

/** Opens the conversation with `otherUserId` and clicks "Confirm Deal" (spec §30.2's
 *  bidirectional finalization step, replacing the old automatic busy-guard). */
async function confirmDealWith(page: Page, otherUserId: string): Promise<string> {
  const conversationId = await getConversationIdForPeer(page, otherUserId);
  expect(conversationId).toBeTruthy();
  await page.evaluate((cid: string) => {
    (window as any).__iinpublic_app?.getApp?.()?.uiManager?.showConversationDetail?.(cid);
  }, conversationId);
  await expect(page.locator('#conversation-detail-overlay')).toBeVisible({ timeout: 20_000 });
  const confirmBtn = page.locator('#conversation-confirm-deal-btn');
  await expect(confirmBtn).toBeVisible({ timeout: 10_000 });
  await confirmBtn.click();
  await afterSync();
  return conversationId;
}

test.describe('Asymmetric exact match (buyer wants "any iPhone") + IPFS photo auto-share + mutual deal confirmation (§30.2)', () => {
  let browserEve: Browser;
  let browserAdam: Browser;
  let contextEve: BrowserContext | undefined;
  let contextAdam: BrowserContext | undefined;
  let pageEve: Page | undefined;
  let pageAdam: Page | undefined;

  test.beforeEach(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage2Spec();
    const mk = (x: number) => ({
      headless,
      args: [...WEBRTC_CHROMIUM_ARGS, `--window-position=${x},0`, '--window-size=640,900', '--force-device-scale-factor=1'],
    });
    [browserEve, browserAdam] = await Promise.all([chromium.launch(mk(0)), chromium.launch(mk(650))]);
  });

  test.afterEach(async () => {
    for (const page of [pageEve, pageAdam]) {
      await page?.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
    }
    await Promise.all([contextEve?.close?.().catch(() => {}), contextAdam?.close?.().catch(() => {})]);
    await Promise.all([browserEve?.close().catch(() => {}), browserAdam?.close().catch(() => {})]);
    await clearGunForStage2Spec();
  });

  test('buyer matches seller\'s simple ask (not her detailed listing); photo auto-shares; deal needs both sides', async () => {
    test.setTimeout(300_000);

    const eve = await bootstrapUser(browserEve, 'Eve', 'Eve Seller');
    contextEve = eve.context;
    pageEve = eve.page;
    await pageEve.click('.chatroom-item:has-text("Global")');
    await afterSync();

    const adam = await bootstrapUser(browserAdam, 'Adam', 'Adam Buyer');
    contextAdam = adam.context;
    pageAdam = adam.page;
    await pageAdam.click('.chatroom-item:has-text("Global")');
    await afterSync();

    const [eveId, adamId] = await Promise.all([
      pageEve.evaluate(() => String((window as any).__iinpublic_app?.getApp?.()?.currentUser?.id || '')),
      pageAdam.evaluate(() => String((window as any).__iinpublic_app?.getApp?.()?.currentUser?.id || '')),
    ]);
    expect(eveId).toBeTruthy();
    expect(adamId).toBeTruthy();

    // --- Eve authors the simple talk with a real photo attached through the editor's own file
    // input — the same `publishMediaFileToIpfs` path a real user's file picker selection
    // triggers (app.ts); no separate content-node bypass needed. ---
    // Q1 is a Pair-tag declaration (docs/TODO.md §LL follow-up, `Question.reciprocalTagContext`
    // — replaces the removed root-level `#talk-tag` field) so this talk stays deal-eligible
    // (`isDealEligibleTalk`, app.ts) for the mutual "Confirm Deal" step exercised below; Adam
    // answers it ('buy', the one non-ignore choice) before reaching the real question.
    const simpleTalk = await createFlowOrSurveyTalkViaEditor(pageEve, {
      title: SIMPLE_TITLE,
      type: 'flow',
      questions: [
        {
          text: 'sell',
          reciprocalTagContext: true,
          answers: [
            { text: 'buy', outcome: 'next', self: true },
            { text: 'Not interested', outcome: 'ignore' },
          ],
        },
        {
          text: 'Want to buy an iPhone (any condition)?',
          answers: [{ text: 'Yes, any condition works', outcome: 'match' }, { text: 'No thanks', outcome: 'ignore' }],
        },
      ],
      attachment: { name: ATTACHMENT_NAME, mimeType: 'image/jpeg', buffer: Buffer.from(ATTACHMENT_BYTES_TEXT) },
    });
    const attachment = simpleTalk.talkData.ipfsAttachments?.[0];
    expect(attachment?.cid).toBeTruthy();

    const detailedPayload = buildDetailedRouteTalkPayload();
    await createRouteTalkViaEditor(pageEve, {
      title: DETAILED_TITLE,
      root: talkRouteQuestionsToUiSpec(detailedPayload.questions as any[]),
      matchThreshold: detailedPayload.matchThreshold as number,
    });

    await pageEve.click('.nav-btn[data-view="chatrooms"]');
    await afterSync();
    await waitForDistinctGunPeersExcludingSelf(pageEve, 1, 120_000);
    await clickBroadcastUntilBulkAck(pageEve);

    // --- Adam responds ONLY to the simple talk — exact, unidirectional match. Two answers now:
    // the Pair-tag Q1 ('buy', the one non-ignore choice) then the real Q2 match answer. ---
    await answerSurveyByAnswerIds(pageAdam, SIMPLE_TITLE, ['a_0_0', 'a_1_0'], simpleTalk.talkId);

    await expect
      .poll(() => getConversationIdForPeer(pageAdam!, eveId), { timeout: 30_000, message: 'Adam: match conversation with Eve missing' })
      .not.toBe('');
    await expect
      .poll(() => getConversationIdForPeer(pageEve!, adamId), { timeout: 30_000, message: 'Eve: match conversation with Adam missing' })
      .not.toBe('');

    // --- Asymmetry: the simple talk recorded Adam's response; the detailed route talk never did ---
    await expectTalkResponsesLine(pageEve, SIMPLE_TITLE, 1);
    await pageEve.click('.nav-btn[data-view="talks"]');
    await waitForTabActive(pageEve, 'talks');
    await afterSync();
    const detailedRow = pageEve.locator('.talk-list-item[data-role="created"]').filter({ hasText: DETAILED_TITLE });
    await expect(detailedRow.first()).toBeVisible({ timeout: 15_000 });
    await expect(detailedRow.first().locator('.talk-item-status-summary')).not.toContainText('Responses: 1');

    // --- Eve's photo auto-shares into the resulting conversation on both sides ---
    const conversationId = await getConversationIdForPeer(pageAdam, eveId);
    await pageAdam.evaluate((cid: string) => {
      (window as any).__iinpublic_app?.getApp?.()?.uiManager?.showConversationDetail?.(cid);
    }, conversationId);
    await expect(pageAdam.locator('#conversation-detail-overlay')).toBeVisible({ timeout: 15_000 });
    const adamAttachmentChip = pageAdam.locator(`[data-testid="ipfs-attachment"][data-ipfs-cid="${attachment.cid}"]`);
    await expect(adamAttachmentChip).toBeVisible({ timeout: 30_000 });
    await expect(adamAttachmentChip).toHaveAttribute('data-ipfs-name', ATTACHMENT_NAME);

    await pageEve.evaluate((cid: string) => {
      (window as any).__iinpublic_app?.getApp?.()?.uiManager?.showConversationDetail?.(cid);
    }, conversationId);
    await expect(pageEve.locator('#conversation-detail-overlay')).toBeVisible({ timeout: 15_000 });
    await expect(pageEve.locator(`[data-testid="ipfs-attachment"][data-ipfs-cid="${attachment.cid}"]`))
      .toBeVisible({ timeout: 30_000 });

    // --- Deal is a separate, mutual step: one side confirming isn't enough ---
    await confirmDealWith(pageEve, adamId);
    await expect(pageEve.locator('#conversation-deal-status')).toContainText('Waiting for the other side', { timeout: 10_000 });
    expect(await isTalkDisabled(pageEve, SIMPLE_TITLE)).toBe(false);

    await confirmDealWith(pageAdam, eveId);
    await expect(pageAdam.locator('#conversation-deal-status')).toContainText('Deal confirmed', { timeout: 15_000 });

    await pageEve.evaluate((cid: string) => {
      (window as any).__iinpublic_app?.getApp?.()?.uiManager?.showConversationDetail?.(cid);
    }, conversationId);
    await expect(pageEve.locator('#conversation-deal-status')).toContainText('Deal confirmed', { timeout: 15_000 });

    // --- Only the matched (deal-eligible) simple talk disables; the un-deal-eligible detailed
    // route listing — which Adam never engaged — is left alone. ---
    await expect.poll(() => isTalkDisabled(pageEve!, SIMPLE_TITLE), { timeout: 15_000 }).toBe(true);
    expect(await isTalkDisabled(pageEve, DETAILED_TITLE)).toBe(false);

    await afterAction();
  });
});
