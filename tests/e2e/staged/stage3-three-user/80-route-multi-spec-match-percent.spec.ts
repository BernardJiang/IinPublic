/**
 * Route-based multi-spec matching — independent specs, order-independent, partial-match
 * scored, ranked results (spec §30.2). `Talk.matchThreshold` switches a route talk from
 * "terminal-answer-only" to "score every direct child of the root, match if the count of
 * isMatch answers >= matchThreshold" — see `computeRouteMatchScore` in
 * `src/shared/talk-engine.ts` and the multi-branch walk mode in
 * `src/web/ui/talk-response-dialog.ts`.
 *
 * Adam authors a "buy iPhone" route talk with 3 independent sibling specs off the root
 * (color / condition / item), `matchThreshold: 2` (2 of 3 is enough to count as a match).
 * Eve answers all 3 specs matching (white/used/iPhone) — 100%. Bob answers 2 of 3 matching
 * (white/used, but not an iPhone) — 67%, still >= threshold, so still a match, just ranked
 * lower. Both form conversations with Adam. Adam's "Matched items" list (the existing
 * creator-replies panel, reached via an OUT row's long-press → "View Responses") sorts by
 * match percentage descending when `#reply-sort-order` is set to `match-percent`, and
 * clicking a matched row opens the conversation with that specific responder directly
 * (`showConversationDetail`) instead of routing to the profile view.
 */
import { Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage3Spec } from '../../helpers/e2e-stage-pipeline';
import { afterAction, afterSync } from '../../helpers/timing';
import {
  clickBroadcastUntilBulkAck,
  createTalksFromCompanyPage,
  expectTalkResponsesLine,
  waitForDistinctGunPeersExcludingSelf,
} from '../../helpers/talk-demo-ui';
import {
  bootstrapUser,
  finalCleanupPages,
  longPressTalkRow,
  openIncomingTalkModal,
  resetTalksMatchingSession,
  waitForResponseModalClosed,
  waitForTabActive,
} from '../../helpers/talks-matching-flow';
import {
  launchThreeBrowsers,
  shutdownThreeBrowsers,
  type ThreeBrowsers,
} from '../../helpers/talks-matching-browsers';

const RUN_ID = 800100;
const ROUTE_TITLE = `E2E Route MultiSpec ${RUN_ID}`;

function buildMultiSpecRoutePayload(): Record<string, unknown> {
  return {
    id: `demo-route-multispec-${RUN_ID}`,
    title: ROUTE_TITLE,
    authorId: 'adam',
    type: 'route',
    matchThreshold: 2,
    isAdult: false,
    language: 'en',
    tags: [],
    createdAt: new Date(),
    isTemplate: false,
    usageCount: 0,
    questions: [
      {
        id: 'q_root',
        text: 'Buy iPhone — independent specs',
        contextPath: [],
        answers: [
          { id: 'a_root_color', text: 'Color', nextQuestionId: 'q_color' },
          { id: 'a_root_condition', text: 'Condition', nextQuestionId: 'q_condition' },
          { id: 'a_root_item', text: 'Item', nextQuestionId: 'q_item' },
        ],
      },
      {
        id: 'q_color',
        text: 'Is it white?',
        contextPath: [{ questionId: 'q_root', answerId: 'a_root_color' }],
        answers: [
          { id: 'a_color_yes', text: 'White', isMatch: true, isTerminal: true },
          { id: 'a_color_no', text: 'Not white', isIgnore: true, isTerminal: true },
        ],
      },
      {
        id: 'q_condition',
        text: 'Is it used?',
        contextPath: [{ questionId: 'q_root', answerId: 'a_root_condition' }],
        answers: [
          { id: 'a_condition_yes', text: 'Used', isMatch: true, isTerminal: true },
          { id: 'a_condition_no', text: 'Not used', isIgnore: true, isTerminal: true },
        ],
      },
      {
        id: 'q_item',
        text: 'Is it an iPhone?',
        contextPath: [{ questionId: 'q_root', answerId: 'a_root_item' }],
        answers: [
          { id: 'a_item_yes', text: 'iPhone', isMatch: true, isTerminal: true },
          { id: 'a_item_no', text: 'Not iPhone', isIgnore: true, isTerminal: true },
        ],
      },
    ],
  };
}

/** Walks the matchThreshold multi-branch route dialog: one manual pick + continue per spec. */
async function answerMultiSpecRoute(page: Page, titleSubstring: string, answerIds: string[]): Promise<void> {
  await openIncomingTalkModal(page, titleSubstring);
  for (const aid of answerIds) {
    await page.waitForSelector('#talk-response-modal .modal-content', { timeout: 90_000 });
    const radio = page.locator(`input.choice-radio[data-answer-id="${aid}"][data-mode="manual"]`).first();
    await expect(radio).toBeVisible({ timeout: 30_000 });
    await radio.check();
    await page.locator('[data-testid="route-branch-continue"]').click();
    await afterSync();
  }
  await waitForResponseModalClosed(page);
}

