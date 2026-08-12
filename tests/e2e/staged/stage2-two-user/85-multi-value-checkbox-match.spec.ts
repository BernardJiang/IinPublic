/**
 * Multi-value ("pick any that apply") questions — spec §3.4 FR-QA-15/16, §30.8, docs/TODO.md §FF.
 *
 * A buyer's talk asks a checkbox question ("Which models would you accept?") instead of a
 * single-choice one — the buyer flags Model A and Model B as acceptable (isMatch), Model C as
 * not (isIgnore). Two sellers answer manually via the response dialog's checkbox list:
 *   - Seller 1 checks Model B (one of the buyer's accepted models) → the checked set intersects
 *     the isMatch-flagged set → match.
 *   - Seller 2 checks only Model C (the one model the buyer doesn't want) → the checked set is
 *     disjoint from the isMatch-flagged set → no match, same as an ordinary single-value
 *     mismatch today.
 *
 * This exercises the shipped pieces of §FF end to end through real UI: the talk editor's
 * "pick one / pick any that apply" toggle (talk-editor-form-helpers.ts), the response dialog's
 * checkbox list + Submit button (talk-response-dialog.ts), and the set-intersection match rule
 * (checkIfMatch, talk-engine.ts). A third test proves the chatbot's own multi-select auto-fill
 * (findAutoAnswerMultiple, exact-chatbot-memory.ts, wired into ui-manager.ts's two
 * auto-resolution paths) resolves a matching multi-select question with zero manual clicks,
 * mirroring stage4's dealmaker test but for a checkbox question instead of a plain yes/no chain.
 */
import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { afterSync, afterAction, headless } from '../../helpers/timing';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';
import { bootstrapUser, openIncomingTalkModal, waitForResponseModalClosed, waitForTabActive } from '../../helpers/talks-matching-flow';
import { broadcastFromGlobalChatroom, submitTalkEditorAndWaitForOut } from '../../helpers/talk-demo-ui';
import { openSettingsSection, SETTINGS_SECTION } from '../../helpers/settings-nav';

/** `noticedModels` get "Noticed (match)" (auto-checks that option as this author's own
 *  self-answer too, talk-editor-form-helpers.ts); every other option gets "Ignore". Creates and
 *  submits only — does NOT broadcast (see {@link broadcastTalk}), so a zero-click multi-user
 *  scenario can create every talk first and only broadcast once everyone is ready, mirroring
 *  the dealmaker spec's "strangers create their own talk before ever meeting" ordering. */
async function createChecklistTalk(
  page: Page,
  title: string,
  questionText: string,
  noticedModels: string[],
  role?: 'offer' | 'request',
): Promise<void> {
  await page.click('.nav-btn[data-view="talks"]');
  await waitForTabActive(page, 'talks');
  await page.click('#create-talk-btn');
  await page.waitForSelector('#talk-editor-form');
  await page.fill('#talk-title', title);
  await page.selectOption('#talk-type', 'flow');
  if (role) {
    // Talk.role (checkIfMatch's same-role veto, talk-engine.ts) also happens to be the
    // existing fix for a real content-identity collision: buildIdentityPayloadFromTalk
    // (cid.ts) hashes question/answer TEXT only, never isMatch/isIgnore flags — so a buyer's
    // and a seller's talk sharing byte-identical question/option wording (required for the
    // chatbot's exact-text memory to connect them) compute the SAME qa_ identityKey despite
    // opposite match semantics, and the delivery-dedup ledger silently drops the second
    // broadcast as "already exchanged." role is included in the identity hash specifically
    // to prevent this — set it whenever two sides share wording, same as the dealmaker spec.
    await page.selectOption('#talk-role', role);
  }

  const q = page.locator('.question-item').first();
  // Unique question text per test run (not just a unique title): the talk's content-hash
  // identity (buildIdentityPayloadFromTalk, cid.ts) doesn't always include title, so two runs
  // asking byte-identical questions can collide on the sender's own already-delivered ledger
  // and silently suppress the second broadcast — same class of issue Date.now()-in-text
  // patterns elsewhere in this suite exist to avoid.
  await q.locator('.question-text').fill(questionText);
  await q.locator('.answer-selection-mode').selectOption('multiple');
  await afterAction();

  // Two answers exist by default; add a third (Model A, Model B, Model C).
  await q.locator('.btn-add-answer').click();
  await afterAction();

  const models = ['Model A', 'Model B', 'Model C'];
  const answerItems = q.locator('.answer-item');
  for (let i = 0; i < models.length; i++) {
    await answerItems.nth(i).locator('.answer-text').fill(models[i]);
    await answerItems.nth(i).locator('.answer-next').selectOption(noticedModels.includes(models[i]) ? 'noticed' : 'ignore');
  }

  // "Send to Chatroom" defaults checked, which would auto-broadcast right here at creation
  // time — before the zero-click test has had a chance to enable chatbot on both sides.
  // Delivery is owned entirely by the explicit broadcastTalk() call below instead.
  await page.locator('#talk-send-to-chatroom').setChecked(false);

  await submitTalkEditorAndWaitForOut(page, title);
}

