/**
 * Route editor: multi-item branching + typed built-in leaf questions — spec §30.2,
 * docs/TODO.md §BB Phase 6.
 *
 * A seller offers two different items (Notebook, Pen) in one route talk instead of two
 * separate talks: a root "Which item?" question branches into a per-item sub-tree, each ending
 * in its own "quantity" builtIn leaf question (no author-typed answers — TalkAutofix generates
 * the synthetic Compatible/Not-compatible pair).
 *
 * This is the first test to exercise the INTERACTIVE route editor's branch-authoring flow
 * end to end (existing route coverage, e.g. 08-route-job-seeking.spec.ts, seeds a hand-built
 * DAG via the API, never drives `.route-add-child-btn` for real). Doing so surfaced a real,
 * pre-existing bug: the route editor tracked `contextPath`/`parentAnswer` bookkeeping but never
 * wrote `answer.nextQuestionId` — the field `talk-response-dialog.ts` actually reads to
 * navigate the DAG — so any route talk saved through the live editor could never advance past
 * its first question. Fixed in `collectRouteEditorQuestions` (ui-manager.ts) alongside this
 * feature, not a change made in isolation.
 */
import { Browser } from '@playwright/test';
import { chromium } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { headless } from '../../helpers/timing';
import { bootstrapUser, waitForTabActive } from '../../helpers/talks-matching-flow';
import { submitTalkEditorAndWaitForOut } from '../../helpers/talk-demo-ui';

test.describe('Route editor: multi-item branching + builtIn leaf questions (§BB Phase 6)', () => {
  let browser: Browser;

  test.beforeEach(async () => {
    await clearGunForStage1Spec();
    browser = await chromium.launch({ headless });
  });

  test.afterEach(async () => {
    await browser?.close().catch(() => {});
    await clearGunForStage1Spec();
  });

  test('creates a 2-item route talk with per-item quantity builtIn leaves; saves, reopens, and round-trips correctly', async () => {
    const seller = await bootstrapUser(browser, 'Seller', 'SellerRoute');
    const { page } = seller;

    await page.click('.nav-btn[data-view="talks"]');
    await waitForTabActive(page, 'talks');
    await page.click('#create-talk-btn');
    await page.waitForSelector('#talk-editor-form');

    const title = `Multi-Item Route ${Date.now()}`;
    await page.fill('#talk-title', title);
    await page.selectOption('#talk-type', 'route');
    await expect(page.locator('#route-editor')).toBeVisible();

    // Root question, repurposing the 2 default seeded answers (a_0_match / a_0_ignore) as the
    // 2 item choices — clicking "add child" on each converts it from match/ignore into a link.
    await page.locator('.route-question-text[data-qid="q_0"]').fill('Which item are you interested in?');
    await page.locator('.route-answer[data-qid="q_0"][data-aid="a_0_match"] .route-add-child-btn').click();
    await page.locator('.route-answer[data-qid="q_0"][data-aid="a_0_ignore"] .route-add-child-btn').click();
    await page.locator('.route-answer-text[data-qid="q_0"][data-aid="a_0_match"]').fill('Notebook');
    await page.locator('.route-answer-text[data-qid="q_0"][data-aid="a_0_ignore"]').fill('Pen');

    // Both children are now "Link" kind, not Match/Ignore — the promotion cleared those flags.
    await expect(page.locator('.route-answer[data-qid="q_0"][data-aid="a_0_match"] .route-answer-kind')).toHaveText('Next question');
    await expect(page.locator('.route-answer[data-qid="q_0"][data-aid="a_0_ignore"] .route-answer-kind')).toHaveText('Next question');

    // Advanced fields (builtIn kind + its typed inputs) live inside a collapsed <details> by
    // default (progressive disclosure, ui-manager.ts's renderRouteEditor) — open a node's before
    // touching anything inside.
    const openRouteAdvanced = (qid: string) =>
      page.locator(`.route-node-advanced[data-qid="${qid}"]`).evaluate((el) => {
        (el as HTMLDetailsElement).open = true;
      });

    // Notebook branch (q_1): a builtIn quantity leaf, seller has 5.
    await page.locator('.route-question-text[data-qid="q_1"]').fill('How many notebooks do you have?');
    await openRouteAdvanced('q_1');
    await page.locator('.route-builtin-kind[data-qid="q_1"]').selectOption('quantity');
    await page.locator('.route-builtin-quantity-input[data-qid="q_1"]').fill('5');

    // Pen branch (q_2): a builtIn quantity leaf, seller has 1.
    await page.locator('.route-question-text[data-qid="q_2"]').fill('How many pens do you have?');
    await openRouteAdvanced('q_2');
    await page.locator('.route-builtin-kind[data-qid="q_2"]').selectOption('quantity');
    await page.locator('.route-builtin-quantity-input[data-qid="q_2"]').fill('1');

    // A builtIn node has no answers list / "+ Add Answer" button of its own.
    await expect(page.locator('.route-node[data-qid="q_1"] .route-add-answer-btn')).toHaveCount(0);
    await expect(page.locator('.route-node[data-qid="q_1"] .route-answer')).toHaveCount(0);

    await page.locator('#talk-send-to-chatroom').setChecked(false);
    await submitTalkEditorAndWaitForOut(page, title);

    // No validation error banner should have appeared.
    await expect(page.locator('#talk-validation-errors')).not.toBeVisible();

    // Reopen for edit and verify the full structure round-trips: branch text, link kind (not
    // match/ignore, proving nextQuestionId survived TalkAutofix/TalkValidator round-trip), and
    // each leaf's builtIn kind + typed value.
    const talkItem = page.locator('.talk-list-item').filter({ hasText: title }).first();
    await talkItem.waitFor({ state: 'visible', timeout: 15_000 });
    await talkItem.click();
    await page.waitForSelector('#talk-editor-modal');
    await expect(page.locator('.route-question-text[data-qid="q_0"]')).toHaveValue('Which item are you interested in?');
    await expect(page.locator('.route-answer-text[data-qid="q_0"][data-aid="a_0_match"]')).toHaveValue('Notebook');
    await expect(page.locator('.route-answer-text[data-qid="q_0"][data-aid="a_0_ignore"]')).toHaveValue('Pen');
    await expect(page.locator('.route-answer[data-qid="q_0"][data-aid="a_0_match"] .route-answer-kind')).toHaveText('Next question');

    await expect(page.locator('.route-question-text[data-qid="q_1"]')).toHaveValue('How many notebooks do you have?');
    await expect(page.locator('.route-builtin-kind[data-qid="q_1"]')).toHaveValue('quantity');
    await expect(page.locator('.route-builtin-quantity-input[data-qid="q_1"]')).toHaveValue('5');

    await expect(page.locator('.route-question-text[data-qid="q_2"]')).toHaveValue('How many pens do you have?');
    await expect(page.locator('.route-builtin-kind[data-qid="q_2"]')).toHaveValue('quantity');
    await expect(page.locator('.route-builtin-quantity-input[data-qid="q_2"]')).toHaveValue('1');

    await page.locator('#cancel-talk-btn').click();
  });
});
