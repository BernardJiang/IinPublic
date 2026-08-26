/**
 * Route talk: a shared builtIn question at the ROOT that itself branches — spec §30.5,
 * docs/TODO.md §BB ("Support talk-level shared time/location questions before route item
 * branches").
 *
 * Before this, a builtIn route node (quantity/priceRange/timeFrame/location) could only ever
 * be a branch's own terminal leaf — the route editor had no affordance to attach a child to a
 * builtIn node's single implicit "Compatible" outcome (see the now-updated doc comments on
 * `routeEditorQuestions`/`renderRouteEditor` in ui-manager.ts). Spec §30.5 describes exactly
 * the shape this blocked: "shared attributes (self-tag, preference-set, timeFrame, location)
 * are asked once at the talk root, then the route branches — one branch per item."
 *
 * Structure under test: root (builtIn timeFrame, "shared availability window") → single child
 * "Which item?" (an ordinary two-answer route question, ordinary per-item branching already
 * proven by 82-route-editor-multi-item-builtin.spec.ts) → each item's own builtIn quantity leaf.
 * Uses `timeFrame` rather than `location` for the shared root to keep the test deterministic
 * (plain dates, no geolocation mocking needed).
 */
import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { headless } from '../../helpers/timing';
import { bootstrapUser, waitForResponseModalClosed, openIncomingTalkModal } from '../../helpers/talks-matching-flow';
import { clickBroadcastUntilBulkAck } from '../../helpers/talk-demo-ui';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';

test.describe.configure({ timeout: 120_000 });

