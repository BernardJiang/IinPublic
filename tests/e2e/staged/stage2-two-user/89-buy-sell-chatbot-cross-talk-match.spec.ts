/**
 * Independently-authored buy/sell talks match each other — first via a real, interactive
 * route-talk build resolved by the chatbot with zero manual clicking, second (also fully
 * UI-driven now) via the chatbot's flattened context-aware store, docs/TODO.md §KK.
 *
 * First test: Adam and Eve each build their OWN talks live through the real Talk Editor, type
 * 'route' — one talk per item (iPhone, iPad), each a `matchThreshold` multi-spec talk: a root
 * question with 3 independent SIBLING specs (Model / Condition / Capacity) branching directly
 * off it, not a linear chain — the "parallel, sharing the same [root] context" shape, scored
 * like `80-route-multi-spec-match-percent.spec.ts` (2 of 3 matched specs still counts, ranked
 * lower). Adam declares `selfTag: 'buy'` (auto preferenceSet `['sell']`), Eve declares
 * `selfTag: 'sell'` (auto preferenceSet `['buy']`).
 *
 * Matching is fully automatic — neither side ever opens the other's incoming-talk modal.
 * Closing this gap required three production fixes (all in ui-manager.ts unless noted),
 * because a matchThreshold route's root has no single "self-answer" (its whole point is N
 * parallel specs at once, not one chosen path) and its direct-child specs are independent and
 * order-independent by construction (talk-engine.ts):
 *  1. `buildRouteSelfAnswers` previously only ever walked ONE linear "first answer" chain from
 *     the root — useless for 3 SIBLING specs reached via 3 *different* root answers. It now
 *     takes an optional `matchThreshold` and, when set, records one self-answer per direct
 *     child of the root (that child's own first authored answer), skipping the root itself.
 *  2. `tryBuildChatbotAnswersFromFlattened` walked a talk's `questions` array by plain INDEX
 *     order with no branch/sibling awareness — it now detects a matchThreshold route via
 *     `getRouteRootChildQuestionIds` (talk-engine.ts, shared with the response dialog's own
 *     multi-branch walk) and resolves only the root's direct children, skipping the root.
 *  3. `resolveAnswerPreferenceForTalkQuestion` and `saveAnswerPreference` both folded whichever
 *     SIBLING specs happened to be answered/saved earlier in the same walk into the §KK
 *     flattened-key's context path — harmless for a genuinely sequential chain, but wrong for
 *     specs that are independent by construction (order-independence would break the moment two
 *     independently-authored talks walked their specs in a different order). Both now force an
 *     empty context path for a matchThreshold route's direct-child questions, the same key shape
 *     a talk's very first question already uses.
 * A single branching route talk covering BOTH items (iPhone + iPad in one DAG) was considered
 * and rejected as a separate concern (nested branching under a spec is out of scope for
 * matchThreshold routes, see `computeRouteMatchScore`'s doc comment) — kept as two separate item
 * talks instead.
 *
 * A real, incidental product bug also surfaced and was fixed while building this: `UIManager`'s
 * `routeEditorQuestions` field is a singleton, never reset between Talk Editor opens — a second
 * route talk created in the same session inherited the first one's leftover DAG state instead
 * of starting fresh (`showTalkEditorDialog`, ui-manager.ts).
 *
 * Second test (§KK collision regression) needed one more real gap closed to go fully UI-driven:
 * "Buy Buddies iPhone" declares `preferenceSet: ['buy']` — the SAME tag as its own `selfTag`
 * ("match fellow buy people," not the opposite tag) — which the editor's `#talk-tag` picker had
 * no way to express; it only ever auto-derived the single seeded opposite (buy→sell). Added
 * `#talk-preference-set` (talk-editor-dialog.ts, docs/TODO.md §II "generalized beyond symmetric
 * opposites"): an explicit, editable counterpart-tag field that keeps auto-tracking the seeded
 * opposite live until the author types their own value there (or opens an existing talk that
 * already has one) — at which point that value wins outright, including a same-tag declaration.
 * `processTalkForm` (ui-manager.ts) now reads whichever of the two ended up with content.
 */
