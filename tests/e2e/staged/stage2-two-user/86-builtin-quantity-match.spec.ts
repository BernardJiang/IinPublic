/**
 * Typed built-in comparison questions — spec §30.2, docs/TODO.md §BB.
 *
 * A "quantity" builtIn question compares typed numeric values instead of matching text: a
 * buyer's talk (Q1 Pair-tag 'buy', docs/TODO.md §LL follow-up) declares how many they want, a
 * seller's talk (Q1 Pair-tag 'sell') declares how many they have, and `resolveBuiltInQuestion`
 * (built-in-question-resolution.ts) auto-resolves the deal — no manual answer picking, no
 * exact-text chatbot memory involved.
 *
 * This exercises §BB phases 1-5 end to end through real UI: the talk editor's "Compare using:"
 * kind selector + typed quantity input (talk-editor-form-helpers.ts), TalkAutofix's synthetic
 * answer generation (talk-engine.ts), the typed-preference-store side effect saved on submit
 * (processTalkForm, ui-manager.ts), and the comparison dispatch wired into
 * resolveAnswerPreferenceForTalkQuestion (ui-manager.ts / built-in-question-resolution.ts).
 *
 * - Buyer wants 2, seller has 5 (2 <= 5) -> auto-match, zero manual clicks.
 * - Buyer wants 10, seller has 2 (10 > 2) -> a confident computed "not compatible" -> resolved
 *   automatically to no-match (never reaches a human inbox), per the "computed incompatible is
 *   trustworthy enough to auto-resolve" decision in TODO.md §BB.
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
 *  `tag` (own word), chaining to Q2, a terminal "quantity" builtIn question. */
async function createQuantityTalk(
  page: Page,
  title: string,
  questionText: string,
  quantity: number,
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
  await q2.locator('.question-text').fill(questionText);
  // Advanced fields live inside a collapsed <details> by default (progressive disclosure,
  // talk-editor-form-helpers.ts) — open it before touching anything inside.
  await q2.locator('.question-advanced').evaluate((el) => {
    (el as HTMLDetailsElement).open = true;
  });
  await q2.locator('.builtin-kind').selectOption('quantity');
  await afterAction();
  await q2.locator('.builtin-quantity-input').fill(String(quantity));

  // "Send to Chatroom" defaults checked, which would auto-broadcast right here — before the
  // other side has recorded their own typed preference. Delivery is owned entirely by the
  // explicit broadcastTalk() call below instead, mirroring 85-multi-value-checkbox-match.spec.ts.
  await page.locator('#talk-send-to-chatroom').setChecked(false);

  await submitTalkEditorAndWaitForOut(page, title);
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

test.describe('Typed built-in "quantity" comparison questions (§BB)', () => {
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

  test('buyer wanting fewer than the seller has auto-matches with zero manual clicks', async () => {
    const buyer = await bootstrapUser(browserBuyer, 'Buyer', 'BuyerQty');
    const seller = await bootstrapUser(browserSeller, 'Seller', 'SellerQty');
    contextBuyer = buyer.context;
    pageBuyer = buyer.page;
    contextSeller = seller.context;
    pageSeller = seller.page;

    // Scope-key alignment (built-in-question-resolution.ts): my own typed preference is saved
    // under (my own Q1 Pair-tag word, my own talk's title) at creation time, and looked up under
    // the same (mySelfTag, title) pair when auto-resolving an incoming talk — so both sides must
    // share the same title, not just the same question text.
    const title = `Notebook Deal Qty ${Date.now()}`;
    const questionText = `How many notebooks? (compatible case, ${Date.now()})`;

    await createQuantityTalk(pageBuyer, title, questionText, 2, 'buy'); // buyer wants 2
    await createQuantityTalk(pageSeller, title, questionText, 5, 'sell'); // seller has 5

    await enableChatbot(pageBuyer);
    await enableChatbot(pageSeller);
    await broadcastTalk(pageBuyer);
    await broadcastTalk(pageSeller);

    const buyerId = await getCurrentUserId(pageBuyer);
    const sellerId = await getCurrentUserId(pageSeller);

    // No openIncomingTalkModal, no manual answering anywhere — resolveBuiltInQuestion resolves
    // both directions purely from each side's own typed preference (2 <= 5).
    await expect.poll(() => hasConversationWith(pageBuyer, sellerId), { timeout: 20_000, intervals: [300] }).toBe(true);
    await expect.poll(() => hasConversationWith(pageSeller, buyerId), { timeout: 20_000, intervals: [300] }).toBe(true);
  });

  test('buyer wanting more than the seller has resolves to no-match automatically (not sent to a human)', async () => {
    const buyer = await bootstrapUser(browserBuyer, 'Buyer', 'BuyerQtyNoMatch');
    const seller = await bootstrapUser(browserSeller, 'Seller', 'SellerQtyNoMatch');
    contextBuyer = buyer.context;
    pageBuyer = buyer.page;
    contextSeller = seller.context;
    pageSeller = seller.page;

    const title = `Notebook Deal Qty NoMatch ${Date.now()}`;
    const questionText = `How many notebooks? (incompatible case, ${Date.now()})`;

    await createQuantityTalk(pageBuyer, title, questionText, 10, 'buy'); // buyer wants 10
    await createQuantityTalk(pageSeller, title, questionText, 2, 'sell'); // seller has only 2

    await enableChatbot(pageBuyer);
    await enableChatbot(pageSeller);
    await broadcastTalk(pageBuyer);
    await broadcastTalk(pageSeller);

    const buyerId = await getCurrentUserId(pageBuyer);
    const sellerId = await getCurrentUserId(pageSeller);

    // Give the auto-resolution the same window the match case gets, then confirm it settled on
    // no-match rather than leaving the talk sitting unanswered (that would be the missing-data
    // fail-safe path, not this computed-incompatible one).
    await pageBuyer.waitForTimeout(3000);
    await afterSync();
    expect(await hasConversationWith(pageBuyer, sellerId)).toBe(false);
    expect(await hasConversationWith(pageSeller, buyerId)).toBe(false);
  });
});
