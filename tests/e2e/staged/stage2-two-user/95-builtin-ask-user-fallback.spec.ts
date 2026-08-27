/**
 * `resolveBuiltInQuestion`'s ASK_USER fallback — docs/TODO.md §BB's last open bullet ("Add E2E
 * cases for location outside either radius and missing preference falling to the human inbox").
 *
 * Two distinct ASK_USER paths (built-in-question-resolution.ts), neither previously covered by a
 * real cross-browser test — 86/87/94's builtin specs only ever exercise the confident-auto-resolve
 * paths (both a match and a computed incompatible):
 *
 * 1. `location` is UNCONDITIONALLY ASK_USER — `resolveBuiltInQuestion` returns it before even
 *    looking at any stored preference (`if (builtIn.kind === 'location') return { action:
 *    'ASK_USER' };`). There is deliberately no auto-resolution to test "inside vs. outside
 *    radius" against yet — see the still-open "Design a privacy-safe source for the responder's
 *    blurred location/radius" bullet directly above this one in docs/TODO.md §BB. What's real and
 *    testable today is that a `location` builtIn question always falls back to a manual human
 *    decision, regardless of chatbot settings.
 * 2. A `quantity`/`priceRange`/`timeFrame`/`ageRange` builtIn question also falls back to
 *    ASK_USER whenever the responder has no stored typed preference at all for that scope
 *    (`if (!myPref || myPref.kind !== builtIn.kind) return { action: 'ASK_USER' }`) — the
 *    ordinary case of receiving a builtIn question from someone you've never made a matching
 *    declaration of your own to.
 *
 * Both cases prove the SAME two things: no zero-click auto-answer/auto-conversation happens
 * (unlike 86's/87's/94's confident-match and confident-incompatible cases), and the safety net
 * still works end-to-end — the human can open the incoming talk and answer it manually, same as
 * any ordinary question.
 */
import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { afterSync, afterAction, headless } from '../../helpers/timing';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';
import { bootstrapUser, waitForTabActive, openIncomingTalkModal, waitForResponseModalClosed } from '../../helpers/talks-matching-flow';
import { broadcastFromGlobalChatroom, fillPairTagQuestion, submitTalkEditorAndWaitForOut } from '../../helpers/talk-demo-ui';
import { openSettingsSection, SETTINGS_SECTION } from '../../helpers/settings-nav';

type BuiltInKind = 'quantity' | 'location';

/** Creates (but does not broadcast) a 2-question flow talk: Q1 is a Pair-tag declaration of
 *  `tag` (own word), chaining to Q2, a terminal builtIn question of the given kind. For
 *  `quantity`, also fills the typed value (needed so a COUNTERPART side can auto-resolve against
 *  it in other specs — irrelevant here since Bob deliberately never creates one, but the helper
 *  stays symmetric with 86/87's). `location` needs no typed value of its own (built-in-comparisons
 *  reuses the talk's own author location/radius — untouched here, default "Anywhere"). */
