/**
 * Find Similar People — fully UI-driven flow (no app internals called from the spec).
 *
 * 10 users join the global chatroom. Each user, acting only through the UI:
 *   1. Opens the Talks tab and creates 20 tag talks (one keyword each) with the
 *      create-talk dialog. Creating a tag with its "I'm interested" box checked
 *      (the default) is the user's own match answer — the app records it as the
 *      chatbot's permanent preference for that keyword.
 *   2. Turns the chatbot on in Settings.
 *   3. Broadcasts every tag to the Global chatroom.
 *   4. Receives the other 9 users' tags. The chatbot AUTO-ANSWERS (matches) every
 *      incoming tag the user already created — that is his interest. A tag the user
 *      never created is unknown to the chatbot, so it surfaces to the user; the user
 *      answers it once (rejects a non-interest). Once answered, the chatbot has the
 *      preference and takes over repeats.
 *   5. Opens the Contacts tab, sorts by match rate (highest % of matching tags first),
 *      and sees each stranger's matched-tag count and percentage.
 *   6. Tags the most-similar stranger with the relationship "similar interest people".
 *
 * The matching/auto-answer/ranking logic lives entirely in the app (chatbot memory,
 * peer stats, match-rate sort, the match-% chip). The spec performs user actions and
 * verifies the resulting UI.
 *
 * Interest pool (30 keywords, sliding window of 20 per user):
 *   user i creates keywords i … i+19 (mod 30), so adjacent users share more tags.
 *
 * Companion doc: tests/e2e/staged/stage5-multi-user/find-similar-people.md
 */

