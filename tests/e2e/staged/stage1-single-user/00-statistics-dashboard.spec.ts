/**
 * Contextual statistics E2E: direct stats events are visible on product tabs without a Stats tab.
 */
import { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { maybeClearGunDatabases, injectIdbClear } from '../../helpers/clear-database';
import { gunBaseURL, webBaseURL } from '../../helpers/ports';
import { afterNav, afterSync } from '../../helpers/timing';

test.describe('Statistics dashboard', () => {
  let context: BrowserContext | undefined;
  let page: Page | undefined;

  test.beforeEach(async ({ browser }) => {
    await maybeClearGunDatabases();
    context = await browser.newContext();
    page = await context.newPage();
    await injectIdbClear(page);
  });

  test.afterEach(async () => {
    await page?.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
    await context?.close().catch(() => {});
    await maybeClearGunDatabases();
  });

  test('shows aggregate talk, chatroom, peer, and source-of-truth stats', async ({ request }) => {
    const talkId = 'e2e_stats_dashboard_talk';
    for (const [responderId, answerId, answerText, outcome] of [
      ['stats_user_a', 'blue', 'Blue', 'match'],
      ['stats_user_b', 'green', 'Green', 'ignore'],
      ['stats_user_c', 'blue', 'Blue', 'match'],
    ] as const) {
      const res = await request.post(`${gunBaseURL()}/api/stats/talks/${talkId}/record`, {
        data: {
          responderId,
          talkType: 'survey',
          outcome,
          answers: [
            { questionId: 'q_color', answerId, answerText },
            { questionId: 'q_sport', answerId: 'tennis', answerText: 'Tennis' },
          ],
        },
      });
      expect(res.ok()).toBeTruthy();
    }

    const p = page!;
    await p.goto(webBaseURL());
    await p.waitForLoadState('load');
    await afterSync();

    await expect(p.locator('.nav-btn[data-view="statistics"]')).toHaveCount(0);
    await p.locator('.nav-btn[data-view="talks"]').click();
    await afterNav();

    await expect(p.locator('#talks-view')).toBeVisible();
    await expect(p.locator('#talks-stats-strip')).toContainText('Stats:', { timeout: 20_000 });
    await expect(p.locator('#talks-stats-strip')).toContainText('3 responses');
    await expect(p.locator('#talks-stats-strip')).toContainText('match rate');
  });
});
