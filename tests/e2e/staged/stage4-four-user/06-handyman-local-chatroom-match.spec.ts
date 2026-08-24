/**
 * Handyman ↔ customer matching in a local chatroom with detailed (typed) criteria —
 * docs/TODO.md §HH.
 *
 * Adam and Eve are both handymen (Q1 Pair-tag 'sell', docs/TODO.md §LL follow-up), advertising
 * their service; Bob and Alice are both customers (Q1 Pair-tag 'buy'), looking for a handyman.
 * All four join the same local (San Diego) chatroom and broadcast talks they already created.
 * Only Adam+Alice auto-match;
 * Eve and Bob never match anyone.
 *
 * Unlike 05-taxi-local-chatroom-match.spec.ts (which differentiates purely via reworded
 * question text), this scenario is a showcase for §BB's already-wired `priceRange`/`timeFrame`
 * typed built-in comparisons composing with §FF's multi-select ("pick any that apply") matching
 * in ONE talk — real "detailed criteria," not just yes/no text. Each talk is a 3-question flow:
 *
 *   Q1 (builtIn priceRange) -> Q2 (builtIn timeFrame) -> Q3 (multi-select service category,
 *   always chain-terminal per §FF/TalkAutofix.fix — this is why it MUST be last, not first;
 *   putting it earlier would fail TalkValidator once actually attempted, see docs/TODO.md §HH).
 *
 * Adam and Alice share byte-identical talk title + question wording with genuinely overlapping
 * price/time ranges and an intersecting service set — proven end to end in
 * 86-builtin-quantity-match.spec.ts for a single builtIn question, extended here to a real
 * multi-criterion chain. Eve and Bob each use their own distinctly-reworded title + questions
 * (same technique as the taxi spec) so neither the builtIn typed-preference scope key (title-
 * based) nor the multi-select exact-text memory (question-text-based) ever resolves them
 * against anyone.
 */
import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage4Spec } from '../../helpers/e2e-stage-pipeline';
import { afterSync, afterAction, delay, headless } from '../../helpers/timing';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';
import { bootstrapUser, waitForTabActive } from '../../helpers/talks-matching-flow';
import { clickBroadcastUntilBulkAck, fillPairTagQuestion, submitTalkEditorAndWaitForOut } from '../../helpers/talk-demo-ui';
import { openSettingsSection, SETTINGS_SECTION } from '../../helpers/settings-nav';

const LOCAL_ROOM_ID = 'san-diego';

interface PriceRangeSpec {
  questionText: string;
  min: number;
  max: number;
}

interface TimeFrameSpec {
  questionText: string;
  start: string; // yyyy-mm-dd
  end: string; // yyyy-mm-dd
}

interface ServiceSpec {
  questionText: string;
  options: string[];
  matchOptions: string[];
}

async function createHandymanTalk(
  page: Page,
  title: string,
  price: PriceRangeSpec,
  time: TimeFrameSpec,
  service: ServiceSpec,
  tag: 'buy' | 'sell',
): Promise<void> {
  const counterpartTag = tag === 'buy' ? 'sell' : 'buy';
  await page.click('#create-talk-btn');
  await page.waitForSelector('#talk-editor-form');
  await page.fill('#talk-title', title);
  await page.selectOption('#talk-type', 'flow');

  // 4 questions total: Q1 Pair-tag declaration (docs/TODO.md §LL follow-up, replaces the
  // removed root-level `#talk-tag` field) -> price range -> time frame -> service category.
  await page.click('#add-question-btn');
  await page.click('#add-question-btn');
  await page.click('#add-question-btn');
  await afterAction();

  await fillPairTagQuestion(page, 0, tag, counterpartTag, 'q_1');

  const q1 = page.locator('.question-item').nth(1);
  await q1.locator('.question-text').fill(price.questionText);
  await q1.locator('.builtin-kind').selectOption('priceRange');
  await afterAction();
  await q1.locator('.builtin-pricerange-min').fill(String(price.min));
  await q1.locator('.builtin-pricerange-max').fill(String(price.max));

  const q2 = page.locator('.question-item').nth(2);
  await q2.locator('.question-text').fill(time.questionText);
  await q2.locator('.builtin-kind').selectOption('timeFrame');
  await afterAction();
  await q2.locator('.builtin-timeframe-start').fill(time.start);
  await q2.locator('.builtin-timeframe-end').fill(time.end);

  const q3 = page.locator('.question-item').nth(3);
  await q3.locator('.question-text').fill(service.questionText);
  await q3.locator('.answer-selection-mode').selectOption('multiple');
  await afterAction();
  // 2 answers exist by default; add a 3rd so all 3 service options are represented.
  await q3.locator('.btn-add-answer').click();
  await afterAction();
  const answerItems = q3.locator('.answer-item');
  for (let i = 0; i < service.options.length; i++) {
    await answerItems.nth(i).locator('.answer-text').fill(service.options[i]);
    await answerItems
      .nth(i)
      .locator('.answer-next')
      .selectOption(service.matchOptions.includes(service.options[i]) ? 'noticed' : 'ignore');
  }

  // "Send to Chatroom" defaults checked, which would auto-broadcast right here — before every
  // side has had a chance to record its own typed preference / self-answer. Delivery is owned
  // entirely by meetAndBroadcastLocally() below instead.
  await page.locator('#talk-send-to-chatroom').setChecked(false);

  await submitTalkEditorAndWaitForOut(page, title);
  await expect(page.locator('#talk-validation-errors')).not.toBeVisible();
}

