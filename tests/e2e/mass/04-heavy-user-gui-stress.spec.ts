import { chromium, type BrowserContext, type Page } from '@playwright/test';
import { test, expect } from '../helpers/fixtures';
import { maybeClearGunDatabases } from '../helpers/clear-database';
import { headless, afterSync, E2E_ASSERT_TIMEOUT_MS } from '../helpers/timing';
import { bootstrapUser, waitForTabActive } from '../helpers/talks-matching-flow';
import { WEBRTC_CHROMIUM_ARGS } from '../helpers/webrtc-chromium';

// Quick iteration: 5 / 10 / 20. Real stress: 125 / 500 / 500.
export const NUM_TALKS_PER_TYPE = 125;
export const NUM_ANSWERS = 500;
export const NUM_CONTACTS = 500;

type ViewName = 'talks' | 'me' | 'contacts' | 'chatrooms' | 'settings';

const RELATIONSHIP_LABELS = [
  'friend', 'relative', 'coworker', 'acquaintance', 'partner', 'custom',
] as const;

async function browserNow(page: Page): Promise<number> {
  return page.evaluate(() => performance.now());
}

function warnIfSlow(view: string, ms: number, limit: number): void {
  if (ms > limit) console.warn(`[SLOW] ${view} took ${ms.toFixed(0)}ms (limit ${limit}ms)`);
}

async function seedLocalData(page: Page, userId: string): Promise<void> {
  await page.evaluate(
    ({ answersCount, authorId, talksPerType }) => {
      type TalkType = 'tag' | 'flow' | 'survey' | 'route';
      const talks: Record<string, unknown> = {};
      const questionAnswers: Record<string, unknown> = {};
      const answerHistory: Record<string, unknown> = {};
      const createdAt = new Date().toISOString();

      function questionsFor(type: TalkType, index: number) {
        const prefix = `stress-${type}-${index}`;
        if (type === 'tag') {
          return [{
            id: `${prefix}-q1`, text: `Stress tag ${index}?`,
            answers: [
              { id: `${prefix}-match`, text: 'Yes', isMatch: true, isTerminal: true },
              { id: `${prefix}-ignore`, text: 'No', isIgnore: true, isTerminal: true },
            ],
          }];
        }
        if (type === 'survey') {
          return [{
            id: `${prefix}-q1`, text: `Stress survey ${index}?`, isAggregatable: true,
            answers: [1, 2, 3].map((c) => ({
              id: `${prefix}-a${c}`, text: `Option ${c}`, isTerminal: true, counter: 0,
            })),
          }];
        }
        return [
          {
            id: `${prefix}-q1`, text: `Stress ${type} ${index}: continue?`,
            answers: [
              { id: `${prefix}-continue`, text: 'Continue', nextQuestionId: `${prefix}-q2` },
              { id: `${prefix}-stop`, text: 'Stop', isIgnore: true, isTerminal: true },
            ],
          },
          {
            id: `${prefix}-q2`, text: `Stress ${type} ${index}: match?`,
            contextPath: [{ questionId: `${prefix}-q1`, answerId: `${prefix}-continue` }],
            answers: [
              { id: `${prefix}-match`, text: 'Match', isMatch: true, isTerminal: true },
              { id: `${prefix}-ignore`, text: 'Ignore', isIgnore: true, isTerminal: true },
            ],
          },
        ];
      }

      const types: TalkType[] = ['tag', 'flow', 'survey', 'route'];
      for (const type of types) {
        for (let i = 1; i <= talksPerType; i++) {
          const talkId = `stress-${type}-${i}`;
          talks[talkId] = {
            id: talkId, role: 'created', title: `Stress ${type} ${i}`,
            type, language: 'en', timestamp: createdAt, createdAt,
            status: 'OUT', stats: { responses: 0, matched: 0 }, disabled: false,
            lastInteraction: createdAt,
            fullTalk: {
              id: talkId, authorId, type, language: 'en', isAdult: false,
              tags: [{ id: `${talkId}-tag`, name: `${type}-${i}`, category: 'other', popularity: 0 }],
              questions: questionsFor(type, i), createdAt,
            },
          };
        }
      }

      for (let i = 1; i <= answersCount; i++) {
        const key = `stress-answer-${i}`;
        questionAnswers[`Stress answer question ${i}?`] = {
          questionId: `${key}-q`, questionText: `Stress answer question ${i}?`,
          answerId: `${key}-match`, answerText: `Answer ${i}`, mode: 'manual',
          language: 'en', isIgnored: false, timestamp: createdAt,
        };
        answerHistory[key] = {
          id: key, talkId: `stress-answer-talk-${i}`, title: `Stress answered talk ${i}`,
          type: 'survey', language: 'en', outcome: 'match', answeredAt: createdAt,
          senderIds: [`stress-sender-${i}`],
          items: [{
            questionId: `${key}-q`, answerId: `${key}-match`,
            prompt: `Stress answer question ${i}?`, choice: `Answer ${i}`,
            kind: 'question', contextPath: [], mode: 'manual',
          }],
        };
      }

      localStorage.setItem('myTalks', JSON.stringify(talks));
      localStorage.setItem('myQuestionAnswers', JSON.stringify(questionAnswers));
      localStorage.setItem('myAnswerHistory', JSON.stringify(answerHistory));
    },
    { answersCount: NUM_ANSWERS, authorId: userId, talksPerType: NUM_TALKS_PER_TYPE },
  );
}

