/**
 * Reciprocal buy/sell marketplace matching with overlapping (not identical) price ranges —
 * spec §30.2/§30.3, docs/TODO.md §BB's long-open "price overlap" + "real cross-browser route
 * matching" item. (A DAG/route talk turned out unnecessary: each side's declaration is a
 * single-question `type: 'flow'` talk — a builtIn `priceRange` question, title+question text
 * already naming the item unambiguously — so an ordinary flow talk with one `builtIn` question
 * covers it, exactly the shape 86-builtin-quantity-match.spec.ts already proves end to end.)
 *
 * Adam wants to buy a used iPhone for $500-600 and sell his used notebook for $300-400. Eve is
 * the mirror image: she's selling a used iPhone for $550-650 and buying a used notebook for
 * $350-450. Neither pair of ranges is identical — $550-650 and $500-600 overlap only in
 * $550-600, and $350-450/$300-400 overlap only in $350-400 — deliberately, so this exercises
 * `intervalsOverlap` (built-in-comparisons.ts) as a real numeric comparison, not exact-text
 * matching wearing a numeric disguise (identical ranges wouldn't tell the two apart).
 *
 * Each of Adam's talks declares its own buy/sell context via a Pair-tag first question
 * (docs/TODO.md §LL follow-up, `Question.reciprocalTagContext` — the root-level `#talk-tag`/
 * `#talk-preference-set` fields this used to rely on were removed entirely); Eve's complementary
 * talks declare the opposite word as their own Q1, chaining to the same builtIn priceRange
 * question as Q2. Only Adam broadcasts — Eve's two talks exist purely to seed her own
 * typed-preference store (the "have $X" / "want $Y" value her chatbot needs to resolve Adam's
 * incoming builtIn questions), mirroring how 04-dealmaker and 05-taxi's strangers each create
 * their own talk before ever broadcasting or meeting.
 */
import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { afterSync, afterAction, headless } from '../../helpers/timing';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';
import { bootstrapUser, waitForTabActive } from '../../helpers/talks-matching-flow';
import { broadcastFromGlobalChatroom, fillPairTagQuestion, submitTalkEditorAndWaitForOut } from '../../helpers/talk-demo-ui';
import { openSettingsSection, SETTINGS_SECTION } from '../../helpers/settings-nav';

/** Creates (but does not broadcast) a 2-question flow talk: Q1 is a Pair-tag declaration of
 *  `tag` (own word), chaining to Q2, a terminal builtIn `priceRange` question — title+question
 *  text already naming the item unambiguously. */
async function createDealTalk(
  page: Page,
  title: string,
  priceQuestionText: string,
  priceMin: number,
  priceMax: number,
  tag: 'buy' | 'sell',
): Promise<void> {
  const counterpartTag = tag === 'buy' ? 'sell' : 'buy';
  await page.click('.nav-btn[data-view="talks"]');
  await waitForTabActive(page, 'talks');
  await page.click('#create-talk-btn');
  await page.waitForSelector('#talk-editor-form');
  await page.fill('#talk-title', title);
  await page.selectOption('#talk-type', 'flow');

  await page.click('#add-question-btn');
  await fillPairTagQuestion(page, 0, tag, counterpartTag, 'q_1');
  const q2 = page.locator('.question-item[data-question-index="1"]');
  await q2.locator('.question-text').fill(priceQuestionText);
  await q2.locator('.builtin-kind').selectOption('priceRange');
  await afterAction();
  await q2.locator('.builtin-pricerange-min').fill(String(priceMin));
  await q2.locator('.builtin-pricerange-max').fill(String(priceMax));

  // "Send to Chatroom" defaults checked, which would auto-broadcast right here — before Eve has
  // had a chance to record her own typed preference. Delivery is owned entirely by the explicit
  // broadcastTalk() call below instead.
  await page.locator('#talk-send-to-chatroom').setChecked(false);

  await submitTalkEditorAndWaitForOut(page, title);
  await expect(page.locator('#talk-validation-errors')).not.toBeVisible();
}

