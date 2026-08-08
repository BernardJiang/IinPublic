/**
 * Contacts/Talks cross-navigation: match/mismatch filters, a talk's responses list, and
 * clicking between Contacts and Talks based on selection.
 *
 * Fixed three gaps in one pass:
 *   1. No match/mismatch filter existed on the Contacts list.
 *   2. No match/mismatch filter existed on a contact's own talk-history list (direction
 *      sent/received only).
 *   3. #creator-replies-panel ("Replies To My Talks" — per-responder rows with a match/
 *      mismatch badge, already fully filterable/sortable/groupable) was built but never
 *      shown (TODO §M1: hard-coded display:none, no trigger anywhere). Surfaced it via a
 *      "View Responses (N)" button on each outgoing talk row, scoped to that one talk;
 *      wired responder rows to jump to that person's Contacts detail; wired a contact's
 *      own talk-history title (for talks they authored) to jump back to that talk's
 *      responses list — the "switch smoothly based on selection" in both directions.
 *
 * Setup: Tom creates "Book Club" and broadcasts it; Jerry creates "Chess" and broadcasts
 * it. Jerry answers Book Club as a match; Bob answers Book Club as a mismatch; Tom
 * answers Chess as a match. Tom then has one contact with at least one match (Jerry, via
 * both talks) and one contact with zero matches (Bob, mismatch only) — enough to
 * distinguish every filter and both navigation directions.
 *
 * Companion doc: tests/e2e/staged/stage3-three-user/09-contacts-talks-cross-navigation.md
 */
import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage3Spec } from '../../helpers/e2e-stage-pipeline';
import { afterSync, afterNav, afterAction, delay, headless } from '../../helpers/timing';
import { completeTalkInAppByAnswerIds, createTalksFromCompanyPage } from '../../helpers/talk-demo-ui';
import { waitForStatusBarMatchCountAtLeast, waitForPeerHistoryTitle, waitForContactDetailReady } from '../../helpers/durable-ui';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';
// bootstrapUser here (not a local copy) specifically for its rename-propagation barrier —
// it waits for a stage-name rename to land on the hub's public user record before
// returning. Without that, a talk created (or answered) right after the rename can
// capture the pre-rename auto-generated default name into authorName/otherUserName —
// which is exactly what broke this spec's first draft (Jerry's Chess talk recorded
// "Userxxxxxxxxx" as its authorName instead of "Jerry", corrupting the matched-contact
// name and, transitively, this test's own outcome-filter assertions).
import { bootstrapUser, waitForTabActive } from '../../helpers/talks-matching-flow';