import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { afterSync, afterAction, headless } from '../../helpers/timing';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';
import { bootstrapUser, waitForTabActive } from '../../helpers/talks-matching-flow';
import {
  clickBroadcastUntilBulkAck,
  createFlowOrSurveyTalkViaEditor,
  waitForDistinctGunPeersExcludingSelf,
  submitTalkEditorAndWaitForOut,
  type UiTalkQuestionSpec,
} from '../../helpers/talk-demo-ui';
import { openSettingsSection, SETTINGS_SECTION } from '../../helpers/settings-nav';

const RUN_ID = 890100;

/**
 * Identically-worded 3-question chain (Item -> Model -> Capacity) for every talk in test 2 —
 * question/answer wording must match byte-for-byte for the flattened context-hash path (§KK)
 * to resolve across independently-authored talks. Only which answer is the author's own
 * self-pick for Model/Capacity varies (Item is always "iPhone" for every talk in this test).
 * Capacity is deliberately asymmetric on the RECEIVING talk (only 128GB is `isMatch`) — the
 * §KK collision test needs a real behavioral difference between "resolved from the right
 * context" and "resolved from the wrong one," not just two differently-worded but equally-valid
 * answers.
 */
function iphoneQuestions(opts: { modelSelfIndex: 0 | 1; capacitySelfIndex: 0 | 1 }): UiTalkQuestionSpec[] {
  return [
    {
      text: 'Which item?',
      answers: [
        { text: 'iPhone', outcome: 'next', self: true },
        { text: 'iPad', outcome: 'ignore' },
      ],
    },
    {
      text: 'Model?',
      answers: [
        { text: '16 Pro', outcome: 'next', self: opts.modelSelfIndex === 0 },
        { text: 'Other', outcome: 'ignore', self: opts.modelSelfIndex === 1 },
      ],
    },
    {
      text: 'Capacity?',
      answers: [
        { text: '128GB', outcome: 'match', self: opts.capacitySelfIndex === 0 },
        { text: '256GB', outcome: 'ignore', self: opts.capacitySelfIndex === 1 },
      ],
    },
  ];
}

async function enableChatbot(page: Page): Promise<void> {
  await page.click('.nav-btn[data-view="settings"]');
  await openSettingsSection(page, SETTINGS_SECTION.talkBehavior);
  const chatbotCheckbox = page.locator('#settings-chatbot-enabled');
  if (!(await chatbotCheckbox.isChecked())) await chatbotCheckbox.click();
  await page.click('.nav-btn[data-view="talks"]');
  await waitForTabActive(page, 'talks');
}

type MultiSpecRouteTalkOpts = {
  title: string;
  tag: 'buy' | 'sell';
  /** e.g. "Is the model 16 Pro?" */
  modelQuestion: string;
  /** e.g. "Is the capacity 128GB?" */
  capacityQuestion: string;
  expiresOption: '' | '1d' | '1w' | '1M' | '1y';
  locationRadiusMiles: '' | '10' | '100' | '1000';
};

/**
 * Builds one route talk, live through the real Talk Editor, as 3 independent SIBLING specs
 * off a shared root — Model / Condition / Capacity — not a linear chain: this is
 * `Talk.matchThreshold` multi-spec matching (spec §30.2, `computeRouteMatchScore`,
 * `talk-engine.ts`), the same shape `80-route-multi-spec-match-percent.spec.ts` proves end to
 * end, just built here through the interactive editor instead of a JSON payload. Each spec is a
 * real yes/no choice (2 answers) so a responder can genuinely mismatch one spec and still clear
 * threshold on the rest — a single-answer leaf would make every spec vacuously "match."
 * `matchThreshold` is set to require all 3 (an exact-match demo, consistent with this project's
 * existing preference for exact rather than fuzzy matching) — see
 * `80-route-multi-spec-match-percent.spec.ts` for the canonical partial-match (2 of 3, ranked
 * lower) demonstration; not duplicated here.
 */