async function broadcastTalk(page: Page): Promise<void> {
  await broadcastFromGlobalChatroom(page);
  await afterSync();
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

test.describe('Reciprocal buy/sell matching with overlapping price ranges (§BB)', () => {
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

  test('Adam buys an iPhone and sells a notebook; Eve is the mirror image; both deals auto-match on overlapping (not identical) price ranges', async () => {
    test.setTimeout(120_000);
    const runId = Date.now();
    const iphoneTitle = `Used iPhone Deal ${runId}`;
    const notebookTitle = `Used Notebook Deal ${runId}`;
    const iphonePriceQuestion = `What's the price range for the used iPhone? (${runId})`;
    const notebookPriceQuestion = `What's the price range for the used notebook? (${runId})`;

    // Both users bootstrap (and so both join the shared Global room) BEFORE either creates a
    // talk. This matters: the app's late-joiner catch-up (broadcastPendingTalksOnRoomEntry,
    // app.ts) auto-delivers a member's already-created, not-yet-explicitly-broadcast talks to
    // any peer who later JOINS the room, 350ms after they join. If Adam created his talks first
    // and Eve bootstrapped afterward, her join would be a genuine "late joiner relative to an
    // existing unsent talk" and trigger that catch-up before she's had a chance to create her
    // own complementary talk or enable her own chatbot — a real race, not a hypothetical one
    // (getChatbotEnabled()/exact-text lookups have no retry once missed). Bootstrapping both
    // first, exactly like 86-builtin-quantity-match.spec.ts and 04-dealmaker-chatbot-match.spec.ts
    // already do, means neither side is ever a "late joiner" relative to the other's talks.
    const adam = await bootstrapUser(browserAdam, 'Adam', 'AdamBuySell');
    contextAdam = adam.context;
    pageAdam = adam.page;
    const eve = await bootstrapUser(browserEve, 'Eve', 'EveBuySell');
    contextEve = eve.context;
    pageEve = eve.page;

    // Adam wants to buy an iPhone for $500-600.
    await createDealTalk(pageAdam, iphoneTitle, iphonePriceQuestion, 500, 600, 'buy');
    // Adam wants to sell his notebook for $300-400.
    await createDealTalk(pageAdam, notebookTitle, notebookPriceQuestion, 300, 400, 'sell');
    // Eve is selling an iPhone for $550-650 — overlaps Adam's $500-600 want in $550-600, not
    // identical to it.
    await createDealTalk(pageEve, iphoneTitle, iphonePriceQuestion, 550, 650, 'sell');
    // Eve wants to buy a notebook for $350-450 — overlaps Adam's $300-400 ask in $350-400, not
    // identical to it.
    await createDealTalk(pageEve, notebookTitle, notebookPriceQuestion, 350, 450, 'buy');

    await enableChatbot(pageAdam);
    await enableChatbot(pageEve);

    const adamId = await getCurrentUserId(pageAdam);
    const eveId = await getCurrentUserId(pageEve);
    expect(adamId).toBeTruthy();
    expect(eveId).toBeTruthy();

    // Only Adam explicitly broadcasts — Eve's two talks exist purely to seed her own
    // typed-preference store. In practice the late-joiner catch-up above may well have already
    // delivered Adam's talks to Eve by this point; this call is a harmless no-op in that case
    // (already-sent identities are suppressed) and the real trigger either way.
    await broadcastTalk(pageAdam);

    await expect.poll(() => hasConversationWith(pageAdam, eveId), { timeout: 30_000 }).toBe(true);
    await expect.poll(() => hasConversationWith(pageEve, adamId), { timeout: 30_000 }).toBe(true);
    // Exactly one conversation, not two separate ones, despite two independent talk-level
    // matches (iPhone side and notebook side) between the same pair — createConversation keys
    // purely on the user pair, so both matches land in the same thread.
    expect(await conversationPartnerIds(pageAdam)).toEqual([eveId]);
    expect(await conversationPartnerIds(pageEve)).toEqual([adamId]);
  });
});