async function broadcastTalk(page: Page): Promise<void> {
  await broadcastFromGlobalChatroom(page);
  await afterSync();
}

async function createBuyerTalk(page: Page, title: string, questionText: string): Promise<void> {
  await createChecklistTalk(page, title, questionText, ['Model A', 'Model B']);
  await broadcastTalk(page);
}

async function enableChatbot(page: Page): Promise<void> {
  await page.click('.nav-btn[data-view="settings"]');
  await openSettingsSection(page, SETTINGS_SECTION.talkBehavior);
  const chatbotCheckbox = page.locator('#settings-chatbot-enabled');
  if (!(await chatbotCheckbox.isChecked())) await chatbotCheckbox.click();
  await page.click('.nav-btn[data-view="talks"]');
  await waitForTabActive(page, 'talks');
}

async function answerWithCheckedModels(page: Page, talkTitle: string, modelsToCheck: string[]): Promise<'match' | 'no-match'> {
  await openIncomingTalkModal(page, talkTitle);
  await expect(page.locator('[data-testid="answer-checkbox-list"]')).toBeVisible({ timeout: 15_000 });

  for (const model of modelsToCheck) {
    await page.locator(`[data-testid="answer-checkbox"][data-answer-text="${model}"]`).first().check();
  }

  const matchNoticePromise = page
    .locator('.notification')
    .filter({ hasText: /Match!/i })
    .first()
    .waitFor({ state: 'visible', timeout: 8_000 })
    .then(() => true)
    .catch(() => false);

  await page.locator('[data-testid="submit-checkbox-answers-btn"]').click();
  await waitForResponseModalClosed(page);
  const matched = await matchNoticePromise;
  await afterSync();
  return matched ? 'match' : 'no-match';
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

test.describe('Multi-value checkbox questions (§FF)', () => {
  let browserBuyer: Browser;
  let browserSeller: Browser;
  let contextBuyer: BrowserContext;
  let contextSeller: BrowserContext;
  let pageBuyer: Page;
  let pageSeller: Page;

  test.beforeEach(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage2Spec();
    const mk = (x: number) => ({
      headless,
      args: [...WEBRTC_CHROMIUM_ARGS, `--window-position=${x},0`, '--window-size=640,900', '--force-device-scale-factor=1'],
    });
    [browserBuyer, browserSeller] = await Promise.all([chromium.launch(mk(0)), chromium.launch(mk(650))]);
  });

  test.afterEach(async () => {
    for (const page of [pageBuyer, pageSeller]) {
      await page?.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
    }
    await Promise.all([contextBuyer?.close?.().catch(() => {}), contextSeller?.close?.().catch(() => {})]);
    await Promise.all([browserBuyer?.close().catch(() => {}), browserSeller?.close().catch(() => {})]);
    await clearGunForStage2Spec();
  });

  test('seller checking one of the buyer\'s accepted models produces a match', async () => {
    const buyer = await bootstrapUser(browserBuyer, 'Buyer', 'BuyerCB');
    const seller = await bootstrapUser(browserSeller, 'Seller', 'SellerMatchCB');
    contextBuyer = buyer.context;
    pageBuyer = buyer.page;
    contextSeller = seller.context;
    pageSeller = seller.page;

    const title = `Buy Notebook Checkbox Match ${Date.now()}`;
    await createBuyerTalk(pageBuyer, title, `Which models would you accept? (match case, ${Date.now()})`);

    const outcome = await answerWithCheckedModels(pageSeller, title, ['Model B']);
    expect(outcome).toBe('match');

    const buyerId = await getCurrentUserId(pageBuyer);
    const sellerId = await getCurrentUserId(pageSeller);
    await expect.poll(() => hasConversationWith(pageBuyer, sellerId), { timeout: 15_000, intervals: [300] }).toBe(true);
    expect(await hasConversationWith(pageSeller, buyerId)).toBe(true);
  });

  test('seller checking only the buyer\'s rejected model does NOT match', async () => {
    const buyer = await bootstrapUser(browserBuyer, 'Buyer', 'BuyerCB2');
    const seller = await bootstrapUser(browserSeller, 'Seller', 'SellerNoMatchCB');
    contextBuyer = buyer.context;
    pageBuyer = buyer.page;
    contextSeller = seller.context;
    pageSeller = seller.page;

    const title = `Buy Notebook Checkbox No Match ${Date.now()}`;
    await createBuyerTalk(pageBuyer, title, `Which models would you accept? (no-match case, ${Date.now()})`);

    const outcome = await answerWithCheckedModels(pageSeller, title, ['Model C']);
    expect(outcome).toBe('no-match');

    const buyerId = await getCurrentUserId(pageBuyer);
    const sellerId = await getCurrentUserId(pageSeller);
    expect(await hasConversationWith(pageBuyer, sellerId)).toBe(false);
    expect(await hasConversationWith(pageSeller, buyerId)).toBe(false);
  });

  test('chatbot auto-matches a multi-select question with zero manual clicks (findAutoAnswerMultiple wiring)', async () => {
    const buyer = await bootstrapUser(browserBuyer, 'Buyer', 'BuyerAutoCB');
    const seller = await bootstrapUser(browserSeller, 'Seller', 'SellerAutoCB');
    contextBuyer = buyer.context;
    pageBuyer = buyer.page;
    contextSeller = seller.context;
    pageSeller = seller.page;

    // Byte-identical question text on both sides — required for the chatbot's exact-text
    // memory lookup to connect the two independently-authored talks (§ FR-QA-7).
    const questionText = `Which models would you accept? (zero-click case, ${Date.now()})`;

    // Both strangers create their own talk BEFORE either one broadcasts — mirrors the
    // dealmaker spec's ordering. Broadcasting Buyer's talk before Seller has recorded their
    // own self-answer would mean the chatbot has nothing to resolve against on first receipt
    // (auto-reply fires once on arrival, not retried later once memory catches up).
    //
    // Buyer accepts Model A or Model B (checks both as their own self-answer when creating —
    // talk-editor-form-helpers.ts auto-checks on "Noticed"); Model C is not acceptable.
    await createChecklistTalk(pageBuyer, `Buyer Zero-Click ${Date.now()}`, questionText, ['Model A', 'Model B'], 'request');
    // Seller only has Model B — same question text, so this also records Seller's own
    // self-answer {Model B} against the exact question text, which is what the chatbot on
    // Seller's device will use to auto-resolve Buyer's incoming talk.
    await createChecklistTalk(pageSeller, `Seller Zero-Click ${Date.now()}`, questionText, ['Model B'], 'offer');

    await enableChatbot(pageBuyer);
    await enableChatbot(pageSeller);
    await broadcastTalk(pageBuyer);
    await broadcastTalk(pageSeller);

    const buyerId = await getCurrentUserId(pageBuyer);
    const sellerId = await getCurrentUserId(pageSeller);

    // No openIncomingTalkModal, no checkbox clicks anywhere — the chatbot resolves both
    // directions purely from each side's own self-answer history.
    await expect.poll(() => hasConversationWith(pageBuyer, sellerId), { timeout: 20_000, intervals: [300] }).toBe(true);
    await expect.poll(() => hasConversationWith(pageSeller, buyerId), { timeout: 20_000, intervals: [300] }).toBe(true);
  });
});