/** Enters the San Diego city room (not Global) — the "local chatroom" from the scenario. */
async function ensureInLocalRoom(page: Page): Promise<void> {
  await page.click('.nav-btn[data-view="chatrooms"]');
  await waitForTabActive(page, 'chatrooms');
  const inDetail = await page.locator('#chatroom-members-list').isVisible().catch(() => false);
  if (inDetail) {
    await page.click('#back-to-chatrooms').catch(() => {});
    await afterSync();
  }
  await page.locator(`.chatroom-item[data-chatroom-id="${LOCAL_ROOM_ID}"]`).first().click();
  // A fixed afterSync() delay isn't a reliable signal that the detail view has actually
  // rendered under heavier load (this talk's Pair-tag + builtIn + multi-select setup takes
  // longer to author than the taxi spec's plain-text criteria) — without this explicit wait,
  // clickBroadcastUntilBulkAck's own "not already in room detail" fallback (hardcoded to
  // Global) can misfire and silently reroute this page's own currentChatroomId back to Global
  // right before it broadcasts/receives, rejecting every San Diego delivery as a room mismatch.
  await expect(page.locator('#chatroom-members-list')).toBeVisible({ timeout: 15_000 });
  await afterSync();
}

/** Join + enable chatbot — split from broadcasting so callers can run prep concurrently across
 *  pages and only start broadcasting once every page's chatbot is actually enabled.
 *  getChatbotEnabled() has no retry (unlike the "no reusable template" case), so a talk arriving
 *  before this step finishes on the receiving page would be silently and permanently missed. */
async function prepareLocalBroadcastForHandyman(page: Page): Promise<void> {
  await ensureInLocalRoom(page);
  await page.click('.nav-btn[data-view="settings"]');
  await openSettingsSection(page, SETTINGS_SECTION.talkBehavior);
  const chatbotCheckbox = page.locator('#settings-chatbot-enabled');
  if (!(await chatbotCheckbox.isChecked())) await chatbotCheckbox.click();
  await ensureInLocalRoom(page);
}

async function meetAndBroadcastLocally(page: Page): Promise<void> {
  await prepareLocalBroadcastForHandyman(page);
  await clickBroadcastUntilBulkAck(page);
}

async function getCurrentUserId(page: Page): Promise<string> {
  return page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.currentUser?.id ?? '');
}

/** Disables the (non-unlimited-by-default) daily send-rate edge gate for this browser tab —
 *  same E2E-only hook used by other multi-user specs (e.g. 00-three-user-talk-matrix.spec.ts).
 *  Without it, 4 talks each broadcasting to 3 peers can spuriously trip
 *  TALK_SEND_DAILY across a real test run's retries, unrelated to the match logic under test. */
async function disableTalkSendRateLimit(page: Page): Promise<void> {
  await page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.setTalkLedgerQuotaUnlimitedForE2e?.(true));
}

async function conversationPartnerIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const conversations = JSON.parse(localStorage.getItem('myConversations') || '{}');
    return Object.values(conversations)
      .filter((c: any) => c && c.supportChannel !== true)
      .map((c: any) => String(c.otherUserId || ''))
      .filter(Boolean);
  });
}

async function hasConversationWith(page: Page, otherUserId: string): Promise<boolean> {
  return (await conversationPartnerIds(page)).includes(otherUserId);
}

type FourBrowsers = { adam: Browser; eve: Browser; bob: Browser; alice: Browser };