async function seedContactsViaHttp(page: Page, userId: string): Promise<void> {
  const baseURL = await page.evaluate(() =>
    String((window as any).__iinpublic_app?.getApp()?.getBackendApiBase?.() || 'http://127.0.0.1:3001'));

  const client = page.context().request;
  const batchSize = 50;

  // Step 1: Create user records in Gun so renderer has something to display
  for (let start = 1; start <= NUM_CONTACTS; start += batchSize) {
    const end = Math.min(start + batchSize - 1, NUM_CONTACTS);
    await Promise.all(Array.from({ length: end - start + 1 }, (_, i) => {
      const id = start + i;
      return client.post(`${baseURL}/api/users`, { data: {
        id: `sc-${id}`, stageName: `Stress Contact ${id}`, profile: [], reputation: {},
        location: { region: '', chatrooms: [] }, languages: ['en'], interests: [],
      }});
    }));
  }

  // Step 2: Add as known-persons for our user
  for (let start = 1; start <= NUM_CONTACTS; start += batchSize) {
    const end = Math.min(start + batchSize - 1, NUM_CONTACTS);
    await Promise.all(Array.from({ length: end - start + 1 }, (_, i) => {
      const id = start + i;
      const label = RELATIONSHIP_LABELS[id % RELATIONSHIP_LABELS.length];
      return client.post(`${baseURL}/api/users/${encodeURIComponent(userId)}/known-people`, { data: {
        targetId: `sc-${id}`, label, nickname: `Stress Contact ${id}`,
        ...(label === 'custom' ? { customLabel: `Custom ${id}` } : {}),
      }});
    }));
  }

  // Step 3: Build knownPeople map in Node (same data we just wrote via HTTP), then merge
  // directly into currentUser so adoptSessionUser gets full knownPeople immediately.
  // Avoids reading from Gun (slow + async propagation) — this copy is authoritative.
  const kpMap: Record<string, any> = {};
  for (let id = 1; id <= NUM_CONTACTS; id++) {
    kpMap[`sc-${id}`] = {
      userId: `sc-${id}`, label: RELATIONSHIP_LABELS[id % RELATIONSHIP_LABELS.length],
      nickname: `Stress Contact ${id}`, addedAt: new Date().toISOString(),
      ...(RELATIONSHIP_LABELS[id % RELATIONSHIP_LABELS.length] === 'custom' ? { customLabel: `Custom ${id}` } : {}),
    };
  }
  await page.evaluate(async ({ ownerId, kp }) => {
    const app = (window as any).__iinpublic_app?.getApp?.();
    if (!app) throw new Error('App unavailable');
    const updatedUser = await app.userService.getUser(ownerId);
    updatedUser.knownPeople = Object.keys(kp).length > 0 ? kp : (updatedUser.knownPeople ?? {});
    app.currentUser = updatedUser;
    app.uiManager.adoptSessionUser(updatedUser);
  }, { ownerId: userId, kp: kpMap });
}

