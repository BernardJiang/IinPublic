/**
 * Route talk: a Pair-tag ("buy"/"sell") context question chaining into a Simple-tag item
 * question ("iPhone"), which itself fans one answer out into TWO parallel spec questions
 * ("Model", "Condition") that must BOTH match (`Answer.nextQuestionIds`/`parallelMatchThreshold`,
 * types.ts — `evaluateRouteFanOutMatch`, talk-engine.ts). This is a real talk authored by hand
 * through the Talk Editor's route (DAG) tree, brought in as e2e coverage: buy stuff -> Pair tag
 * (buy/sell) -> iPhone (Simple tag, self-match) -> parallel Model (16pro) / Condition (used).
 *
 * Prior route specs cover a fan-out's building blocks separately — 90 covers a non-root
 * reciprocalTagContext question, 92 covers a shared root branching into per-item questions —
 * but none combine a Pair-tag root with a Simple-tag item question that itself parallel-fans
 * into 2+ independently-answered specs. `parallelMatchThreshold` defaults to "all" (both
 * specs), matching the editor's own "blank = all" placeholder.
 */
import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { headless } from '../../helpers/timing';
import { bootstrapUser, waitForResponseModalClosed, openIncomingTalkModal } from '../../helpers/talks-matching-flow';
import { clickBroadcastUntilBulkAck, createRouteTalkViaEditor, type UiRouteNodeSpec } from '../../helpers/talk-demo-ui';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';
import { openSettingsSection, SETTINGS_SECTION } from '../../helpers/settings-nav';
import { ensureChatroomList } from '../../helpers/chatroom-nav';

test.describe.configure({ timeout: 120_000 });