async function launchFourBrowsers(): Promise<FourBrowsers> {
  const mk = (x: number, y: number) => ({
    headless,
    slowMo: headless ? 0 : delay(50, 120),
    args: [...WEBRTC_CHROMIUM_ARGS, `--window-position=${x},${y}`, '--window-size=640,900', '--force-device-scale-factor=1'],
  });
  const [adam, eve, bob, alice] = await Promise.all([
    chromium.launch(mk(0, 0)),
    chromium.launch(mk(640, 0)),
    chromium.launch(mk(0, 940)),
    chromium.launch(mk(640, 940)),
  ]);
  return { adam, eve, bob, alice };
}

async function shutdownFourBrowsers(b: FourBrowsers | undefined): Promise<void> {
  await b?.adam?.close().catch(() => {});
  await b?.eve?.close().catch(() => {});
  await b?.bob?.close().catch(() => {});
  await b?.alice?.close().catch(() => {});
}

test.describe('Handyman ↔ customer matching in a local chatroom with detailed criteria (§HH)', () => {
  let browsers: FourBrowsers;
  let contextAdam: BrowserContext | undefined;
  let contextEve: BrowserContext | undefined;
  let contextBob: BrowserContext | undefined;
  let contextAlice: BrowserContext | undefined;
  let pageAdam: Page | undefined;
  let pageEve: Page | undefined;
  let pageBob: Page | undefined;
  let pageAlice: Page | undefined;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage4Spec();
    browsers = await launchFourBrowsers();
  });

  test.afterAll(async () => {
    const cleanup = async (p?: Page) => {
      if (!p) return;
      await p.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup()).catch(() => {});
    };
    await Promise.all([cleanup(pageAdam), cleanup(pageEve), cleanup(pageBob), cleanup(pageAlice)]);
    await Promise.all([
      pageAdam?.close().catch(() => {}),
      pageEve?.close().catch(() => {}),
      pageBob?.close().catch(() => {}),
      pageAlice?.close().catch(() => {}),
    ]);
    await Promise.all([
      contextAdam?.close().catch(() => {}),
      contextEve?.close().catch(() => {}),
      contextBob?.close().catch(() => {}),
      contextAlice?.close().catch(() => {}),
    ]);
    await shutdownFourBrowsers(browsers);
    await clearGunForStage4Spec();
  });

  test('Adam+Alice auto-match on overlapping price/time/service criteria; Eve+Bob never match anyone', async () => {
    const runId = Date.now();

    // Adam (handyman) and Alice (customer) share byte-identical title + question wording, with
    // genuinely overlapping (not identical) price ranges and time frames, and an intersecting
    // (not identical) service set — real interval/set math, not exact-text luck.
    const sharedTitle = `Home Repair Help ${runId}`;
    // The run id lives BEFORE the "?", not after: `ContentFilter.assessGrammar`
    // (reputation.ts) splits on [.!?] and penalizes any resulting fragment under 2 words — a
    // trailing " (<runId>)" after the "?" would be its own unterminated 1-word fragment. With a
    // 4-question talk (Pair-tag Q1 + 3 criteria, docs/TODO.md §LL follow-up) that penalty
    // compounds enough to drop the intake grammar score below CONFIG.GRAMMAR_THRESHOLD (0.7),
    // silently rejecting the whole talk at delivery — a real bug this test's own restructuring
    // surfaced, not a matching-engine issue.
    const priceQuestionText = `What is the hourly rate range (${runId})?`;
    const timeQuestionText = `When is the work needed (${runId})?`;
    const serviceQuestionText = `Which services are involved (${runId})?`;

    const adam = await bootstrapUser(browsers.adam, 'Adam', 'Adam');
    contextAdam = adam.context;
    pageAdam = adam.page;
    await disableTalkSendRateLimit(pageAdam);
    await createHandymanTalk(
      pageAdam,
      sharedTitle,
      { questionText: priceQuestionText, min: 50, max: 100 },
      { questionText: timeQuestionText, start: '2026-09-01', end: '2026-09-30' },
      { questionText: serviceQuestionText, options: ['Plumbing', 'Electrical', 'Carpentry'], matchOptions: ['Plumbing', 'Electrical'] },
      'sell',
    );

    const alice = await bootstrapUser(browsers.alice, 'Alice', 'Alice');
    contextAlice = alice.context;
    pageAlice = alice.page;
    await disableTalkSendRateLimit(pageAlice);
    await createHandymanTalk(
      pageAlice,
      sharedTitle,
      { questionText: priceQuestionText, min: 80, max: 120 },
      { questionText: timeQuestionText, start: '2026-09-15', end: '2026-10-15' },
      { questionText: serviceQuestionText, options: ['Plumbing', 'Electrical', 'Carpentry'], matchOptions: ['Plumbing'] },
      'buy',
    );

    // Eve (handyman) and Bob (customer) each get their own distinctly-reworded title +
    // questions — different from Adam/Alice's AND from each other's — so neither the
    // typed-preference scope key (title-based) nor the multi-select exact-text memory
    // (question-text-based) ever resolves them against anyone.
    const eve = await bootstrapUser(browsers.eve, 'Eve', 'Eve');
    contextEve = eve.context;
    pageEve = eve.page;
    await disableTalkSendRateLimit(pageEve);
    await createHandymanTalk(
      pageEve,
      `Handyman Services - Eastside ${runId}`,
      { questionText: `What's your rate per hour (${runId})?`, min: 200, max: 300 },
      { questionText: `What dates work for you (${runId})?`, start: '2026-11-01', end: '2026-11-15' },
      { questionText: `What kind of work do you do (${runId})?`, options: ['Painting', 'Roofing', 'Landscaping'], matchOptions: ['Painting'] },
      'sell',
    );

    const bob = await bootstrapUser(browsers.bob, 'Bob', 'Bob');
    contextBob = bob.context;
    pageBob = bob.page;
    await disableTalkSendRateLimit(pageBob);
    await createHandymanTalk(
      pageBob,
      `Need a Handyman - Uptown ${runId}`,
      { questionText: `What rate are you willing to pay (${runId})?`, min: 60, max: 90 },
      { questionText: `When do you need this done (${runId})?`, start: '2026-09-05', end: '2026-09-10' },
      { questionText: `What type of help do you need (${runId})?`, options: ['Painting', 'Roofing', 'Landscaping'], matchOptions: ['Roofing'] },
      'buy',
    );

    const [adamId, eveId, bobId, aliceId] = await Promise.all([
      getCurrentUserId(pageAdam),
      getCurrentUserId(pageEve),
      getCurrentUserId(pageBob),
      getCurrentUserId(pageAlice),
    ]);
    expect(adamId).toBeTruthy();
    expect(eveId).toBeTruthy();
    expect(bobId).toBeTruthy();
    expect(aliceId).toBeTruthy();

    // === All 4 join the SAME local (San Diego) chatroom and broadcast the talks they already
    // created. From here, matching happens with zero manual clicks. ===
    // Two phases, not one sequential loop: prep (join + enable chatbot) fully settles for every
    // page BEFORE anyone broadcasts, otherwise a talk could arrive at a receiving page whose
    // chatbot isn't enabled yet — getChatbotEnabled() has no retry, so that would be a silent,
    // permanent miss. Broadcasting is concurrent, not sequential, purely to keep the test fast —
    // matches aren't exclusive (spec §30.2's deal-confirmation feature replaced the old
    // auto-disable-on-first-match mechanism), so there's no ordering hazard to avoid here.
    const handymanPages = [pageAdam, pageEve, pageBob, pageAlice];
    await Promise.all(handymanPages.map((page) => prepareLocalBroadcastForHandyman(page)));
    // Explicit barrier: confirm EVERY page is showing SAN DIEGO's own detail view (not just
    // *a* room's — #chatroom-members-list/#current-chatroom-title are shared ids reused for
    // whichever room happens to be open, including Global) before ANY of them broadcasts. The
    // sender's delivery ledger marks a (peer, identityKey) pair "already exchanged" the moment
    // it sends, regardless of whether the recipient's own accept-check actually took it (see
    // deliverTalkToReceiversOverMesh's own §W Gap 2 comment, app.ts) — so a retry-after-the-fact
    // can never recover a delivery that raced a peer still sitting in the wrong room; the only
    // reliable fix is making sure nobody broadcasts until everyone is confirmed in San Diego.
    await Promise.all(
      handymanPages.map((page) =>
        expect(page.locator('#current-chatroom-title')).toContainText('San Diego', { timeout: 15_000 }),
      ),
    );
    await Promise.all(
      handymanPages.map((page) =>
        clickBroadcastUntilBulkAck(page).catch(() => {
          /* already matched-and-busy before this page's own broadcast completed — fine */
        }),
      ),
    );

    await expect.poll(() => hasConversationWith(pageAdam!, aliceId), { timeout: 30_000 }).toBe(true);
    await expect.poll(() => hasConversationWith(pageAlice!, adamId), { timeout: 30_000 }).toBe(true);

    expect(await hasConversationWith(pageAdam!, eveId)).toBe(false);
    expect(await hasConversationWith(pageAdam!, bobId)).toBe(false);
    expect(await hasConversationWith(pageAlice!, eveId)).toBe(false);
    expect(await hasConversationWith(pageAlice!, bobId)).toBe(false);
    expect(await conversationPartnerIds(pageEve!)).toEqual([]);
    expect(await conversationPartnerIds(pageBob!)).toEqual([]);
  });
});
