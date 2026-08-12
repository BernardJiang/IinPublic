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
 * (checkIfMatch, talk-engine.ts). The chatbot's own multi-select auto-fill
 * (findAutoAnswerMultiple, exact-chatbot-memory.ts) is unit-tested separately — it is not yet
 * wired into either of ui-manager.ts's auto-resolution paths (docs/TODO.md §FF), so this test
 * answers manually rather than relying on a zero-click chatbot auto-match.
 */
import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { afterSync, afterAction, headless } from '../../helpers/timing';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';
import { bootstrapUser, openIncomingTalkModal, waitForResponseModalClosed, waitForTabActive } from '../../helpers/talks-matching-flow';
import { broadcastFromGlobalChatroom, submitTalkEditorAndWaitForOut } from '../../helpers/talk-demo-ui';

async function createBuyerTalk(page: Page, title: string, questionText: string): Promise<void> {
  await page.click('.nav-btn[data-view="talks"]');
  await waitForTabActive(page, 'talks');
  await page.click('#create-talk-btn');
  await page.waitForSelector('#talk-editor-form');
  await page.fill('#talk-title', title);
  await page.selectOption('#talk-type', 'flow');

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

  const answerItems = q.locator('.answer-item');
  await answerItems.nth(0).locator('.answer-text').fill('Model A');
  await answerItems.nth(0).locator('.answer-next').selectOption('noticed');
  await answerItems.nth(1).locator('.answer-text').fill('Model B');
  await answerItems.nth(1).locator('.answer-next').selectOption('noticed');
  await answerItems.nth(2).locator('.answer-text').fill('Model C');
  await answerItems.nth(2).locator('.answer-next').selectOption('ignore');

  await submitTalkEditorAndWaitForOut(page, title);
  await broadcastFromGlobalChatroom(page);
  await afterSync();
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
});
