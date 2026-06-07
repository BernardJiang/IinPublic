/**
 * Find Similar People — full UI-driven flow
 *
 * 10 users join the global chatroom. Each user:
 *   1. Creates 20 tag-type talks (one per interest) via page.evaluate → talkService + saveCreatedTalk.
 *   2. Goes to GlobalRoom and broadcasts all talks (confirms the preamble modal).
 *   3. Receives tags from the other 9 users, answers ONE manually in the response dialog.
 *   4. The chatbot (pre-seeded with the user's interest preferences) auto-answers the rest.
 *   5. Navigates to the Contacts tab, sorts by "weighted" relevance score, and the users
 *      with the most overlapping interests appear at the top.
 *
 * Similarity is defined by the app's weighted relevance score:
 *   matchedTalks × 100 + matchRate × 25 + recencyBoost + relationshipBoost
 * With the sliding-window interest assignment, adjacent users share more tags and therefore
 * appear higher — no test-side sort function required.
 *
 * Interest pool (30 items, 20 per user):
 *   User i → interests[i .. i+19] (mod 30)
 *   Users 0 and 1 share 19 interests (95%), users 0 and 9 share 11 (55%), etc.
 *
 * Companion doc: tests/e2e/staged/stage5-multi-user/find-similar-people.md
 */