test.describe('Contacts/Talks cross-navigation: outcome filters + a talk\'s responses list', () => {
  let browserTom: Browser;
  let browserJerry: Browser;
  let browserBob: Browser;
  let contextTom: BrowserContext;
  let contextJerry: BrowserContext;
  let contextBob: BrowserContext;
  let pageTom: Page;
  let pageJerry: Page;
  let pageBob: Page;

  const TALK_BOOK_CLUB = 'Book Club';
  const TALK_CHESS = 'Chess';
  const BOOK_MATCH_ID = 'a_book_yes';
  const BOOK_IGNORE_ID = 'a_book_no';
  const CHESS_MATCH_ID = 'a_chess_yes';
  const CHESS_IGNORE_ID = 'a_chess_no';

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage3Spec();
    browserTom = await chromium.launch({
      headless,
      slowMo: headless ? 0 : delay(50, 120),
      args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=0,0', '--window-size=640,1200', '--force-device-scale-factor=1'],
    });
    browserJerry = await chromium.launch({
      headless,
      slowMo: headless ? 0 : delay(50, 120),
      args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=640,0', '--window-size=640,1200', '--force-device-scale-factor=1'],
    });
    browserBob = await chromium.launch({
      headless,
      slowMo: headless ? 0 : delay(50, 120),
      args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=1280,0', '--window-size=640,1200', '--force-device-scale-factor=1'],
    });
  });

  test.afterAll(async () => {
    const cleanup = async (p?: Page) => {
      if (!p) return;
      try {
        await p.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup());
      } catch { /* best-effort */ }
    };
    await cleanup(pageTom);
    await cleanup(pageJerry);
    await cleanup(pageBob);
    await pageTom?.close();
    await pageJerry?.close();
    await pageBob?.close();
    await contextTom?.close();
    await contextJerry?.close();
    await contextBob?.close();
    await browserTom?.close();
    await browserJerry?.close();
    await browserBob?.close();
    await clearGunForStage3Spec();
  });

  async function currentUserId(page: Page): Promise<string> {
    return page.evaluate(() => (window as any).__iinpublic_app?.getApp()?.currentUser?.id || '');
  }

  test('Contacts outcome filter, peer-history outcome filter, and a talk\'s responses list all work and cross-navigate', async () => {
    test.setTimeout(180_000);

    const tom = await bootstrapUser(browserTom, 'Tom', 'Tom');
    contextTom = tom.context;
    pageTom = tom.page;
    await pageTom.click('.chatroom-item:has-text("Global")');
    await afterSync();

    const jerry = await bootstrapUser(browserJerry, 'Jerry', 'Jerry');
    contextJerry = jerry.context;
    pageJerry = jerry.page;
    await pageJerry.click('.chatroom-item:has-text("Global")');
    await afterSync();

    const bob = await bootstrapUser(browserBob, 'Bob', 'Bob');
    contextBob = bob.context;
    pageBob = bob.page;
    await pageBob.click('.chatroom-item:has-text("Global")');
    await afterSync();

    const [bookClub] = await createTalksFromCompanyPage(pageTom, [{
      title: TALK_BOOK_CLUB,
      type: 'flow',
      language: 'en',
      questions: [{
        id: 'q_book',
        text: 'Want to join the book club?',
        answers: [
          { id: BOOK_MATCH_ID, text: 'Yes, count me in.', isMatch: true, isTerminal: true },
          { id: BOOK_IGNORE_ID, text: 'Not for me.', isIgnore: true, isTerminal: true },
        ],
      }],
    }]);
    const [chess] = await createTalksFromCompanyPage(pageJerry, [{
      title: TALK_CHESS,
      type: 'flow',
      language: 'en',
      questions: [{
        id: 'q_chess',
        text: 'Fancy a chess match?',
        answers: [
          { id: CHESS_MATCH_ID, text: 'Yes, let\'s play.', isMatch: true, isTerminal: true },
          { id: CHESS_IGNORE_ID, text: 'No thanks.', isIgnore: true, isTerminal: true },
        ],
      }],
    }]);

    await completeTalkInAppByAnswerIds(pageJerry, bookClub.talkId, bookClub.talkData, [BOOK_MATCH_ID], 'match');
    await waitForStatusBarMatchCountAtLeast(pageJerry, 1);
    await completeTalkInAppByAnswerIds(pageBob, bookClub.talkId, bookClub.talkData, [BOOK_IGNORE_ID], 'mismatch');
    await completeTalkInAppByAnswerIds(pageTom, chess.talkId, chess.talkData, [CHESS_MATCH_ID], 'match');
    await waitForStatusBarMatchCountAtLeast(pageTom, 1);

    const tomId = await currentUserId(pageTom);
    const jerryId = await currentUserId(pageJerry);
    const bobId = await currentUserId(pageBob);
    await waitForPeerHistoryTitle(pageTom, tomId, jerryId, TALK_BOOK_CLUB);
    await waitForPeerHistoryTitle(pageTom, tomId, bobId, TALK_BOOK_CLUB);
    await waitForPeerHistoryTitle(pageTom, tomId, jerryId, TALK_CHESS);

    // ── Contacts outcome filter ──────────────────────────────────────────────
    await pageTom.click('.nav-btn[data-view="contacts"]');
    await afterAction();
    const filterToggle = pageTom.locator('[data-testid="contacts-filter-toggle"]');
    if (await filterToggle.isVisible().catch(() => false)) await filterToggle.click();
    await afterAction();
    await expect(pageTom.locator('#contacts-list .contact-item:not([data-support-contact="true"])')).toHaveCount(2, { timeout: 15_000 });

    // Matched/unmatched by data-contact-user-id, not display name: a contact's stored
    // name is best-effort self-healed from the live chatroom roster (ui-manager.ts's
    // getPeerName) and can lag briefly right after an e2e bootstrap's rename — a known,
    // already-documented staleness window, not something this filter feature owns.
    const jerryContact = pageTom.locator(`#contacts-list .contact-item[data-contact-user-id="${jerryId}"]`);
    const bobContact = pageTom.locator(`#contacts-list .contact-item[data-contact-user-id="${bobId}"]`);

    await pageTom.selectOption('#contacts-filter-outcome', 'matched');
    await afterAction();
    await expect(pageTom.locator('#contacts-list .contact-item:not([data-support-contact="true"])')).toHaveCount(1, { timeout: 10_000 });
    await expect(jerryContact).toBeVisible({ timeout: 5_000 });
    await expect(bobContact).toHaveCount(0);

    await pageTom.selectOption('#contacts-filter-outcome', 'unmatched');
    await afterAction();
    await expect(pageTom.locator('#contacts-list .contact-item:not([data-support-contact="true"])')).toHaveCount(1, { timeout: 10_000 });
    await expect(bobContact).toBeVisible({ timeout: 5_000 });
    await expect(jerryContact).toHaveCount(0);

    await pageTom.selectOption('#contacts-filter-outcome', 'all');
    await afterAction();

    // ── Peer-detail history outcome filter ───────────────────────────────────
    await pageTom.locator(`.contact-item[data-contact-user-id="${jerryId}"]`).first().click();
    await afterNav();
    await waitForContactDetailReady(pageTom);
    await expect(pageTom.locator('.peer-history-item')).toHaveCount(2, { timeout: 10_000 });

    await pageTom.locator('.peer-outcome-tab[data-outcome="match"]').click();
    await afterAction();
    await expect(pageTom.locator('.peer-history-item')).toHaveCount(2, { timeout: 10_000 });
    await pageTom.locator('.peer-outcome-tab[data-outcome="mismatch"]').click();
    await afterAction();
    await expect(pageTom.locator('.peer-history-item')).toHaveCount(0, { timeout: 10_000 });
    await pageTom.locator('.peer-outcome-tab[data-outcome="all"]').click();
    await afterAction();

    // ── Peer-history title → Talks tab responses list (Book Club, direction 'sent') ──
    const bookClubTitleLink = pageTom.locator('.peer-history-title-link').filter({ hasText: TALK_BOOK_CLUB });
    await expect(bookClubTitleLink).toBeVisible({ timeout: 10_000 });
    // Chess is direction 'received' for Tom — plain text, not a link.
    await expect(pageTom.locator('.peer-history-title-link').filter({ hasText: TALK_CHESS })).toHaveCount(0);
    await bookClubTitleLink.click();
    await afterNav();
    await waitForTabActive(pageTom, 'talks');
    await expect(pageTom.locator('#creator-replies-panel')).toBeVisible({ timeout: 10_000 });
    await expect(pageTom.locator('#reply-scope-chip')).toContainText(TALK_BOOK_CLUB, { timeout: 10_000 });
    await expect(pageTom.locator('.creator-reply-row')).toHaveCount(2, { timeout: 10_000 });
    await expect(pageTom.locator(`.creator-reply-row[data-responder-id="${jerryId}"]`)).toContainText('Match', { timeout: 5_000 });
    await expect(pageTom.locator(`.creator-reply-row[data-responder-id="${bobId}"]`)).toContainText('Mismatch', { timeout: 5_000 });

    // Clear scope, then clicking a reply row navigates to that responder's contact detail.
    await pageTom.locator('#reply-scope-chip').click();
    await afterAction();
    await expect(pageTom.locator('#creator-replies-panel')).toBeVisible();

    // ── Talk row's own "View Responses" button (independent entry point) ─────
    await pageTom.click('.nav-btn[data-view="chatrooms"]');
    await afterNav();
    await pageTom.click('.nav-btn[data-view="talks"]');
    await waitForTabActive(pageTom, 'talks');
    await afterSync();
    const bookClubRow = pageTom.locator('.talk-list-item[data-role="created"]').filter({ hasText: TALK_BOOK_CLUB });
    await expect(bookClubRow.first()).toBeVisible({ timeout: 15_000 });
    const box = await bookClubRow.first().boundingBox();
    if (!box) throw new Error('Book Club row has no bounding box');
    await pageTom.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await pageTom.mouse.down();
    await pageTom.waitForTimeout(650);
    await pageTom.mouse.up();
    await expect(pageTom.locator('#item-details-popup')).toBeVisible({ timeout: 10_000 });
    const viewResponsesBtn = pageTom.locator('#item-details-popup .talk-view-responses-btn');
    await expect(viewResponsesBtn).toBeVisible({ timeout: 10_000 });
    await expect(viewResponsesBtn).toContainText('2');
    await viewResponsesBtn.click();
    await afterNav();
    await expect(pageTom.locator('#creator-replies-panel')).toBeVisible({ timeout: 10_000 });
    await expect(pageTom.locator('.creator-reply-row')).toHaveCount(2, { timeout: 10_000 });

    // Clicking Jerry's reply row jumps to Jerry's contact detail — verified by peer
    // identity (Jerry's Chess talk shows in the history), not by display name (see the
    // data-contact-user-id note above).
    await pageTom.locator(`.creator-reply-row[data-responder-id="${jerryId}"]`).click();
    await afterNav();
    await waitForContactDetailReady(pageTom, 30_000);
    await expect(pageTom.locator('.peer-history-item').filter({ hasText: TALK_CHESS })).toBeVisible({ timeout: 10_000 });
  });
});