async function createBuiltInTalk(
  page: Page,
  title: string,
  questionText: string,
  kind: BuiltInKind,
  tag: 'buy' | 'sell',
  quantity?: number,
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
  await q2.locator('.question-text').fill(questionText);
  // Advanced fields live inside a collapsed <details> by default (progressive disclosure,
  // talk-editor-form-helpers.ts) — open it before touching anything inside.
  await q2.locator('.question-advanced').evaluate((el) => {
    (el as HTMLDetailsElement).open = true;
  });
  await q2.locator('.builtin-kind').selectOption(kind);
  await afterAction();
  if (kind === 'quantity' && quantity != null) {
    await q2.locator('.builtin-quantity-input').fill(String(quantity));
  }

  // "Send to Chatroom" defaults checked — delivery is owned entirely by the explicit
  // broadcastTalk() call below instead, same as 86/87's builtin specs.
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

async function hasConversationWith(page: Page, otherUserId: string): Promise<boolean> {
  return page.evaluate((otherUserId) => {
    const conversations = JSON.parse(localStorage.getItem('myConversations') || '{}');
    return Object.values(conversations).some((c: any) => c && c.supportChannel !== true && String(c.otherUserId || '') === otherUserId);
  }, otherUserId);
}

/** Bob has no stored preference for Q1 (the Pair-tag "buy") either — he never authored a
 *  matching "sell" talk of his own, so exact-chatbot-memory has nothing for it — so the modal
 *  opens on Q1 first, same ASK_USER shape as Q2's builtin question. Answers both manually in one
 *  flow-talk walk (a flow question auto-advances to the next one on radio selection — no
 *  separate "Continue" button, unlike a route talk's branch preview). */
async function answerPairTagThenBuiltIn(page: Page): Promise<void> {
  await page.locator('input.choice-radio[data-answer-text="sell"][data-mode="manual"]').first().click();
  await page
    .locator('input.choice-radio[data-answer-text="Compatible"][data-mode="manual"]')
    .first()
    .click();
  await waitForResponseModalClosed(page);
}

test.describe('Built-in question ASK_USER fallback to the human inbox (§BB)', () => {
  let browserAlice: Browser;
  let browserBob: Browser;
  let contextAlice: BrowserContext;
  let contextBob: BrowserContext;
  let pageAlice: Page;
  let pageBob: Page;

  test.beforeEach(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage2Spec();
    const mk = (x: number) => ({
      headless,
      args: [...WEBRTC_CHROMIUM_ARGS, `--window-position=${x},0`, '--window-size=640,900', '--force-device-scale-factor=1'],
    });
    [browserAlice, browserBob] = await Promise.all([chromium.launch(mk(0)), chromium.launch(mk(650))]);
  });

  test.afterEach(async () => {
    for (const page of [pageAlice, pageBob]) {
      await page?.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
    }
    await Promise.all([contextAlice?.close?.().catch(() => {}), contextBob?.close?.().catch(() => {})]);
    await Promise.all([browserAlice?.close().catch(() => {}), browserBob?.close().catch(() => {})]);
    await clearGunForStage2Spec();
  });

  test('responder with no stored preference gets no auto-answer; manually answering still matches', async () => {
    test.setTimeout(120_000);
    const runId = Date.now();
    const title = `Widget Deal NoPref ${runId}`;
    const questionText = `How many widgets do you want? (${runId})`;

    const alice = await bootstrapUser(browserAlice, 'Alice', 'AliceNoPref');
    contextAlice = alice.context;
    pageAlice = alice.page;
    const bob = await bootstrapUser(browserBob, 'Bob', 'BobNoPref');
    contextBob = bob.context;
    pageBob = bob.page;

    // Alice wants 3 widgets. Bob — unlike 86-builtin-quantity-match.spec.ts's seller — never
    // creates a matching "sell" talk of his own, so he has no stored typed preference at all for
    // this (tag, title, questionText) scope when Alice's talk reaches him.
    await createBuiltInTalk(pageAlice, title, questionText, 'quantity', 'buy', 3);

    await enableChatbot(pageAlice);
    await enableChatbot(pageBob);

    const aliceId = await getCurrentUserId(pageAlice);
    const bobId = await getCurrentUserId(pageBob);
    expect(aliceId).toBeTruthy();
    expect(bobId).toBeTruthy();

    await broadcastTalk(pageAlice);

    // Give it the same window 86's confident-incompatible case gets, then confirm NOTHING
    // auto-resolved — this is the ASK_USER path, not a computed answer of either kind.
    await pageBob.waitForTimeout(3000);
    await afterSync();
    expect(await hasConversationWith(pageBob, aliceId)).toBe(false);
    expect(await hasConversationWith(pageAlice, bobId)).toBe(false);

    // The safety net: Bob can still open the incoming talk and answer it manually, same as any
    // ordinary (non-builtin) question — the ASK_USER fallback routes to the human inbox, it
    // doesn't drop the talk.
    await openIncomingTalkModal(pageBob, title);
    await answerPairTagThenBuiltIn(pageBob);
    await afterSync();

    await expect.poll(() => hasConversationWith(pageBob, aliceId), { timeout: 20_000 }).toBe(true);
    await expect.poll(() => hasConversationWith(pageAlice, bobId), { timeout: 20_000 }).toBe(true);
  });

  test('a location builtin question is always unresolved automatically; manually answering still matches', async () => {
    test.setTimeout(120_000);
    const runId = Date.now();
    const title = `Meetup Deal Location ${runId}`;
    const questionText = `Are you close enough to meet up? (${runId})`;

    const alice = await bootstrapUser(browserAlice, 'Alice', 'AliceLoc');
    contextAlice = alice.context;
    pageAlice = alice.page;
    const bob = await bootstrapUser(browserBob, 'Bob', 'BobLoc');
    contextBob = bob.context;
    pageBob = bob.page;

    await createBuiltInTalk(pageAlice, title, questionText, 'location', 'buy');

    // Both sides have chatbot enabled — location's ASK_USER is unconditional, so this must stay
    // unresolved regardless, unlike the quantity/priceRange/timeFrame/ageRange kinds which DO
    // auto-resolve once both sides have a matching stored preference (86/87/94).
    await enableChatbot(pageAlice);
    await enableChatbot(pageBob);

    const aliceId = await getCurrentUserId(pageAlice);
    const bobId = await getCurrentUserId(pageBob);
    expect(aliceId).toBeTruthy();
    expect(bobId).toBeTruthy();

    await broadcastTalk(pageAlice);

    await pageBob.waitForTimeout(3000);
    await afterSync();
    expect(await hasConversationWith(pageBob, aliceId)).toBe(false);
    expect(await hasConversationWith(pageAlice, bobId)).toBe(false);

    await openIncomingTalkModal(pageBob, title);
    await answerPairTagThenBuiltIn(pageBob);
    await afterSync();

    await expect.poll(() => hasConversationWith(pageBob, aliceId), { timeout: 20_000 }).toBe(true);
    await expect.poll(() => hasConversationWith(pageAlice, bobId), { timeout: 20_000 }).toBe(true);
  });
});