test.describe('Route: Pair-tag root -> Simple-tag item -> parallel spec fan-out ("buy stuff")', () => {
  let browserAlice: Browser;
  let browserBob: Browser;
  let contextAlice: BrowserContext;
  let contextBob: BrowserContext;
  let pageAlice: Page;
  let pageBob: Page;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage2Spec();
    browserAlice = await chromium.launch({ headless, args: [...WEBRTC_CHROMIUM_ARGS] });
    browserBob = await chromium.launch({ headless, args: [...WEBRTC_CHROMIUM_ARGS] });
  });

  test.afterAll(async () => {
    const manualCleanup = async (page?: Page) => {
      if (!page) return;
      try {
        await page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.());
      } catch { /* ignore */ }
    };
    await manualCleanup(pageAlice);
    await manualCleanup(pageBob);
    await pageAlice?.close();
    await pageBob?.close();
    await contextAlice?.close();
    await contextBob?.close();
    await browserAlice?.close();
    await browserBob?.close();
    await clearGunForStage2Spec();
  });

  test('a real responder walks buy -> sell -> iPhone -> model+condition to a match', async () => {
    const alice = await bootstrapUser(browserAlice, 'Alice', 'AliceBuyStuff');
    contextAlice = alice.context;
    pageAlice = alice.page;
    await pageAlice.click('.chatroom-item:has-text("Global")');

    const bob = await bootstrapUser(browserBob, 'Bob', 'BobBuyStuff');
    contextBob = bob.context;
    pageBob = bob.page;
    await pageBob.click('.chatroom-item:has-text("Global")');

    // Every question in this talk is a single word ("buy", "iphone", "model", "16pro",
    // "condition", "used") by design — the exact tag-like shorthand the real talk uses. The
    // default "require good grammar" intake filter scores that below CONFIG.GRAMMAR_THRESHOLD
    // (assessGrammar penalizes 1-word "sentences", reputation.ts) and silently drops the
    // delivery, so Bob opts out of it, same as any real receiver who wants terse tag-style
    // talks would.
    await pageBob.click('.nav-btn[data-view="settings"]');
    await openSettingsSection(pageBob, SETTINGS_SECTION.contentFilters);
    await pageBob.locator('#settings-grammar-filter').uncheck();
    await ensureChatroomList(pageBob);
    await pageBob.click('.chatroom-item:has-text("Global")');

    // ── Alice builds "buy stuff" through the real route editor ─────────────────────────
    const title = `buy stuff ${Date.now()}`;
    const root: UiRouteNodeSpec = {
      text: 'buy',
      reciprocalTagContext: true,
      answers: [
        {
          text: 'sell',
          child: {
            text: 'iphone',
            simpleTag: true,
            answers: [
              {
                text: 'iphone',
                children: [
                  { text: 'model', answers: [{ text: '16pro', outcome: 'match' }] },
                  { text: 'condition', answers: [{ text: 'used', outcome: 'match' }] },
                ],
              },
            ],
          },
        },
      ],
    };
    await createRouteTalkViaEditor(pageAlice, { title, root });

    // Reopen for edit: the Pair-tag root, the Simple-tag item question, and both parallel
    // spec leaves all survived TalkAutofix/TalkValidator/save.
    const talkItem = pageAlice.locator('.talk-list-item').filter({ hasText: title }).first();
    await talkItem.waitFor({ state: 'visible', timeout: 15_000 });
    await talkItem.click();
    await pageAlice.waitForSelector('#talk-editor-modal');
    await expect(pageAlice.locator('.route-question-text[data-qid="q_0"]')).toHaveValue('buy');
    await expect(pageAlice.locator('.route-question-reciprocal-tag[data-qid="q_0"]')).toBeChecked();
    await expect(pageAlice.locator('.route-question-text[data-qid="q_1"]')).toHaveValue('iphone');
    await expect(pageAlice.locator('.route-question-simple-tag[data-qid="q_1"]')).toBeChecked();
    await expect(pageAlice.locator('.route-question-text[data-qid="q_2"]')).toHaveValue('model');
    await expect(pageAlice.locator('.route-answer-text[data-qid="q_2"][data-aid="q_2_match"]')).toHaveValue('16pro');
    await expect(pageAlice.locator('.route-question-text[data-qid="q_3"]')).toHaveValue('condition');
    await expect(pageAlice.locator('.route-answer-text[data-qid="q_3"][data-aid="q_3_match"]')).toHaveValue('used');
    await pageAlice.locator('#cancel-talk-btn').click();
    await pageAlice.waitForSelector('#talk-editor-modal', { state: 'detached' });

    // ── Bob receives it and walks every branch to a match ───────────────────────────────
    await ensureChatroomList(pageAlice);
    await pageAlice.click('.chatroom-item:has-text("Global")');
    await clickBroadcastUntilBulkAck(pageAlice);

    const chooseAndContinue = async (answerText: string): Promise<void> => {
      await pageBob.locator(`input.choice-radio[data-answer-text="${answerText}"][data-mode="manual"]`).first().click();
      await pageBob.locator('[data-testid="route-branch-continue"]').click();
    };

    await openIncomingTalkModal(pageBob, title);
    await chooseAndContinue('sell'); // "buy" root: accept the Pair-tag context.
    await chooseAndContinue('iphone'); // Simple-tag item question: self-match.
    await chooseAndContinue('16pro'); // Parallel spec 1/2: model.
    await chooseAndContinue('used'); // Parallel spec 2/2: condition — both required (threshold "all").
    await waitForResponseModalClosed(pageBob);

    await expect
      .poll(
        () =>
          pageBob.evaluate(() => {
            const conversations = JSON.parse(localStorage.getItem('myConversations') || '{}');
            return Object.keys(conversations).length;
          }),
        { timeout: 20_000 },
      )
      .toBeGreaterThan(0);
    await expect
      .poll(
        () =>
          pageAlice.evaluate(() => {
            const conversations = JSON.parse(localStorage.getItem('myConversations') || '{}');
            return Object.values(conversations).some((c: any) => c.otherUserName === 'BobBuyStuff');
          }),
        { timeout: 20_000 },
      )
      .toBe(true);
  });
});