import type { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { maybeClearGunDatabases, injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { afterSync, afterAction } from '../../helpers/timing';
import { gunBaseURL, webAppURLStableChatroom } from '../../helpers/ports';
import {
  createEmptyExactChatbotMemoryState,
  savePermanentAnswer,
  LOCAL_EXACT_CHATBOT_USER_ID,
} from '../../../../src/shared/exact-chatbot-memory';

// ─── Interest pool ─────────────────────────────────────────────────────────────

const INTEREST_POOL = [
  'hiking', 'photography', 'cooking', 'reading', 'gaming',
  'cycling', 'painting', 'yoga', 'music', 'travel',
  'gardening', 'coding', 'chess', 'movies', 'podcasts',
  'running', 'baking', 'astronomy', 'diving', 'climbing',
  'sculpting', 'writing', 'surfing', 'archery', 'pottery',
  'origami', 'birding', 'fencing', 'brewing', 'knitting',
] as const;

const NUM_USERS = 10;
const TAGS_PER_USER = 20;

function interestsFor(i: number): string[] {
  return Array.from(
    { length: TAGS_PER_USER },
    (_, j) => (INTEREST_POOL as readonly string[])[(i + j) % INTEREST_POOL.length],
  );
}

// ─── Chatbot pre-seed ─────────────────────────────────────────────────────────
//
// Build an ExactChatbotMemoryState with PERMANENT answers for all 30 interest
// questions: "Yes!" for interests the user has, "Not really" for the rest.
// Injected into localStorage so the chatbot is ready before any talk arrives.

function buildChatbotMemoryJson(userIdx: number): string {
  const state = createEmptyExactChatbotMemoryState();
  const mine = new Set(interestsFor(userIdx));
  const now = Date.now();
  for (const interest of INTEREST_POOL) {
    savePermanentAnswer(
      state,
      LOCAL_EXACT_CHATBOT_USER_ID,
      `Are you into: ${interest}?`,
      mine.has(interest) ? "Yes!" : 'Not really',
      now,
      { language: 'en' },
    );
  }
  return JSON.stringify(state);
}

// ─── API helpers ───────────────────────────────────────────────────────────────

function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(`${gunBaseURL()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ─── Test ──────────────────────────────────────────────────────────────────────

test.describe('Find similar people', () => {
  test.setTimeout(600_000);

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

  test(
    'users broadcast tag talks, chatbot answers by interest match, contacts sort by relevance',
    async ({ browser }) => {
      await maybeClearGunDatabases();

      // ── Phase 1: launch 10 browsers with chatbot pre-seeded ─────────────────
      //
      // Chatbot is pre-configured with PERMANENT answers for all 30 interest
      // questions before the app loads. That way incoming tags are answered
      // automatically — the test still clicks ONE manually to show the UI flow.

      const stageNames = Array.from({ length: NUM_USERS }, (_, i) => `Sim User ${i}`);

      const setups = await Promise.all(
        Array.from({ length: NUM_USERS }, async (_, i) => {
          const context = await browser.newContext({
            viewport: { width: 640, height: 900 },
            deviceScaleFactor: 1,
          });
          const page = await context.newPage();
          contexts.push(context);
          pages.push(page);

          await injectIdbClear(page);
          await page.addInitScript(
            ({
              chatbotJson,
              stageName,
            }: {
              chatbotJson: string;
              stageName: string;
            }) => {
              // Chatbot: starts disabled so the first incoming talk can be answered
              // manually; re-enabled after that one click.
              localStorage.setItem('chatbotEnabled', 'false');
              localStorage.setItem('exactChatbotMemory', chatbotJson);
              // Start in global chatroom.
              localStorage.setItem('iinpublic_last_chatroom', 'global');
              // Stage name shown in UI (picked up by app on first render).
              (window as any).__test_stage_name_override = stageName;
            },
            { chatbotJson: buildChatbotMemoryJson(i), stageName: stageNames[i] },
          );

          await gotoWebApp(page, webAppURLStableChatroom());
          // gotoWebApp calls waitForAppReady — currentUser.id is available.

          const userId = await page.evaluate(
            () => (window as any).__iinpublic_app?.getApp?.()?.currentUser?.id as string,
          );
          if (!userId) throw new Error(`browser ${i} has no Gun user ID after load`);

          return { context, page, userId, stageName: stageNames[i] };
        }),
      );

      const userIds = setups.map((s) => s.userId);

      // ── Phase 2: register users server-side ──────────────────────────────────
      //
      // The server needs a user record with talkFilters so that
      // register-receivers-for-broadcast can evaluate delivery rules.

      await Promise.all(
        userIds.map(async (id, i) => {
          const r = await postJson('/api/users', {
            id,
            stageName: stageNames[i],
            languages: ['en'],
            profile: [],
            interests: [],
            talkFilters: {
              allowedLanguages: ['en'],
              minDistanceMiles: 0,
              maxDistanceMiles: 999_999,
              requireGoodGrammar: false,
              blockDirtyWords: false,
              allowedTalkTypes: ['flow', 'survey', 'tag', 'route'],
            },
          });
          if (!r.ok && r.status !== 400) {
            throw new Error(`register user ${i}: ${r.status} ${await r.text()}`);
          }
        }),
      );

      await Promise.all(
        userIds.map(async (id, i) => {
          const r = await postJson('/api/chatrooms/global/members', {
            userId: id,
            stageName: stageNames[i],
          });
          if (!r.ok) throw new Error(`join chatroom ${i}: ${r.status} ${await r.text()}`);
        }),
      );

      // ── Phase 3: each user creates 20 tag talks via page.evaluate ─────────────
      //
      // Directly calls app.talkService.createTalk() (Gun write) then
      // app.uiManager.saveCreatedTalk() (localStorage myTalks update).
      // This is fast and avoids the UI form/dialog entirely.
      // saveCreatedTalk records the talk with role="created" so it shows in OUT
      // and is included in getBroadcastableTalkIds().

      await Promise.all(
        setups.map(async ({ page }, i) => {
          await page.evaluate(async (interests: string[]) => {
            const app = (window as any).__iinpublic_app?.getApp?.();
            const uiManager = app?.uiManager;
            const talkService = app?.talkService;
            const userId = app?.currentUser?.id as string | undefined;
            if (!app || !uiManager || !talkService || !userId) {
              throw new Error('App not ready: missing app/uiManager/talkService/currentUser');
            }
            for (const interest of interests) {
              const slug = (interest as string).toLowerCase().replace(/\s+/g, '_');
              const questionId = `q_${slug}`;
              const yesAnswerId = `a_yes_${slug}`;
              const noAnswerId = `a_no_${slug}`;
              const question = {
                id: questionId,
                text: `Are you into: ${interest}?`,
                answers: [
                  { id: yesAnswerId, text: "Yes!", isMatch: true, isTerminal: true },
                  { id: noAnswerId, text: 'Not really', isIgnore: true, isTerminal: true },
                ],
              };
              const talk = await talkService.createTalk({
                authorId: userId,
                type: 'tag',
                title: `Interest: ${interest}`,
                language: 'en',
                questions: [question],
              });
              uiManager.saveCreatedTalk(talk, {
                selfAnswers: [{ questionId, answerId: yesAnswerId }],
              });
            }
          }, interestsFor(i));
        }),
      );

      // Verify each user's OUT section shows all 20 created talks.
      // Navigate to talks tab then OUT filter so displayTalksList() runs.
      await Promise.all(
        setups.map(async ({ page }, i) => {
          // Navigate to talks view to trigger render.
          await page.click('.nav-btn[data-view="talks"]');
          await page.waitForSelector('#talks-nav-out', { timeout: 10_000 });
          await page.click('#talks-nav-out');
          await page.waitForSelector(
            `.talk-list-item[data-role="created"]`,
            { timeout: 20_000 },
          );
          const outCount = await page.evaluate(
            () => document.querySelectorAll('.talk-list-item[data-role="created"]').length,
          );
          expect(outCount, `user ${i} OUT section should show 20 talks`).toBeGreaterThanOrEqual(20);

          // Return to chatrooms view for broadcast.
          await page.click('[data-testid="bottom-navigation-button-chat"]');
        }),
      );

      // ── Phase 4: wait for all members, then broadcast ────────────────────────
      //
      // Poll until each browser sees all 10 test users in the global chatroom,
      // then click Broadcast and confirm the preamble modal.

      await Promise.all(
        setups.map(async ({ page }) => {
          // Wait for all 10 test users to appear in this browser's chatroom member list.
          await expect
            .poll(
              async () =>
                page.evaluate((techSupportId: string) => {
                  const app = (window as any).__iinpublic_app?.getApp?.();
                  const members: Array<{ userId: string }> =
                    app?.uiManager?.getCurrentChatroomMembers?.() ?? [];
                  return members.filter((m) => m.userId && m.userId !== techSupportId).length;
                }, 'iinpublic-root-techsupport'),
              { timeout: 90_000, intervals: [1_000] },
            )
            .toBeGreaterThanOrEqual(NUM_USERS - 1); // at least the other 9 peers

          // Click broadcast.
          await page.click('#broadcast-talk-btn');

          // Confirm the audience-preview preamble modal.
          await page.waitForSelector('[data-testid="broadcast-preamble-send"]', { timeout: 30_000 });
          await page.click('[data-testid="broadcast-preamble-send"]');

          // Wait for the ack indicator.
          await page.waitForFunction(
            () => {
              const ack = document.getElementById('broadcast-bulk-ack');
              return ack !== null && !ack.hidden;
            },
            { timeout: 120_000 },
          );
        }),
      );

      await afterSync();

      // ── Phase 5: navigate to talks tab and answer ONE incoming talk manually ──
      //
      // Wait for at least one unanswered incoming talk to appear, then click it.
      // For a tag talk the modal has a checkbox ("Match") and a submit button.
      // We check the box and submit. After this one click we enable the chatbot.

      await Promise.all(
        setups.map(async ({ page }) => {
          // Switch to talks view so incoming talks render.
          await page.click('.nav-btn[data-view="talks"]');

          // Wait for at least one unanswered incoming talk.
          await page.waitForSelector(
            '.talk-list-item[data-role="incoming"]:not(.talk-incoming-answered)',
            { timeout: 60_000 },
          );

          // Open it.
          await page
            .locator('.talk-list-item[data-role="incoming"]:not(.talk-incoming-answered)')
            .first()
            .click();

          // Submit: the checkbox is the "interested / match" toggle.
          const checkboxLocator = page.locator('#tag-match-checkbox');
          if (await checkboxLocator.isVisible({ timeout: 5_000 })) {
            if (!(await checkboxLocator.isChecked())) {
              await checkboxLocator.check();
            }
            await page.click('#tag-submit-response');
          } else {
            // Modal may have been dismissed (chatbot race); proceed.
            await page.keyboard.press('Escape');
          }
        }),
      );

      // Enable the chatbot in every browser — it will now auto-answer all
      // remaining unanswered incoming talks as Gun callbacks fire.
      await Promise.all(
        setups.map(async ({ page }) => {
          await page.evaluate(() => {
            localStorage.setItem('chatbotEnabled', 'true');
            try {
              const app = (window as any).__iinpublic_app?.getApp?.();
              app?.uiManager?.setChatbotEnabled?.(true);
            } catch { /* ignore if hook not exposed */ }
          });
        }),
      );

      // ── Phase 6: wait until every incoming talk is answered ──────────────────
      //
      // The chatbot processes each incoming talk via Gun callbacks.
      // Poll until the DOM shows all incoming items as answered.

      await Promise.all(
        setups.map(async ({ page }, i) => {
          await expect
            .poll(
              async () =>
                page.evaluate(() => {
                  const all = document.querySelectorAll('.talk-list-item[data-role="incoming"]');
                  const answered = document.querySelectorAll(
                    '.talk-list-item[data-role="incoming"].talk-incoming-answered',
                  );
                  // At least 9 senders × 1 talk each minimum; all must be answered.
                  return all.length >= 9 && all.length === answered.length;
                }),
              { timeout: 120_000, intervals: [2_000] },
            )
            .toBe(true, `user ${i} still has unanswered incoming talks after timeout`);
        }),
      );

      // ── Phase 7: contacts tab — sort by weighted relevance ───────────────────
      //
      // Navigate to the Contacts tab, switch the sort dropdown to "weighted",
      // then read the rendered list. Users with more overlapping interests
      // produce more mutual tag matches → higher matchedTalks → higher relevance.
      //
      // Expected order for user 0 (19 shared with user1, 18 with user2, …):
      //   top-1 → Sim User 1, top-2 → Sim User 2, top-3 → Sim User 3
      // Expected order for user 9 (19 shared with user8, 18 with user7, …):
      //   top-1 → Sim User 8, top-2 → Sim User 7, top-3 → Sim User 6

      const contactResults: Array<Array<{ id: string; name: string }>> = [];

      for (let i = 0; i < NUM_USERS; i++) {
        const page = setups[i].page;

        await page.click('[data-testid="bottom-navigation-button-contacts"]');
        await page.waitForSelector('#contacts-sort-order', { timeout: 15_000 });

        // Select weighted relevance sort.
        await page.selectOption('#contacts-sort-order', 'weighted');
        await afterAction();

        // Read the top contacts.
        const contacts = await page.evaluate(() =>
          Array.from(
            document.querySelectorAll('.contact-item[data-contact-user-id]'),
          ).map((el) => ({
            id: (el as HTMLElement).dataset.contactUserId ?? '',
            name: ((el as HTMLElement).querySelector('.contact-item-name') as HTMLElement | null)
              ?.innerText ?? '',
          })),
        );
        contactResults.push(contacts);
      }

      // ── Phase 8: assertions ───────────────────────────────────────────────────

      // All users must have at least 9 contacts (the 9 others).
      for (let i = 0; i < NUM_USERS; i++) {
        expect(
          contactResults[i].length,
          `user ${i} should see ≥ 9 contacts`,
        ).toBeGreaterThanOrEqual(9);
      }

      // User 0 — top-3 most similar: user 1 (19/20 = 95%), user 2 (90%), user 3 (85%).
      const top3Ids0 = contactResults[0].slice(0, 3).map((c) => c.id);
      expect(top3Ids0[0], 'user 0 top-1 contact should be user 1').toBe(userIds[1]);
      expect(top3Ids0[1], 'user 0 top-2 contact should be user 2').toBe(userIds[2]);
      expect(top3Ids0[2], 'user 0 top-3 contact should be user 3').toBe(userIds[3]);

      // User 9 — top-3 most similar: user 8 (95%), user 7 (90%), user 6 (85%).
      const top3Ids9 = contactResults[9].slice(0, 3).map((c) => c.id);
      expect(top3Ids9[0], 'user 9 top-1 contact should be user 8').toBe(userIds[8]);
      expect(top3Ids9[1], 'user 9 top-2 contact should be user 7').toBe(userIds[7]);
      expect(top3Ids9[2], 'user 9 top-3 contact should be user 6').toBe(userIds[6]);

      // Spot-check: the relevance score chip is shown when weighted sort is active.
      const hasRankChip = await setups[0].page.evaluate(
        () => document.querySelector('.contact-item-rank') !== null,
      );
      expect(hasRankChip, 'weighted sort should render relevance score chips').toBe(true);
    },
  );
});