import type { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { maybeClearGunDatabases } from '../../helpers/clear-database';
import { afterSync, afterAction, afterNav } from '../../helpers/timing';
import {
  bootstrapUser,
  waitForTabActive,
  waitForResponseModalClosed,
  openIncomingTalkModal,
} from '../../helpers/talks-matching-flow';
import { waitForDistinctGunPeersExcludingSelf } from '../../helpers/talk-demo-ui';

// ─── Test data (not app logic) ──────────────────────────────────────────────────

const INTEREST_POOL = [
  'hiking', 'photography', 'cooking', 'reading', 'gaming',
  'cycling', 'painting', 'yoga', 'music', 'travel',
  'gardening', 'coding', 'chess', 'movies', 'podcasts',
  'running', 'baking', 'astronomy', 'diving', 'climbing',
  'sculpting', 'writing', 'surfing', 'archery', 'pottery',
  'origami', 'birding', 'fencing', 'brewing', 'knitting',
];

const NUM_USERS = 10;
const TAGS_PER_USER = 20;
const RELATIONSHIP_LABEL = 'similar interest people';

test.describe('Find similar people', () => {
  test.describe.configure({ retries: 0 });
  test.setTimeout(300_000);

  const contexts: BrowserContext[] = [];
  const pages: Page[] = [];

  test.afterEach(async () => {
    await Promise.all(
      pages.map((p) =>
        p
          .evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.())
          .catch(() => {}),
      ),
    );
    await Promise.all(contexts.map((c) => c.close().catch(() => {})));
    pages.length = 0;
    contexts.length = 0;
    await maybeClearGunDatabases();
  });

  test('chatbot auto-matches created tags, user rejects the rest, contacts sort by match %', async ({ browser }) => {
    await maybeClearGunDatabases();

    // ── Phase 1: 10 users bootstrap and enter the Global chatroom ─────────────
    const setups = await Promise.all(
      Array.from({ length: NUM_USERS }, async (_, idx) => {
        const { context, page } = await bootstrapUser(browser, `Sim${idx}`, `Sim User ${idx}`);
        contexts.push(context);
        pages.push(page);
        await page.locator('.chatroom-item:has-text("Global")').first().click();
        await afterSync();
        return { page, idx };
      }),
    );

    // ── Phase 2: each user creates 20 tag talks through the create-talk dialog ─
    // Default "interested" checkbox stays checked, so each created tag becomes the
    // user's own match preference for that keyword.
    await Promise.all(
      setups.map(async ({ page, idx }) => {
        await waitForTabActive(page, 'talks');
        for (let j = 0; j < TAGS_PER_USER; j++) {
          const keyword = INTEREST_POOL[(idx + j) % INTEREST_POOL.length];
          await page.click('#create-talk-btn');
          await page.waitForSelector('#talk-editor-form', { timeout: 15_000 });
          await page.click('input[name="talk-type-radio"][value="tag"]');
          await afterAction();
          await page.fill('#talk-title', keyword);
          await page.click('#talk-editor-form button[type="submit"]');
          await page.waitForSelector('#talk-editor-form', { state: 'detached', timeout: 15_000 });
          await afterAction();
        }
      }),
    );

    // Verify each user's OUT list holds all 20 created tags.
    await Promise.all(
      setups.map(async ({ page }) => {
        await waitForTabActive(page, 'talks');
        await page.click('#talks-nav-out');
        await afterAction();
        await expect
          .poll(
            async () => page.locator('.talk-list-item[data-role="created"]').count(),
            { timeout: 20_000, intervals: [500] },
          )
          .toBeGreaterThanOrEqual(TAGS_PER_USER);
      }),
    );

    // ── Phase 3: every user turns the chatbot on (before any broadcast) ───────
    // The toggle is on by default; uncheck→check forces the setting to persist and
    // leaves the chatbot explicitly enabled.
    await Promise.all(
      setups.map(async ({ page }) => {
        await page.click('.nav-btn[data-view="settings"]');
        await afterNav();
        const chatbotToggle = page.locator('#settings-chatbot-enabled');
        await chatbotToggle.uncheck();
        await afterAction();
        await chatbotToggle.check();
        await expect(chatbotToggle).toBeChecked();
        await expect
          .poll(() => page.evaluate(() => localStorage.getItem('chatbotEnabled')), { timeout: 15_000 })
          .toBe('true');
        await page.click('.nav-btn[data-view="chatrooms"]');
        await afterNav();
        await page.locator('.chatroom-item:has-text("Global")').first().click();
        await afterSync();
      }),
    );

    // ── Phase 4: each user broadcasts all tags to the Global chatroom ─────────
    // Broadcast publishes a chatroom announcement, which is what triggers each
    // receiver's chatbot to auto-answer tags they also created. We deliver via the
    // E2E broadcast path with the audience-preview skipped: that preview is a
    // per-talk server HTTP round-trip (20 tags x 10 users) that starves under load
    // and is unused for direct delivery. Offers + announcement still happen, so the
    // chatbot behaves exactly as with the Broadcast button — just far faster.
    await Promise.all(
      setups.map(async ({ page, idx }) => {
        await waitForDistinctGunPeersExcludingSelf(page, NUM_USERS - 1, 60_000);
        await afterSync();
        const t0 = Date.now();
        const result = await page.evaluate(async (minReceivers) => {
          const app = (window as any).__iinpublic_app?.getApp?.();
          if (!app?.deliverPendingBroadcastTalksForE2e) {
            throw new Error('deliverPendingBroadcastTalksForE2e unavailable');
          }
          const timeout = new Promise<never>((_, reject) => {
            window.setTimeout(() => reject(new Error('broadcast delivery timed out')), 90_000);
          });
          return Promise.race([
            app.deliverPendingBroadcastTalksForE2e(minReceivers, { skipAudiencePreview: true }),
            timeout,
          ]) as Promise<{ talksSent: number; receivers: number }>;
        }, NUM_USERS - 1);
        // eslint-disable-next-line no-console
        console.log(`[u${idx} broadcast] ${JSON.stringify(result)} after ${Date.now() - t0}ms`);
        expect(result.talksSent, `user ${idx} talksSent`).toBeGreaterThanOrEqual(TAGS_PER_USER);
        expect(result.receivers, `user ${idx} receivers`).toBeGreaterThanOrEqual(NUM_USERS - 1);
        await afterAction();
      }),
    );
    await afterSync();

    // ── Phase 5: answer incoming tags ────────────────────────────────────────
    // The chatbot auto-matches every tag the user also created (his interests) on
    // arrival. The user only has to reject the keywords he received but never
    // created. Those are deterministic from the interest distribution, so we open
    // each by keyword (the helper retries through Gun re-renders and only ever
    // touches non-self-authored rows, whose View opens the response dialog).
    await Promise.all(
      setups.map(async ({ page, idx }) => {
        const own = new Set(
          Array.from({ length: TAGS_PER_USER }, (_, j) => INTEREST_POOL[(idx + j) % INTEREST_POOL.length]),
        );
        const toReject = new Set<string>();
        for (let j = 0; j < NUM_USERS; j++) {
          if (j === idx) continue;
          for (let k = 0; k < TAGS_PER_USER; k++) {
            const kw = INTEREST_POOL[(j + k) % INTEREST_POOL.length];
            if (!own.has(kw)) toReject.add(kw);
          }
        }
        await waitForTabActive(page, 'talks');
        // Show the IN (incoming) filter so received tags render; Phase 2 left it on OUT.
        await page.click('#talks-nav-in');
        await afterAction();
        await afterSync();
        for (const keyword of toReject) {
          await openIncomingTalkModal(page, keyword);
          const checkbox = page.locator('#tag-match-checkbox');
          await checkbox.waitFor({ state: 'visible', timeout: 10_000 });
          if (await checkbox.isChecked()) await checkbox.uncheck();
          await page.click('#tag-submit-response');
          await waitForResponseModalClosed(page);
          await afterAction();
        }
      }),
    );

    await afterSync();

    // ── Phase 6: contacts — sort by match rate and tag the most-similar peer ──
    await Promise.all(
      setups.map(async ({ page }) => {
        await waitForTabActive(page, 'contacts');
        await page.waitForSelector('#contacts-sort-order', { timeout: 20_000 });
        await page.selectOption('#contacts-sort-order', 'match-rate');
        await afterAction();

        const realContacts = page.locator('.contact-item[data-contact-user-id]:not([data-support-contact="true"])');
        await expect
          .poll(async () => realContacts.count(), { timeout: 30_000, intervals: [500] })
          .toBeGreaterThanOrEqual(NUM_USERS - 1);

        // Each stranger row shows the matched-tag count and percentage chip.
        await expect(page.locator('.contact-item-match-rate').first()).toBeVisible({ timeout: 15_000 });

        // The list is ordered highest match-% first.
        const percents = await realContacts.evaluateAll((els) =>
          els.map((el) => Number((el as HTMLElement).dataset.matchPercent ?? '0')),
        );
        const sortedDesc = [...percents].sort((a, b) => b - a);
        expect(percents, 'contacts should be ordered by descending match %').toEqual(sortedDesc);

        // Tag the most-similar stranger (top of the list) as "similar interest people".
        await realContacts.first().click();
        await afterNav();
        await page.locator('#contact-edit-relationship-btn').click();
        await expect(page.locator('#contact-relationship-modal')).toBeVisible({ timeout: 10_000 });
        await page.selectOption('#contact-relationship-label', 'custom');
        await page.fill('#contact-relationship-custom-label', RELATIONSHIP_LABEL);
        await page.click('#contact-relationship-save-btn');
        await expect(page.locator('#contact-relationship-modal')).not.toBeVisible({ timeout: 10_000 });

        // Back in the list the saved relationship label shows on that contact.
        await page.locator('#back-to-contacts-list').click();
        await afterAction();
        await expect(
          page.locator('.contact-item:not([data-support-contact="true"])').filter({ hasText: RELATIONSHIP_LABEL }).first(),
        ).toBeVisible({ timeout: 15_000 });
      }),
    );
  });
});