async function createMultiSpecRouteTalk(page: Page, opts: MultiSpecRouteTalkOpts): Promise<void> {
  await page.click('.nav-btn[data-view="talks"]');
  await waitForTabActive(page, 'talks');
  await page.click('#create-talk-btn');
  await page.waitForSelector('#talk-editor-form');

  await page.fill('#talk-title', opts.title);
  await page.selectOption('#talk-type', 'route');
  await expect(page.locator('#route-editor')).toBeVisible();
  await page.fill('#talk-tag', opts.tag);

  // Root: 3 independent specs (Model / Condition / Capacity), each its own sibling branch —
  // not chained to one another. Seeded with 2 answers; add a 3rd for the 3rd spec.
  await page.locator('.route-question-text[data-qid="q_0"]').fill(`${opts.title} — independent specs`);
  await page.locator('.route-add-answer-btn[data-qid="q_0"]').click();
  await page.locator('.route-answer-text[data-qid="q_0"][data-aid="a_0_match"]').fill('Model');
  await page.locator('.route-answer-text[data-qid="q_0"][data-aid="a_0_ignore"]').fill('Condition');
  await page.locator('.route-answer-text[data-qid="q_0"][data-aid="q_0_a2"]').fill('Capacity');
  await page.locator('.route-add-child-btn[data-qid="q_0"][data-aid="a_0_match"]').click(); // -> q_1 (Model)
  await page.locator('.route-add-child-btn[data-qid="q_0"][data-aid="a_0_ignore"]').click(); // -> q_2 (Condition)
  await page.locator('.route-add-child-btn[data-qid="q_0"][data-aid="q_0_a2"]').click(); // -> q_3 (Capacity)

  // q_1: Model spec — leaf, yes/no.
  await page.locator('.route-question-text[data-qid="q_1"]').fill(opts.modelQuestion);
  await page.locator('.route-answer-text[data-qid="q_1"][data-aid="q_1_match"]').fill('Yes');
  await page.locator('.route-answer-text[data-qid="q_1"][data-aid="q_1_ignore"]').fill('No');

  // q_2: Condition spec — leaf, yes/no ("used").
  await page.locator('.route-question-text[data-qid="q_2"]').fill('Is it used?');
  await page.locator('.route-answer-text[data-qid="q_2"][data-aid="q_2_match"]').fill('Yes, used');
  await page.locator('.route-answer-text[data-qid="q_2"][data-aid="q_2_ignore"]').fill('No');

  // q_3: Capacity spec — leaf, yes/no.
  await page.locator('.route-question-text[data-qid="q_3"]').fill(opts.capacityQuestion);
  await page.locator('.route-answer-text[data-qid="q_3"][data-aid="q_3_match"]').fill('Yes');
  await page.locator('.route-answer-text[data-qid="q_3"][data-aid="q_3_ignore"]').fill('No');

  // Require all 3 specs — exact match only.
  await page.fill('#talk-match-threshold', '3');

  if (opts.expiresOption) await page.selectOption('#talk-expires', opts.expiresOption);
  if (opts.locationRadiusMiles) await page.selectOption('#talk-location-radius', opts.locationRadiusMiles);

  // Delivery is owned entirely by the explicit broadcast call after both of a user's talks
  // exist, not by an auto-broadcast on submit.
  await page.locator('#talk-send-to-chatroom').setChecked(false);

  await submitTalkEditorAndWaitForOut(page, opts.title);
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
    // Deliberately slow (not the usual jitter-only delay(35, 90) other multi-browser helpers
    // use) — this spec is meant to be watched step by step, not just proven non-flaky. Override
    // with PW_SLOW_MO=<ms> for a different pace.
    const slowMoMs = headless ? 0 : Number(process.env.PW_SLOW_MO) || 400;
    const mk = (x: number) => ({
      headless,
      slowMo: slowMoMs,
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

  test('Adam\'s buy talks and Eve\'s sell talks (iPhone + iPad, route type + matchThreshold, real Talk Editor UI) match with zero manual clicking', async () => {
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

    const iphoneTitle = `iPhone Trade ${RUN_ID}`;
    const ipadTitle = `iPad Trade ${RUN_ID}`;

    // --- Adam builds two route talks live in the Talk Editor: one per item he's buying, each
    // a 3-spec (Model/Condition/Capacity) matchThreshold talk. ---
    await createMultiSpecRouteTalk(pageAdam, {
      title: iphoneTitle,
      tag: 'buy',
      modelQuestion: 'Is the model 16 Pro?',
      capacityQuestion: 'Is the capacity 128GB?',
      expiresOption: '1w',
      locationRadiusMiles: '100',
    });
    await createMultiSpecRouteTalk(pageAdam, {
      title: ipadTitle,
      tag: 'buy',
      modelQuestion: 'Is the model 3rd generation?',
      capacityQuestion: 'Is the capacity 64GB?',
      expiresOption: '1w',
      locationRadiusMiles: '100',
    });

    // --- Eve builds the mirror-image route talks: selling instead of buying. Different
    // location/expiry (decorative — neither affects this match: the receiver's own intake
    // filters gate distance, not the talk's own radius). ---
    await createMultiSpecRouteTalk(pageEve, {
      title: iphoneTitle,
      tag: 'sell',
      modelQuestion: 'Is the model 16 Pro?',
      capacityQuestion: 'Is the capacity 128GB?',
      expiresOption: '1M',
      locationRadiusMiles: '1000',
    });
    await createMultiSpecRouteTalk(pageEve, {
      title: ipadTitle,
      tag: 'sell',
      modelQuestion: 'Is the model 3rd generation?',
      capacityQuestion: 'Is the capacity 64GB?',
      expiresOption: '1M',
      locationRadiusMiles: '1000',
    });

    // --- Both broadcast everything they created. ---
    await pageAdam.click('.nav-btn[data-view="chatrooms"]');
    await afterSync();
    await waitForDistinctGunPeersExcludingSelf(pageAdam, 1, 120_000);
    await clickBroadcastUntilBulkAck(pageAdam);

    await pageEve.click('.nav-btn[data-view="chatrooms"]');
    await afterSync();
    await waitForDistinctGunPeersExcludingSelf(pageEve, 1, 120_000);
    await clickBroadcastUntilBulkAck(pageEve);

    // --- Neither side ever opens the other's incoming-talk modal. Each chatbot resolves the
    // other's iPhone AND iPad talks entirely from its own flattened self-answer store — see file
    // header for the three production fixes that made a matchThreshold/multi-spec route talk
    // reachable by the automatic resolver. ---

    // --- Two unidirectional 3/3 matches converge on one conversation, on both sides. ---
    await expect
      .poll(() => hasConversationWith(pageAdam, eveId), { timeout: 60_000, message: 'Adam: no matched conversation with Eve' })
      .toBe(true);
    await expect
      .poll(() => hasConversationWith(pageEve, adamId), { timeout: 60_000, message: 'Eve: no matched conversation with Adam' })
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

    // "Buy iPhone Seller" wants a seller: tag 'buy' auto-fills preferenceSet ['sell'] (the
    // seeded opposite) — untouched, so the live auto-fill default is exactly what's wanted here.
    await createFlowOrSurveyTalkViaEditor(pageAdam, {
      title: `Buy iPhone Seller ${RUN_ID}`,
      type: 'flow',
      tag: 'buy',
      questions: iphoneQuestions({ modelSelfIndex: 0, capacitySelfIndex: 0 }),
    });
    // "Buy Buddies iPhone" wants fellow buyers, not a seller — preferenceSet ['buy'], the SAME
    // tag as its own selfTag, which only an explicit `#talk-preference-set` value can produce
    // (the auto-derived opposite would give 'sell', wrong for a buddy-matching talk). Saved
    // SECOND, so it's the "latest" entry in context-free exact-chatbot-memory — the buggy path
    // this test would catch if it won. Same question wording as the seller talk's Model/Capacity
    // options (so exact-chatbot-memory's validity filter can't reject them outright), and
    // deliberately the "wrong" (ignore-flagged) capacity for a real seller exchange.
    await createFlowOrSurveyTalkViaEditor(pageAdam, {
      title: `Buy Buddies iPhone ${RUN_ID}`,
      type: 'flow',
      tag: 'buy',
      preferenceSet: ['buy'],
      questions: iphoneQuestions({ modelSelfIndex: 1, capacitySelfIndex: 1 }),
    });

    // Eve's sell-talk: same wording, 16 Pro / 128GB(match) / 256GB(ignore) — matches ONLY if
    // Adam's chatbot resolves from the seller-context talk, not the buddy-context one.
    const eveTalk = await createFlowOrSurveyTalkViaEditor(pageEve, {
      title: `Sell iPhone ${RUN_ID}`,
      type: 'flow',
      tag: 'sell',
      questions: iphoneQuestions({ modelSelfIndex: 0, capacitySelfIndex: 0 }),
    });
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
