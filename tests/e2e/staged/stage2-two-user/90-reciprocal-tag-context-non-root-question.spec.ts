/**
 * `reciprocalTagContext` per-question checkbox — docs/TODO.md §LL follow-up (Bernard,
 * 2026-08-20).
 *
 * §LL (committed `55389658`) removed `selfTag`/`preferenceSet` from `type: 'tag'` talks
 * entirely, and 89-buy-sell-chatbot-cross-talk-match.spec.ts already proves the ROOT-level
 * `#talk-tag`/`#talk-preference-set` mechanism auto-matches independently-authored buy/sell
 * route talks. This spec covers the newer, more general mechanism: a checkbox on ANY question
 * (only meaningful with exactly one answer) that defines the buy/sell-style context for every
 * question after it in the same branch, instead of a separate root-only field pair — Adam's
 * "buy" declaration and Eve's "sell" declaration are each just an ordinary FIRST question in a
 * 2-question flow talk, not talk-level metadata.
 *
 * `createFlowOrSurveyTalkViaEditor`'s `UiTalkQuestionSpec.reciprocalTagContext` (talk-demo-ui.ts)
 * checks the new `.question-reciprocal-tag` checkbox and — new in this same change — removes the
 * question's default 2nd answer so it ends up with exactly 1, the condition the matching engine
 * requires (`findReciprocalTagAncestor`, ui-manager.ts).
 */
import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { afterSync, headless } from '../../helpers/timing';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';
import { bootstrapUser, waitForTabActive } from '../../helpers/talks-matching-flow';
import {
  clickBroadcastUntilBulkAck,
  createFlowOrSurveyTalkViaEditor,
  type UiTalkQuestionSpec,
} from '../../helpers/talk-demo-ui';
import { openSettingsSection, SETTINGS_SECTION } from '../../helpers/settings-nav';

const RUN_ID = 900100;

/**
 * Question 1 ("buy" or "sell") is the reciprocal-checked context declaration — exactly 1
 * word, chained forward) plus the "Not interested"/ignore option every question needs
 * regardless (`TalkValidator.validateQuestion`) — `findReciprocalTagAncestor` (ui-manager.ts)
 * counts only NON-ignore answers, so this ordinary 2-answer shape already qualifies; no special
 * answer count is required. Question 2 ("iPhone?") is byte-identical text on both sides, an
 * ordinary 2-answer yes/no — the question that actually needs the buy/sell context to
 * auto-resolve across two differently-worded roots.
 */
function buySellQuestions(opts: { selfWord: 'buy' | 'sell'; counterpartWord: 'buy' | 'sell' }): UiTalkQuestionSpec[] {
  return [
    {
      text: opts.selfWord,
      reciprocalTagContext: true,
      answers: [
        { text: opts.counterpartWord, outcome: 'next', self: true },
        { text: 'Not interested', outcome: 'ignore' },
      ],
    },
    {
      text: 'Is it an iPhone?',
      answers: [
        { text: 'Yes', outcome: 'match', self: true },
        { text: 'No', outcome: 'ignore' },
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

test.describe('Non-root reciprocalTagContext question auto-matches buy/sell strangers (§LL follow-up)', () => {
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
      slowMo: headless ? 0 : Number(process.env.PW_SLOW_MO) || 0,
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

  test("Adam's \"buy\" talk and Eve's \"sell\" talk match with zero manual clicking, via a non-root reciprocalTagContext question", async () => {
    test.setTimeout(180_000);

    const adam = await bootstrapUser(browserAdam, 'Adam', 'Adam Reciprocal');
    contextAdam = adam.context;
    pageAdam = adam.page;
    await pageAdam.click('.chatroom-item:has-text("Global")');
    await afterSync();
    await enableChatbot(pageAdam);

    const eve = await bootstrapUser(browserEve, 'Eve', 'Eve Reciprocal');
    contextEve = eve.context;
    pageEve = eve.page;
    await pageEve.click('.chatroom-item:has-text("Global")');
    await afterSync();
    await enableChatbot(pageEve);

    const [adamId, eveId] = await Promise.all([getCurrentUserId(pageAdam), getCurrentUserId(pageEve)]);
    expect(adamId).toBeTruthy();
    expect(eveId).toBeTruthy();

    const title = `iPhone Reciprocal ${RUN_ID}`;

    // Adam: Q1 "buy" (reciprocal, accepts "sell") -> Q2 "Is it an iPhone?" (Yes).
    await createFlowOrSurveyTalkViaEditor(pageAdam, {
      title,
      type: 'flow',
      questions: buySellQuestions({ selfWord: 'buy', counterpartWord: 'sell' }),
    });

    // Eve: same shape, opposite role — Q1 "sell" (reciprocal, accepts "buy") -> Q2 identical text.
    await createFlowOrSurveyTalkViaEditor(pageEve, {
      title,
      type: 'flow',
      questions: buySellQuestions({ selfWord: 'sell', counterpartWord: 'buy' }),
    });

    await clickBroadcastUntilBulkAck(pageAdam);
    await clickBroadcastUntilBulkAck(pageEve);

    await expect
      .poll(() => hasConversationWith(pageAdam, eveId), { timeout: 60_000, message: 'Adam: no matched conversation with Eve' })
      .toBe(true);
    await expect
      .poll(() => hasConversationWith(pageEve, adamId), { timeout: 60_000, message: 'Eve: no matched conversation with Adam' })
      .toBe(true);
  });
});