test.describe('Route multi-spec matching — order-independent partial match, ranked results (§30.2)', () => {
  let browsers: ThreeBrowsers;
  let browserAdam: Browser;
  let browserEve: Browser;
  let browserBob: Browser;
  let contextAdam: BrowserContext | undefined;
  let contextEve: BrowserContext | undefined;
  let contextBob: BrowserContext | undefined;
  let pageAdam: Page | undefined;
  let pageEve: Page | undefined;
  let pageBob: Page | undefined;

  test.beforeAll(async () => {
    await clearGunForStage3Spec();
    browsers = await launchThreeBrowsers();
    browserAdam = browsers.tom;
    browserEve = browsers.jerry;
    browserBob = browsers.bob;
  });

  test.beforeEach(async () => {
    await resetTalksMatchingSession(
      { tom: pageAdam, jerry: pageEve, bob: pageBob },
      { tom: contextAdam, jerry: contextEve, bob: contextBob },
      clearGunForStage3Spec,
    );
    pageAdam = pageEve = pageBob = undefined;
    contextAdam = contextEve = contextBob = undefined;
  });

  test.afterAll(async () => {
    await finalCleanupPages(
      { tom: pageAdam, jerry: pageEve, bob: pageBob },
      { tom: contextAdam, jerry: contextEve, bob: contextBob },
    );
    await shutdownThreeBrowsers(browsers);
    await clearGunForStage3Spec();
  });

  test('100% match ranks above 67% partial match; clicking a matched row opens that conversation', async () => {
    test.setTimeout(420_000);

    const adam = await bootstrapUser(browserAdam, 'Adam', 'Adam MultiSpec');
    contextAdam = adam.context;
    pageAdam = adam.page;
    await pageAdam.click('.chatroom-item:has-text("Global")');
    await afterSync();

    const eve = await bootstrapUser(browserEve, 'Eve', 'Eve MultiSpec');
    contextEve = eve.context;
    pageEve = eve.page;
    await pageEve.click('.chatroom-item:has-text("Global")');
    await afterSync();

    const bob = await bootstrapUser(browserBob, 'Bob', 'Bob MultiSpec');
    contextBob = bob.context;
    pageBob = bob.page;
    await pageBob.click('.chatroom-item:has-text("Global")');
    await afterSync();

    // --- Adam authors + broadcasts the 3-spec matchThreshold route talk ---
    await createTalksFromCompanyPage(pageAdam, [buildMultiSpecRoutePayload()]);
    await pageAdam.click('.nav-btn[data-view="chatrooms"]');
    await afterSync();
    await waitForDistinctGunPeersExcludingSelf(pageAdam, 2, 120_000);
    await clickBroadcastUntilBulkAck(pageAdam);

    // --- Eve: white, used, iPhone — all 3 specs match => 100% ---
    await answerMultiSpecRoute(pageEve, ROUTE_TITLE, ['a_color_yes', 'a_condition_yes', 'a_item_yes']);

    // --- Bob: white, used, but NOT an iPhone — 2 of 3 => 67%, still >= matchThreshold(2) ---
    await answerMultiSpecRoute(pageBob, ROUTE_TITLE, ['a_color_yes', 'a_condition_yes', 'a_item_no']);

    // --- Adam sees both responses land on the OUT row before opening "Matched items" ---
    await expectTalkResponsesLine(pageAdam, ROUTE_TITLE, 2);

    // --- Open the creator-replies ("Matched items") panel from the OUT row's details popup ---
    await pageAdam.click('.nav-btn[data-view="talks"]');
    await waitForTabActive(pageAdam, 'talks');
    const row = pageAdam.locator('.talk-list-item[data-role="created"]').filter({ hasText: ROUTE_TITLE });
    await expect(row.first()).toBeVisible({ timeout: 15_000 });
    await longPressTalkRow(pageAdam, row.first());
    const popup = pageAdam.locator('#item-details-popup');
    await expect(popup).toBeVisible({ timeout: 10_000 });
    await popup.locator('.talk-view-responses-btn').click();
    await afterSync();

    const list = pageAdam.locator('#creator-replies-list');
    await expect(list.locator('.creator-reply-row')).toHaveCount(2, { timeout: 15_000 });

    // Narrow (640px) viewport: triage filters/sort live behind the "Filters ▾" disclosure.
    await pageAdam.click('[data-testid="replies-filter-toggle"]');

    // --- Sort by match % (highest first): Eve's 100% ranks above Bob's 67% ---
    await pageAdam.locator('#reply-sort-order').selectOption('match-percent');
    await afterSync();
    const rows = list.locator('.creator-reply-row');
    await expect(rows.nth(0)).toContainText('Eve');
    await expect(rows.nth(0).locator('.creator-reply-match-percent')).toHaveAttribute('data-match-percent', '100');
    await expect(rows.nth(1)).toContainText('Bob');
    await expect(rows.nth(1).locator('.creator-reply-match-percent')).toHaveAttribute('data-match-percent', '67');

    // --- Clicking Eve's matched row opens the conversation with Eve specifically ---
    await rows.nth(0).click();
    await expect(pageAdam.locator('#conversation-detail-overlay')).toBeVisible({ timeout: 15_000 });
    await expect(pageAdam.locator('#conversation-user-name')).toContainText('Eve');

    await afterAction();
  });
});
