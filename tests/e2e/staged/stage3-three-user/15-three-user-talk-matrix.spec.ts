/**
 * Three users each publish a distinct 3×4 talk set, exchange every talk, and
 * answer every received talk as a match. This is deliberately a dense, real
 * UI-manager path rather than fixture seeding: it protects the complete talk
 * ledger and the flattened Me answer history at once.
 */
import { Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { maybeClearGunDatabases } from '../../helpers/clear-database';
import {
  clickBroadcastUntilBulkAck,
  completeTalksInAppByAnswerIds,
  createTalksFromCompanyPage,
  waitForDistinctGunPeersExcludingSelf,
} from '../../helpers/talk-demo-ui';
import {
  bootstrapUser,
  finalCleanupPages,
  resetTalksMatchingSession,
  waitForTabActive,
} from '../../helpers/talks-matching-flow';
import {
  launchThreeBrowsers,
  shutdownThreeBrowsers,
  type ThreeBrowsers,
} from '../../helpers/talks-matching-browsers';

type UserRun = { name: string; stageName: string; browser: Browser; context?: BrowserContext; page?: Page; id?: string; talks?: any[] };
const TYPES: Array<{ type: 'tag' | 'flow' | 'survey' | 'route'; questions: number }> = [
  { type: 'tag', questions: 1 }, { type: 'flow', questions: 2 }, { type: 'survey', questions: 2 }, { type: 'route', questions: 4 },
];

function talkSet(authorId: string, owner: string, runId: string): any[] {
  return TYPES.flatMap(({ type, questions }) => Array.from({ length: 3 }, (_, talkIndex) => {
    const title = `${runId} ${owner} ${type} ${talkIndex + 1}`;
    return {
      title, authorId, type, language: 'en', isAdult: false, tags: [],
      questions: Array.from({ length: questions }, (_, questionIndex) => ({
        id: `q_${talkIndex + 1}_${questionIndex + 1}`,
        text: `${title}: question ${questionIndex + 1}`,
        answers: [
          { id: `match_${talkIndex + 1}_${questionIndex + 1}`, text: `Match ${questionIndex + 1}`, isMatch: true, isTerminal: questionIndex === questions - 1 },
          { id: `ignore_${talkIndex + 1}_${questionIndex + 1}`, text: `Ignore ${questionIndex + 1}`, isIgnore: true, isTerminal: true },
        ],
      })),
      createdAt: new Date().toISOString(), isTemplate: false, usageCount: 0,
    };
  }));
}

test.describe('Three-user complete talk matrix', () => {
  let browsers: ThreeBrowsers;
  const users: UserRun[] = [];

  test.beforeAll(async () => {
    await maybeClearGunDatabases();
    browsers = await launchThreeBrowsers();
    users.push(
      { name: 'Tom', stageName: 'Tom Matrix 36', browser: browsers.tom },
      { name: 'Jerry', stageName: 'Jerry Matrix 36', browser: browsers.jerry },
      { name: 'Bob', stageName: 'Bob Matrix 36', browser: browsers.bob },
    );
  });

  test.afterAll(async () => {
    await finalCleanupPages(
      { tom: users[0]?.page, jerry: users[1]?.page, bob: users[2]?.page },
      { tom: users[0]?.context, jerry: users[1]?.context, bob: users[2]?.context },
    );
    await shutdownThreeBrowsers(browsers);
    await maybeClearGunDatabases();
  });

  test('exchanges 36 distinct talks per user and flattens all answered questions', async () => {
    test.setTimeout(720_000);
    await resetTalksMatchingSession({}, {});
    const runId = `matrix-${Date.now()}`;

    for (const user of users) {
      const boot = await bootstrapUser(user.browser, user.name, user.stageName);
      user.context = boot.context;
      user.page = boot.page;
      user.id = await user.page.evaluate(() => (window as any).__iinpublic_app.getApp().currentUser.id);
      await user.page.evaluate(() => {
        // The matrix asserts the read-only answered-IN ledger. Auto-copy is a
        // separate opt-in flow that deliberately moves matched talks to OUT.
        localStorage.setItem('copyTalkAutoSave', 'false');
        (window as any).__iinpublic_app.getApp().setTalkLedgerQuotaUnlimitedForE2e(true);
      });
      await user.page.click('.chatroom-item:has-text("Global")');
    }

    for (const user of users) {
      user.talks = await createTalksFromCompanyPage(user.page!, talkSet(user.id!, user.name, runId));
      await waitForDistinctGunPeersExcludingSelf(user.page!, 2, 120_000);
    }
    for (const user of users) await clickBroadcastUntilBulkAck(user.page!, { minGunPeers: 2, minSent: 12 });

    for (const recipient of users) {
      const received = users.filter((author) => author !== recipient).flatMap((author) => author.talks!);
      await completeTalksInAppByAnswerIds(recipient.page!, received.map((talk) => ({
        talkId: talk.talkId,
        talkData: talk.talkData,
        answerIds: talk.talkData.questions.map((question: any) => question.answers[0].id),
        outcome: 'match' as const,
      })));
    }

    for (const user of users) {
      const page = user.page!;
      await page.click('.nav-btn[data-view="talks"]');
      await waitForTabActive(page, 'talks');
      await expect.poll(() => page.locator('#talks-list .talk-list-item').count(), { timeout: 90_000 }).toBe(36);
      await page.locator('#talks-nav-in').click();
      await expect.poll(() => page.locator('#talks-list .talk-list-item').count(), { timeout: 30_000 }).toBe(24);
      await page.locator('#talks-nav-out').click();
      await expect.poll(() => page.locator('#talks-list .talk-list-item').count(), { timeout: 30_000 }).toBe(12);
      await page.locator('#talks-nav-all').click();
      await page.locator('#talks-filter-type').selectOption('route');
      await expect.poll(() => page.locator('#talks-list .talk-list-item').count(), { timeout: 30_000 }).toBe(9);
      await page.locator('#talks-filter-type').selectOption('all');

      await page.click('.nav-btn[data-view="me"]');
      await waitForTabActive(page, 'me');
      await expect.poll(() => page.locator('#answers-list .answer-question-item').count(), { timeout: 60_000 }).toBe(54);
      for (const [type, count] of [['tag', 6], ['flow', 12], ['survey', 12], ['route', 24]] as const) {
        await page.locator(`.me-talk-type-filter[data-me-talk-type="${type}"]`).click();
        await expect.poll(() => page.locator(`#answers-list .answer-question-item.talk-type-${type}`).evaluateAll((rows) => rows.filter((row) => getComputedStyle(row).display !== 'none').length)).toBe(0);
        await page.locator(`.me-talk-type-filter[data-me-talk-type="${type}"]`).click();
        await expect.poll(() => page.locator(`#answers-list .answer-question-item.talk-type-${type}`).count()).toBe(count);
      }
    }
  });
});
