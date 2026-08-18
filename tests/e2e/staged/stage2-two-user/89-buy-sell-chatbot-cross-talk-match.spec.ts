/**
 * Two independently-authored buy/sell talks match each other via the chatbot's flattened,
 * context-aware answer store — docs/TODO.md §KK.
 *
 * Adam authors "Buy iPhone" (`selfTag: 'buy'`, `preferenceSet: ['sell']`) and self-answers it
 * (Item: iPhone, Model: 16 Pro, Capacity: 128GB) while creating it — exactly what a real user
 * does by filling in their own Me-tab preferences. Eve authors "Sell iPhone" (mirror image:
 * `selfTag: 'sell'`, `preferenceSet: ['buy']`) with the SAME question wording and self-answers
 * it with the same values (a genuinely compatible listing).
 *
 * Neither ever manually answers the OTHER's talk. Each side's chatbot auto-resolves the
 * incoming talk entirely from its own flattened Q&A store (`resolveAnswerPreferenceForTalkQuestion`
 * → `buildAnswerPreferenceLookupKey`, tag-scoped per §KK) — the two talks are different objects
 * with different content hashes and different internal answer ids; only the identically-worded
 * question chain and the tag-context match. This is the "flatten into Me tab, match any incoming
 * talk against it" model, not talk-vs-talk comparison — see the §KK design discussion.
 *
 * Both broadcasts happen, so this proves the "two unidirectional matches, one converged
 * conversation" shape the design was built for: Eve's chatbot resolves Adam's incoming "buy"
 * talk, and separately Adam's chatbot resolves Eve's incoming "sell" talk — both land on the
 * same `conv_pair_<sortedIds>` conversation.
 */
import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { afterSync, afterAction, headless } from '../../helpers/timing';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';
import { bootstrapUser, waitForTabActive } from '../../helpers/talks-matching-flow';
import { createTalksFromCompanyPage, clickBroadcastUntilBulkAck, waitForDistinctGunPeersExcludingSelf } from '../../helpers/talk-demo-ui';
import { openSettingsSection, SETTINGS_SECTION } from '../../helpers/settings-nav';

const RUN_ID = 890100;

/** Identically-worded 3-question chain (Item -> Model -> Capacity) for both sides — only the
 *  title, id, selfTag/preferenceSet, and self-answers differ. Question/answer wording must
 *  match byte-for-byte for the flattened context-hash path to resolve across the two talks. */
function buildQuestions() {
  return [
    {
      id: 'q_item',
      text: 'Which item?',
      answers: [
        { id: 'a_item_iphone', text: 'iPhone' },
        { id: 'a_item_ipad', text: 'iPad' },
      ],
    },
    {
      id: 'q_model',
      text: 'Model?',
      answers: [
        { id: 'a_model_16pro', text: '16 Pro' },
        { id: 'a_model_other', text: 'Other' },
      ],
    },
    {
      id: 'q_capacity',
      text: 'Capacity?',
      // Deliberately asymmetric (only 128GB matches) — the §KK collision test below needs a
      // real behavioral difference between "resolved from the right context" and "resolved
      // from the wrong one," not just two differently-worded but equally-valid answers.
      answers: [
        { id: 'a_capacity_128', text: '128GB', isMatch: true, isTerminal: true },
        { id: 'a_capacity_256', text: '256GB', isIgnore: true, isTerminal: true },
      ],
    },
  ];
}

function buildBuySellTalkPayload(role: 'buy' | 'sell'): Record<string, unknown> {
  const opposite = role === 'buy' ? 'sell' : 'buy';
  return {
    id: `demo-${role}-iphone-${RUN_ID}`,
    title: `${role === 'buy' ? 'Buy' : 'Sell'} iPhone ${RUN_ID}`,
    authorId: role,
    type: 'flow',
    selfTag: role,
    preferenceSet: [opposite],
    isAdult: false,
    language: 'en',
    tags: [],
    createdAt: new Date(),
    isTemplate: false,
    usageCount: 0,
    questions: buildQuestions(),
    // Real users declare these while filling in the talk editor's own answers; `saveCreatedTalk`
    // writes each one to the flattened context-aware store (§KK) as well as exact-chatbot-memory.
    selfAnswers: [
      { questionId: 'q_item', answerId: 'a_item_iphone' },
      { questionId: 'q_model', answerId: 'a_model_16pro' },
      { questionId: 'q_capacity', answerId: 'a_capacity_128' },
    ],
  };
}

async function enableChatbot(page: Page): Promise<void> {
  await page.click('.nav-btn[data-view="settings"]');
  await openSettingsSection(page, SETTINGS_SECTION.talkBehavior);
  const chatbotCheckbox = page.locator('#settings-chatbot-enabled');
  if (!(await chatbotCheckbox.isChecked())) await chatbotCheckbox.click();
  await page.click('.nav-btn[data-view="talks"]');
  await waitForTabActive(page, 'talks');
}