test.describe('Route: shared builtIn root branching into per-item questions (§BB / spec §30.5)', () => {
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

  test('a shared builtIn root, saved through the editor, round-trips and lets a real responder walk past it into an item branch to a match', async () => {
    const alice = await bootstrapUser(browserAlice, 'Alice', 'AliceRoute');
    contextAlice = alice.context;
    pageAlice = alice.page;
    await pageAlice.click('.chatroom-item:has-text("Global")');

    const bob = await bootstrapUser(browserBob, 'Bob', 'BobRoute');
    contextBob = bob.context;
    pageBob = bob.page;
    await pageBob.click('.chatroom-item:has-text("Global")');

    // ── Alice builds the route talk ────────────────────────────────────────────────────
    await pageAlice.click('.nav-btn[data-view="talks"]');
    await pageAlice.click('#create-talk-btn');
    await pageAlice.waitForSelector('#talk-editor-form');

    const title = `Shared Root Route ${Date.now()}`;
    await pageAlice.fill('#talk-title', title);
    await pageAlice.selectOption('#talk-type', 'route');
    await expect(pageAlice.locator('#route-editor')).toBeVisible();

    // Advanced fields (builtIn kind + its typed inputs) live inside a collapsed <details> by
    // default (progressive disclosure, ui-manager.ts's renderRouteEditor) — open a node's before
    // touching anything inside.
    const openRouteAdvanced = (qid: string) =>
      pageAlice.locator(`.route-node-advanced[data-qid="${qid}"]`).evaluate((el) => {
        (el as HTMLDetailsElement).open = true;
      });

    // q_0 (root): builtIn timeFrame — a wide-open window so any real "today" run matches.
    await pageAlice.locator('.route-question-text[data-qid="q_0"]').fill('When are you available?');
    await openRouteAdvanced('q_0');
    await pageAlice.locator('.route-builtin-kind[data-qid="q_0"]').selectOption('timeFrame');
    const start = new Date();
    const end = new Date(start.getTime() + 1000 * 60 * 60 * 24 * 365);
    await pageAlice.locator('.route-builtin-timeframe-start[data-qid="q_0"]').fill(start.toISOString().slice(0, 10));
    await pageAlice.locator('.route-builtin-timeframe-end[data-qid="q_0"]').fill(end.toISOString().slice(0, 10));

    // The new affordance under test: a builtIn ROOT can still get a child.
    await expect(pageAlice.locator('.route-node[data-qid="q_0"] .route-add-child-btn')).toHaveCount(1);
    await pageAlice.locator('.route-node[data-qid="q_0"] .route-add-child-btn').click();

    // q_1: "Which item?" — an ordinary two-answer branch (ordinary per-item branching already
    // proven by 82-route-editor-multi-item-builtin.spec.ts; only novel here is that it now
    // hangs off a builtIn root instead of being the root itself). A fresh child node only
    // seeds 1 default answer (q_1_match, no auto "Ignore" — route-editor-model.ts), so
    // "+ Add Answer" adds the 2nd item choice (deterministic id q_1_a1).
    await pageAlice.locator('.route-question-text[data-qid="q_1"]').fill('Which item are you interested in?');
    await pageAlice.locator('.route-add-answer-btn[data-qid="q_1"]').click();
    await pageAlice.locator('.route-answer[data-qid="q_1"][data-aid="q_1_match"] .route-add-child-btn').click();
    await pageAlice.locator('.route-answer[data-qid="q_1"][data-aid="q_1_a1"] .route-add-child-btn').click();
    await pageAlice.locator('.route-answer-text[data-qid="q_1"][data-aid="q_1_match"]').fill('Notebook');
    await pageAlice.locator('.route-answer-text[data-qid="q_1"][data-aid="q_1_a1"]').fill('Pen');

    // q_2 (Notebook branch): builtIn quantity leaf, seller has 5.
    await pageAlice.locator('.route-question-text[data-qid="q_2"]').fill('How many notebooks do you have?');
    await openRouteAdvanced('q_2');
    await pageAlice.locator('.route-builtin-kind[data-qid="q_2"]').selectOption('quantity');
    await pageAlice.locator('.route-builtin-quantity-input[data-qid="q_2"]').fill('5');

    // q_3 (Pen branch): builtIn quantity leaf, seller has 1 — not walked by this test, but a
    // real destination is required for the talk to validate.
    await pageAlice.locator('.route-question-text[data-qid="q_3"]').fill('How many pens do you have?');
    await openRouteAdvanced('q_3');
    await pageAlice.locator('.route-builtin-kind[data-qid="q_3"]').selectOption('quantity');
    await pageAlice.locator('.route-builtin-quantity-input[data-qid="q_3"]').fill('1');

    await pageAlice.locator('#talk-send-to-chatroom').setChecked(false);
    await pageAlice.locator('#talk-editor-form button[type="submit"]').click();
    await expect(pageAlice.locator('#talk-validation-errors')).not.toBeVisible();
    await pageAlice.waitForSelector('#talk-editor-modal', { state: 'detached' });

    // Reopen for edit: the shared root's child link survived TalkAutofix/TalkValidator/save —
    // "Next question" kind, not Match/Ignore, and the item branch is still there underneath it.
    const talkItem = pageAlice.locator('.talk-list-item').filter({ hasText: title }).first();
    await talkItem.waitFor({ state: 'visible', timeout: 15_000 });
    await talkItem.click();
    await pageAlice.waitForSelector('#talk-editor-modal');
    await expect(pageAlice.locator('.route-question-text[data-qid="q_0"]')).toHaveValue('When are you available?');
    await expect(pageAlice.locator('.route-builtin-kind[data-qid="q_0"]')).toHaveValue('timeFrame');
    await expect(pageAlice.locator('.route-question-text[data-qid="q_1"]')).toHaveValue('Which item are you interested in?');
    await expect(pageAlice.locator('.route-answer-text[data-qid="q_1"][data-aid="q_1_match"]')).toHaveValue('Notebook');
    await pageAlice.locator('#cancel-talk-btn').click();
    await pageAlice.waitForSelector('#talk-editor-modal', { state: 'detached' });

    // ── Bob receives it, walks the shared root, picks Notebook, and matches ───────────────
    await pageAlice.click('.nav-btn[data-view="chatrooms"]');
    await pageAlice.click('.chatroom-item:has-text("Global")');
    await clickBroadcastUntilBulkAck(pageAlice);

    // Route talks show a "this leads to: <next question>" preview + explicit Continue button
    // per branch step, rather than advancing straight on radio-select — same UI a flow talk's
    // ordinary answer would not show.
    const chooseAndContinue = async (answerText: string): Promise<void> => {
      await pageBob.locator(`input.choice-radio[data-answer-text="${answerText}"][data-mode="manual"]`).first().click();
      await pageBob.locator('[data-testid="route-branch-continue"]').click();
    };

    await openIncomingTalkModal(pageBob, title);
    // Root: the shared timeFrame question — a real human/manual click on the same
    // app-generated "Compatible" answer the builtIn leaf case already uses, advancing past the
    // shared root into the item branch (this is exactly the walk that was impossible before —
    // a builtIn root's "compatible" answer had no nextQuestionId to advance through at all).
    await chooseAndContinue('Compatible');
    // "Which item?" — pick Notebook.
    await chooseAndContinue('Notebook');
    // Notebook's builtIn quantity leaf — Bob's own request needs <= 5 (seller's 5), so
    // "Compatible" is the honest terminal answer that also confirms the match transition here.
    await chooseAndContinue('Compatible');
    await waitForResponseModalClosed(pageBob);

    // Both sides end up with a real match conversation. Bob's side is checked by presence
    // alone (not by the peer's resolved display name) since name-resolution can lag a beat
    // behind conversation creation itself in this controlled 2-user test.
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
            return Object.values(conversations).some((c: any) => c.otherUserName === 'BobRoute');
          }),
        { timeout: 20_000 },
      )
      .toBe(true);
  });
});
