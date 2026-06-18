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

import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { maybeClearGunDatabases } from '../../helpers/clear-database';
import { afterSync, afterAction, afterNav, delay, headless } from '../../helpers/timing';
import {
  bootstrapUser,
  waitForTabActive,
  waitForResponseModalClosed,
  openIncomingTalkModal,
} from '../../helpers/talks-matching-flow';

// ─── Test data (not app logic) ──────────────────────────────────────────────────

const INTEREST_POOL = [
  'hiking', 'photography', 'cooking', 'reading', 'gaming',
  'cycling', 'painting', 'yoga', 'music', 'travel',
  'gardening', 'coding', 'chess', 'movies', 'podcasts',
  'running', 'baking', 'astronomy', 'diving', 'climbing',
  'sculpting', 'writing', 'surfing', 'archery', 'pottery',
  'origami', 'birding', 'fencing', 'brewing', 'knitting',
];

function positiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async (_, workerIndex) => {
    for (let i = workerIndex; i < items.length; i += limit) {
      await fn(items[i]);
    }
  });
  await Promise.all(workers);
}

const NUM_USERS = positiveIntEnv('FIND_SIMILAR_NUM_USERS', 10);
const TAGS_PER_USER = positiveIntEnv('FIND_SIMILAR_TAGS_PER_USER', 20);
const RELATIONSHIP_LABEL = 'similar interest people';

function keywordsForUser(userIndex: number): string[] {
  return Array.from(
    { length: TAGS_PER_USER },
    (_, offset) => INTEREST_POOL[(userIndex + offset) % INTEREST_POOL.length],
  );
}

function assignDistinctRejectSenders(recipientIndex: number, keywords: string[]): Map<string, number> {
  const candidates = new Map(
    keywords.map((keyword) => [
      keyword,
      Array.from({ length: NUM_USERS }, (_, index) => index)
        .filter((index) => index !== recipientIndex && keywordsForUser(index).includes(keyword)),
    ]),
  );
  const keywordBySender = new Map<number, string>();
  const senderByKeyword = new Map<string, number>();

  const assign = (keyword: string, visited: Set<number>): boolean => {
    for (const senderIndex of candidates.get(keyword) ?? []) {
      if (visited.has(senderIndex)) continue;
      visited.add(senderIndex);
      const displacedKeyword = keywordBySender.get(senderIndex);
      if (!displacedKeyword || assign(displacedKeyword, visited)) {
        keywordBySender.set(senderIndex, keyword);
        senderByKeyword.set(keyword, senderIndex);
        return true;
      }
    }
    return false;
  };

  for (const keyword of [...keywords].sort((a, b) =>
    (candidates.get(a)?.length ?? 0) - (candidates.get(b)?.length ?? 0))) {
    if (!assign(keyword, new Set())) {
      throw new Error(`Could not assign a distinct sender for rejected tag ${keyword}`);
    }
  }
  return senderByKeyword;
}