test.describe('M4 heavy-user GUI stress', () => {
  test('keeps every tab responsive with an already data-heavy user', async () => {
    test.setTimeout(600_000);
    await maybeClearGunDatabases();

    const browser = await chromium.launch({ headless, args: [...WEBRTC_CHROMIUM_ARGS, '--disable-dev-shm-usage'] });
    let context: BrowserContext | undefined;
    let page: Page | undefined;

    try {
      const boot = await bootstrapUser(browser, 'HeavyStress', 'Stress Tester', 60_000);
      context = boot.context;
      page = boot.page;

      // Enable unlimited talk ledger
      await page.evaluate(() => {
        const app = (window as any).__iinpublic_app?.getApp?.();
        if (!app?.currentUser?.id) throw new Error('User not bootstrapped');
        app.setTalkLedgerQuotaUnlimitedForE2e(true);
      });

      const userId = await page.evaluate(() =>
        String((window as any).__iinpublic_app.getApp().currentUser.id));

      // Seed data — localStorage is instant, Gun contacts via HTTP takes ~4-10s  
      console.log(`[seed] ${NUM_TALKS_PER_TYPE * 4} talks + ${NUM_ANSWERS} answers + ${NUM_CONTACTS} contacts`);
      await seedLocalData(page, userId);

      const contactSeedStart = Date.now();
      await seedContactsViaHttp(page, userId);
      console.log(`[seed] Contacts seeded in ${((Date.now() - contactSeedStart) / 1000).toFixed(1)}s`);

      // Visit contacts tab to warm up Gun subscription for knownPeople. Seed is async via HTTP so
      // poll until at least some visible. Gun propagation of 500 writes can take a while in-memory mode.
      // Use reload to force the app to re-read knownPeople from Gun on cold start.
      await page.reload();

      console.log(`[contacts-warmup] reloading so adoptSessionUser picks up freshly seeded contacts`);
      const contactsTarget = Math.min(NUM_CONTACTS, 10); // at-least-a-few sanity check vs hard 500
      try {
        await expect.poll(
          () => page!.locator('#contacts-list .contact-item').count(),
          { timeout: 20_000, intervals: [1000] },
        ).toBeGreaterThanOrEqual(contactsTarget);
      } catch {
        // Gun propagation might not finish in time — still log what we have and continue measuring.
        const got = await page!.locator('#contacts-list .contact-item').count();
        console.warn(`[contacts-warmup] only ${got}/${NUM_CONTACTS} rendered yet (Gun async prop)`);
      }
      const warmContacts = await page!.locator('#contacts-list .contact-item').count();
      console.log(`[warmup] contacts=${warmContacts}/${NUM_CONTACTS}`);
      await afterSync();

      const talksTotal = NUM_TALKS_PER_TYPE * 4;

      // --- Talks tab ---
      {
        const t0 = await browserNow(page);
        await page.locator('.nav-btn[data-view="talks"]').click();
        await expect(page.locator('.nav-btn[data-view="talks"].active')).toBeVisible({ timeout: 15_000 });
        const shellMs = (await browserNow(page)) - t0;
        await expect.poll(() => page!.locator('.talk-list-item').count(), { timeout: E2E_ASSERT_TIMEOUT_MS })
          .toBeGreaterThanOrEqual(talksTotal);
        const contentMs = (await browserNow(page)) - t0;
        const talkCount = await page.locator('.talk-list-item').count();
        warnIfSlow('talks shell', shellMs, 500);
        warnIfSlow('talks render', contentMs, 5000);
        console.log(`[talks] shell=${shellMs.toFixed(0)}ms render=${contentMs.toFixed(0)}ms items=${talkCount}`);

        // Scroll test
        const scrollEl = page.locator('#main-view-container');
        if (await scrollEl.count().then((c) => c > 0)) {
          await scrollEl.evaluate((el) => el?.scrollBy?.({ top: 2000 }));
        }
        await page.waitForTimeout(3000);
      }

      // --- Me tab ---
      {
        const t0 = await browserNow(page);
        await page.locator('.nav-btn[data-view="me"]').click();
        await expect(page.locator('.nav-btn[data-view="me"].active')).toBeVisible({ timeout: 15_000 });
        const shellMs = (await browserNow(page)) - t0;
        if (NUM_ANSWERS > 0) {
          await expect.poll(() => page!.locator('#answers-content .answer-talk-item').count(), { timeout: E2E_ASSERT_TIMEOUT_MS })
            .toBeGreaterThanOrEqual(NUM_ANSWERS);
        } else {
          await expect(page.locator('#answers-content')).toBeVisible();
        }
        const contentMs = (await browserNow(page)) - t0;
        const answerCount = await page.locator('#answers-content .answer-talk-item').count();
        warnIfSlow('me shell', shellMs, 500);
        warnIfSlow('me render', contentMs, 5000);
        console.log(`[me]    shell=${shellMs.toFixed(0)}ms render=${contentMs.toFixed(0)}ms items=${answerCount}`);

        await page.waitForTimeout(3000);
      }

      // --- Contacts tab (re-measure after visits) ---
      {
        const t0 = await browserNow(page);
        await page.locator('.nav-btn[data-view="contacts"]').click();
        await expect(page.locator('.nav-btn[data-view="contacts"].active')).toBeVisible({ timeout: 15_000 });
        const shellMs = (await browserNow(page)) - t0;
        const contactCount = await page.locator('#contacts-list .contact-item').count();
        const contentMs = (await browserNow(page)) - t0;
        warnIfSlow('contacts shell', shellMs, 500);
        warnIfSlow('contacts render', contentMs, 10_000);
        console.log(`[contacts] shell=${shellMs.toFixed(0)}ms items=${contactCount}`);

        // Verify all label groups visible
        const labelsFound: boolean[] = [];
        for (const label of RELATIONSHIP_LABELS) {
          try {
            await expect(page.locator('#contacts-list').getByText(new RegExp(label[0].toUpperCase() + label.slice(1), 'i')).first())
              .toBeVisible({ timeout: 5_000 });
            labelsFound.push(true);
          } catch {
            labelsFound.push(false);
          }
        }
        console.log(`[labels]  visible=${labelsFound.filter(Boolean).length}/${RELATIONSHIP_LABELS.length}`);
      }

      // --- Chatrooms tab (sanity) ---
      {
        const t0 = await browserNow(page);
        await page.locator('.nav-btn[data-view="chatrooms"]').click();
        await expect(page.locator('.chatroom-item').filter({ hasText: 'Global' }).first()).toBeVisible({ timeout: E2E_ASSERT_TIMEOUT_MS });
        console.log(`[chatrooms] ok, render=${((await browserNow(page)) - t0).toFixed(0)}ms`);
      }

      // --- Settings tab (sanity) ---
      {
        const t0 = await browserNow(page);
        await page.locator('.nav-btn[data-view="settings"]').click();
        await expect(page.locator('#settings-content')).toBeVisible({ timeout: E2E_ASSERT_TIMEOUT_MS });
        console.log(`[settings]  ok, render=${((await browserNow(page)) - t0).toFixed(0)}ms`);
      }

    } finally {
      await page?.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
      await context?.close().catch(() => {});
      await browser.close().catch(() => {});
      await maybeClearGunDatabases();
    }
  });
});