async function getCurrentUserId(page: Page): Promise<string> {
  return page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.currentUser?.id ?? '');
}

async function hasConversationWith(page: Page, otherUserId: string): Promise<boolean> {
  return page.evaluate((otherUserId) => {
    const conversations = JSON.parse(localStorage.getItem('myConversations') || '{}');
    return Object.values(conversations).some(
      (c: any) => c && c.supportChannel !== true && String(c.otherUserId || '') === otherUserId,
    );
  }, otherUserId);
}

test.describe('Buy/sell talks match each other via chatbot cross-talk flattened matching (§KK)', () => {
  let browserAdam: Browser;
  let browserEve: Browser;
  let contextAdam: BrowserContext;
  let contextEve: BrowserContext;
  let pageAdam: Page;
  let pageEve: Page;

  test.beforeEach(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage2Spec();
    const mk = (x: number) => ({
      headless,
      args: [...WEBRTC_CHROMIUM_ARGS, `--window-position=${x},0`, '--window-size=640,900', '--force-device-scale-factor=1'],
    });
    [browserAdam, browserEve] = await Promise.all([chromium.launch(mk(0)), chromium.launch(mk(650))]);
  });

  test.afterEach(async () => {
    for (const page of [pageAdam, pageEve]) {
      await page?.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
    }
    await Promise.all([contextAdam?.close?.().catch(() => {}), contextEve?.close?.().catch(() => {})]);
    await Promise.all([browserAdam?.close().catch(() => {}), browserEve?.close().catch(() => {})]);
    await clearGunForStage2Spec();
  });

  test('Adam\'s buy-iPhone talk and Eve\'s sell-iPhone talk auto-match in both directions with zero manual clicks', async () => {
    test.setTimeout(300_000);

    const adam = await bootstrapUser(browserAdam, 'Adam', 'Adam BuySell');
    contextAdam = adam.context;
    pageAdam = adam.page;
    await pageAdam.click('.chatroom-item:has-text("Global")');
    await afterSync();
    await enableChatbot(pageAdam);

    const eve = await bootstrapUser(browserEve, 'Eve', 'Eve BuySell');
    contextEve = eve.context;
    pageEve = eve.page;
    await pageEve.click('.chatroom-item:has-text("Global")');
    await afterSync();
    await enableChatbot(pageEve);

    const [adamId, eveId] = await Promise.all([getCurrentUserId(pageAdam), getCurrentUserId(pageEve)]);
    expect(adamId).toBeTruthy();
    expect(eveId).toBeTruthy();

    // --- Each side authors and self-answers their OWN talk — this is what populates the
    // flattened, tag-scoped context store the other side's chatbot will read from. ---
    const [adamTalk] = await createTalksFromCompanyPage(pageAdam, [buildBuySellTalkPayload('buy')]);
    const [eveTalk] = await createTalksFromCompanyPage(pageEve, [buildBuySellTalkPayload('sell')]);
    expect(adamTalk).toBeTruthy();
    expect(eveTalk).toBeTruthy();

    // --- Both broadcast their own talk — nobody manually answers the other's. ---
    await pageAdam.click('.nav-btn[data-view="chatrooms"]');
    await afterSync();
    await waitForDistinctGunPeersExcludingSelf(pageAdam, 1, 120_000);
    await clickBroadcastUntilBulkAck(pageAdam);

    await pageEve.click('.nav-btn[data-view="chatrooms"]');
    await afterSync();
    await waitForDistinctGunPeersExcludingSelf(pageEve, 1, 120_000);
    await clickBroadcastUntilBulkAck(pageEve);

    // --- Two unidirectional chatbot matches converge on one conversation, on both sides. ---
    await expect
      .poll(() => hasConversationWith(pageAdam, eveId), { timeout: 60_000, message: 'Adam: no auto-matched conversation with Eve' })
      .toBe(true);
    await expect
      .poll(() => hasConversationWith(pageEve, adamId), { timeout: 60_000, message: 'Eve: no auto-matched conversation with Adam' })
      .toBe(true);

    await afterAction();
  });

  test('§KK: a second, differently-tagged same-item talk does not corrupt the chatbot\'s reply to the first', async () => {
    test.setTimeout(300_000);

    // Adam has TWO "iPhone" talks with identically-worded questions but different transaction
    // intent: "Buy iPhone" wants a seller (`preferenceSet: ['sell']`, declares exactly 16 Pro /
    // 128GB), "Buy Buddies iPhone" wants fellow buyers (`preferenceSet: ['buy']`, saved SECOND,
    // declares "Other" / 256GB). Both answer sets are valid OPTIONS on Eve's incoming sell-talk
    // (this matters: exact-chatbot-memory's own current-options-validity filter would otherwise
    // silently reject an invented value regardless of context, accidentally masking the bug this
    // test exists to catch — see the flattened-answer-keys.ts docs). 256GB is deliberately
    // `isIgnore`, not `isMatch`, on Eve's talk: without §KK's tag-scoped context key,
    // exact-chatbot-memory (keyed by question text alone, newest-first) would resolve Capacity
    // from the buddy-talk's 256GB instead of the seller-talk's 128GB, and Eve would get a
    // mismatch — a real, observable difference from a genuine match, not just "does anything
    // happen at all."
    const adam = await bootstrapUser(browserAdam, 'Adam', 'Adam Collision');
    contextAdam = adam.context;
    pageAdam = adam.page;
    await pageAdam.click('.chatroom-item:has-text("Global")');
    await afterSync();
    await enableChatbot(pageAdam);

    const eve = await bootstrapUser(browserEve, 'Eve', 'Eve Collision');
    contextEve = eve.context;
    pageEve = eve.page;
    await pageEve.click('.chatroom-item:has-text("Global")');
    await afterSync();
    await enableChatbot(pageEve);

    const [adamId, eveId] = await Promise.all([getCurrentUserId(pageAdam), getCurrentUserId(pageEve)]);

    const buyFromSellerTalk = {
      id: `demo-buy-iphone-seller-${RUN_ID}`,
      title: `Buy iPhone Seller ${RUN_ID}`,
      authorId: 'buy',
      type: 'flow',
      selfTag: 'buy',
      preferenceSet: ['sell'],
      isAdult: false,
      language: 'en',
      tags: [],
      createdAt: new Date(),
      isTemplate: false,
      usageCount: 0,
      questions: buildQuestions(),
      selfAnswers: [
        { questionId: 'q_item', answerId: 'a_item_iphone' },
        { questionId: 'q_model', answerId: 'a_model_16pro' },
        { questionId: 'q_capacity', answerId: 'a_capacity_128' },
      ],
    };
    // Saved SECOND, so it's the "latest" entry in context-free exact-chatbot-memory — the
    // buggy path this test would catch if it won. Same question wording and answer text as
    // the seller talk's Model/Capacity options (so exact-chatbot-memory's validity filter
    // can't reject them outright), different answer ids (independently-authored-in-spirit),
    // and deliberately the "wrong" (ignore-flagged) capacity for a real seller exchange.
    const buyBuddiesTalk = {
      id: `demo-buy-buddies-iphone-${RUN_ID}`,
      title: `Buy Buddies iPhone ${RUN_ID}`,
      authorId: 'buy',
      type: 'flow',
      selfTag: 'buy',
      preferenceSet: ['buy'],
      isAdult: false,
      language: 'en',
      tags: [],
      createdAt: new Date(),
      isTemplate: false,
      usageCount: 0,
      questions: [
        buildQuestions()[0],
        { id: 'q_model', text: 'Model?', answers: [{ id: 'a2_model_16pro', text: '16 Pro' }, { id: 'a2_model_other', text: 'Other' }] },
        { id: 'q_capacity', text: 'Capacity?', answers: [{ id: 'a2_capacity_128', text: '128GB', isMatch: true, isTerminal: true }, { id: 'a2_capacity_256', text: '256GB', isIgnore: true, isTerminal: true }] },
      ],
      selfAnswers: [
        { questionId: 'q_item', answerId: 'a_item_iphone' },
        { questionId: 'q_model', answerId: 'a2_model_other' },
        { questionId: 'q_capacity', answerId: 'a2_capacity_256' },
      ],
    };
    await createTalksFromCompanyPage(pageAdam, [buyFromSellerTalk, buyBuddiesTalk]);

    // Eve's sell-talk: same wording, 16 Pro / 128GB(match) / 256GB(ignore) — matches ONLY if
    // Adam's chatbot resolves from the seller-context talk, not the buddy-context one.
    const [eveTalk] = await createTalksFromCompanyPage(pageEve, [buildBuySellTalkPayload('sell')]);
    expect(eveTalk).toBeTruthy();

    await pageEve.click('.nav-btn[data-view="chatrooms"]');
    await afterSync();
    await waitForDistinctGunPeersExcludingSelf(pageEve, 1, 120_000);
    await clickBroadcastUntilBulkAck(pageEve);

    // Only Adam's chatbot resolving Eve's incoming sell-talk is under test here — Eve never
    // needs to answer Adam's talks for this assertion. A conversation forming at all is not
    // enough proof (both the correct and the wrong context lead to a resolvable reply) — the
    // discriminator is specifically that it's a MATCH (128GB), not a mismatch (256GB, ignored).
    await expect
      .poll(() => hasConversationWith(pageEve, adamId), {
        timeout: 60_000,
        message: 'Eve: Adam\'s chatbot did not resolve her sell-talk as a match using the correct (seller-context) values',
      })
      .toBe(true);
    await expect(hasConversationWith(pageAdam, eveId)).resolves.toBe(true);

    await afterAction();
  });
});