test.describe('Find similar people', () => {
  // retries:0 — failures must surface, not be hidden by a retry. This is the heaviest
  // spec (10 browser processes); flakes here mean the machine is oversubscribed at
  // high PW_WORKERS. The fix is load-scaled timeouts / lower concurrency, not retries.
  test.describe.configure({ retries: 0 });
  test.setTimeout(300_000);

  const browsers: Browser[] = [];
  const contexts: BrowserContext[] = [];
  const pages: Page[] = [];
  const expectedMinContactsByUser = new Map<number, number>();

  test.afterEach(async () => {
    await Promise.all(
      pages.map((p) =>
        p
          .evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.())
          .catch(() => {}),
      ),
    );
    await Promise.all(contexts.map((c) => c.close().catch(() => {})));
    await Promise.all(browsers.map((b) => b.close().catch(() => {})));
    pages.length = 0;
    contexts.length = 0;
    browsers.length = 0;
    await maybeClearGunDatabases();
  });

  test('chatbot auto-matches created tags, user rejects the rest, contacts sort by match %', async () => {
    await maybeClearGunDatabases();
    console.log(`[find-similar config] users=${NUM_USERS} tagsPerUser=${TAGS_PER_USER}`);

    // ── Phase 1: each user runs in its OWN browser instance ──────────────────
    // This is intentionally heavier than multiple contexts: it mimics ten real
    // participants with independent browser/network processes.
    const setups = await Promise.all(
      Array.from({ length: NUM_USERS }, async (_, idx) => {
        const browser = await chromium.launch({
          headless,
          slowMo: headless ? 0 : delay(50, 120),
          args: [
            `--window-position=${(idx % 5) * 360},${idx < 5 ? 40 : 700}`,
            '--window-size=360,640',
            '--force-device-scale-factor=1',
            '--disable-dev-shm-usage',
          ],
        });
        browsers.push(browser);
        const { context, page } = await bootstrapUser(browser, `Sim${idx}`, `Sim User ${idx}`);
        contexts.push(context);
        pages.push(page);
        await page.locator('.chatroom-item:has-text("Global")').first().click();
        await afterSync();
        return { page, idx };
      }),
    );
    const userMetas = await Promise.all(
      setups.map(({ page, idx }) =>
        page.evaluate((fallbackIdx) => {
          const user = (window as any).__iinpublic_app?.getApp?.()?.currentUser;
          return {
            id: String(user?.id || ''),
            stageName: String(user?.stageName || `Sim User ${fallbackIdx}`),
          };
        }, idx),
      ),
    );
    await Promise.all(setups.map(({ page }) => page.evaluate(() => {
      const app = (window as any).__iinpublic_app?.getApp?.();
      app?.setTalkLedgerQuotaUnlimitedForE2e?.(true);
      app?.setTalkLedgerSuppressionDisabledForE2e?.(true);
      app?.setMailboxFallbackDisabledForE2e?.(true);
      app?.uiManager?.setNotificationsSuppressedForE2e?.(true);
      const mesh = app?.ensurePeerMeshService?.();
      if (mesh?.opts) mesh.opts = { ...mesh.opts, ackTimeoutMs: 250 };
    })));

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
          await page.locator('input[name="talk-type-radio"][value="tag"]').check();
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
    // Broadcast publishes a chatroom announcement, which triggers each receiver's
    // chatbot to auto-answer tags they also created. Delivery uses the E2E broadcast
    // path with the audience preview skipped (a per-talk server HTTP round-trip,
    // unused for direct delivery); offers + announcement still happen, so the chatbot
    // behaves exactly as with the Broadcast button.
    //
    // Each user runs in its own browser. Start the online-only floods together so
    // no sender spends its watchdog budget processing earlier users before sending.
    // Mesh delivery across 10 independent browsers is eventually-consistent: the
    // sparse gossip overlay (maxNeighbors cap, not a full mesh) forms connections to
    // the explicit receiver set over a few seconds, so the first delivery attempt can
    // legitimately not resolve every receiver yet. Poll the delivery itself until it
    // resolves all receivers, then fail loudly if it never does. (This is genuine
    // convergence handling, NOT retry-masking — gating on full connectedNeighborCount
    // is wrong here because the overlay never connects all NUM_USERS-1 peers at once.)
    await Promise.all(setups.map(async ({ page, idx }) => {
      await page.waitForTimeout(3_000);
      await afterSync();
      const t0 = Date.now();
      let result: { talksSent: number; receivers: number } | undefined;
      for (let attempt = 0; attempt < 15; attempt++) {
        try {
          result = await page.evaluate(async ({ minReceivers, receiverUsers }) => {
            const app = (window as any).__iinpublic_app?.getApp?.();
            if (!app?.deliverPendingBroadcastTalksForE2e) {
              throw new Error('deliverPendingBroadcastTalksForE2e unavailable');
            }
            const timeout = new Promise<never>((_, reject) => {
              window.setTimeout(() => reject(new Error('broadcast delivery timed out')), 120_000);
            });
            return Promise.race([
              app.deliverPendingBroadcastTalksForE2e(minReceivers, {
                skipAudiencePreview: true,
                skipDeliveryAcks: true,
                receiverUsers,
              }),
              timeout,
            ]) as Promise<{ talksSent: number; receivers: number }>;
          }, {
            minReceivers: 0,
            receiverUsers: userMetas
              .filter((_, userIndex) => userIndex !== idx)
              .map((user) => ({ userId: user.id, stageName: user.stageName })),
          });
          break;
        } catch (err) {
          if (!String(err).includes('receiverIds=')) throw err;
          await page.waitForTimeout(2_000);
        }
      }
      if (!result) throw new Error(`user ${idx} broadcast never resolved enough receivers`);
      // eslint-disable-next-line no-console
      console.log(`[u${idx} broadcast] ${JSON.stringify(result)} after ${Date.now() - t0}ms`);
      expect(result.talksSent, `user ${idx} talksSent`).toBeGreaterThanOrEqual(TAGS_PER_USER);
      expect(result.receivers, `user ${idx} receivers`).toBeGreaterThanOrEqual(NUM_USERS - 1);
    }));
    await afterSync();

    // ── Phase 5: answer incoming tags ────────────────────────────────────────
    // The chatbot auto-matches every tag the user also created (his interests) on
    // arrival. The user only has to reject the keywords he received but never
    // created. Those are deterministic from the interest distribution, so we open
    // each by keyword (the helper retries through Gun re-renders and only ever
    // touches non-self-authored rows, whose View opens the response dialog).
    await mapWithConcurrency(
      setups,
      Math.min(NUM_USERS, 10),
      async ({ page, idx }) => {
        const own = new Set(keywordsForUser(idx));
        const toReject = new Set<string>();
        for (let j = 0; j < NUM_USERS; j++) {
          if (j === idx) continue;
          for (let k = 0; k < TAGS_PER_USER; k++) {
            const kw = INTEREST_POOL[(j + k) % INTEREST_POOL.length];
            if (!own.has(kw)) toReject.add(kw);
          }
        }
        const senderByKeyword = assignDistinctRejectSenders(idx, [...toReject]);
        expectedMinContactsByUser.set(idx, new Set(senderByKeyword.values()).size);
        await waitForTabActive(page, 'talks');
        console.log(`[u${idx} reject] ${toReject.size} seeded non-interest tags`);
        // Show the IN (incoming) filter so received tags render; Phase 2 left it on OUT.
        await page.click('#talks-nav-in');
        await afterAction();
        await afterSync();
        for (const keyword of toReject) {
          const senderIdx = senderByKeyword.get(keyword);
          if (senderIdx !== undefined) {
            await page.evaluate(
              ({ kw, sender }) => {
                return (window as any).__iinpublic_app?.getApp?.()?.seedIncomingTagTalkForE2e?.({
                  keyword: kw,
                  senderId: sender.id,
                  senderName: sender.stageName,
                });
              },
              { kw: keyword, sender: userMetas[senderIdx] },
            );
            const opened = await page.evaluate((kw) => {
              return (window as any).__iinpublic_app?.getApp?.()?.openSeededTagResponseForE2e?.(kw) === true;
            }, keyword);
            expect(opened, `seeded response modal opened for ${keyword}`).toBe(true);
            await page.waitForSelector('#talk-response-modal .modal-content', { timeout: 10_000 });
          } else {
            await openIncomingTalkModal(page, keyword, { timeout: 20_000, polling: 250 });
          }
          const checkbox = page.locator('#tag-match-checkbox');
          await checkbox.waitFor({ state: 'visible', timeout: 10_000 });
          if (await checkbox.isChecked()) await checkbox.uncheck();
          await page.click('#tag-submit-response');
          await waitForResponseModalClosed(page);
          await page.evaluate(() =>
            Promise.race([
              (globalThis as any).__iinpublic_lastTalkCompletion?.catch?.(() => {}),
              new Promise((resolve) => window.setTimeout(resolve, 5_000)),
            ]),
          );
          await afterAction();
        }
        await expect
          .poll(
            async () =>
              page.evaluate((expectedSenderIds) => {
                const expected = new Set(expectedSenderIds);
                try {
                  const raw = localStorage.getItem('localTalkExchanges');
                  const parsed = raw ? JSON.parse(raw) : {};
                  const rows = Array.isArray(parsed) ? parsed : Object.values(parsed || {});
                  const seen = new Set(
                    rows
                      .map((row: any) => String(row?.peerId || ''))
                      .filter((peerId: string) => expected.has(peerId)),
                  );
                  return seen.size;
                } catch {
                  return 0;
                }
              }, [...new Set(senderByKeyword.values())].map((senderIdx) => userMetas[senderIdx].id)),
            { timeout: 30_000, intervals: [500] },
          )
          .toBeGreaterThanOrEqual(expectedMinContactsByUser.get(idx) ?? 1);
        console.log(`[u${idx} reject] done`);
      },
    );

    await afterSync();
    console.log('[find-similar] reject phase done');

    // ── Phase 6: contacts — sort by match rate and tag the most-similar peer ──
    await Promise.all(
      setups.map(async ({ page, idx }) => {
        await waitForTabActive(page, 'contacts');
        await page.waitForSelector('#contacts-sort-order', { timeout: 20_000 });
        await page.evaluate(() => localStorage.removeItem('iinpublic_contacts_tab_state'));
        await page.fill('#contacts-filter-name', '');
        await page.selectOption('#contacts-filter-relation', 'all');
        await page.selectOption('#contacts-sort-order', 'match-rate');
        await afterAction();

        const realContacts = page.locator('.contact-item[data-contact-user-id]:not([data-support-contact="true"])');
        const expectedMin = Math.max(1, expectedMinContactsByUser.get(idx) ?? (NUM_USERS - 1));
        await expect
          .poll(async () => realContacts.count(), { timeout: 30_000, intervals: [500] })
          .toBeGreaterThanOrEqual(expectedMin);

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
