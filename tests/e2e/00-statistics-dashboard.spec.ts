/**
 * Statistics dashboard E2E: direct stats events are visible from the Stats tab.
 */
import { BrowserContext, Page } from '@playwright/test';
import { test, expect } from './helpers/fixtures';
import { clearGunDatabases, injectIdbClear } from './helpers/clear-database';
import { gunBaseURL, webBaseURL } from './helpers/ports';
import { afterNav, afterSync } from './helpers/timing';

test.describe('Statistics dashboard', () => {
  let context: BrowserContext | undefined;
  let page: Page | undefined;

  test.beforeEach(async ({ browser }) => {
    await clearGunDatabases();
    context = await browser.newContext();
    page = await context.newPage();
    await injectIdbClear(page);
  });

  test.afterEach(async () => {
    await page?.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
    await context?.close().catch(() => {});
    await clearGunDatabases();
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

    await p.locator('.nav-btn[data-view="statistics"]').click();
    await afterNav();

    await expect(p.locator('#statistics-view')).toBeVisible();
    await expect(p.locator('#statistics-content')).toContainText('Statistics dashboard', { timeout: 20_000 });
    await expect(p.locator('#statistics-content')).toContainText('Responses');
    await expect(p.locator('#statistics-content')).toContainText('3');
    await expect(p.locator('#statistics-content')).toContainText('Match rate');
    await expect(p.locator('#statistics-content')).toContainText('survey');
    await expect(p.locator('#statistics-content')).toContainText('Peer and reputation summary');
    await expect(p.locator('#statistics-content')).toContainText('append-only Gun mirrors');
  });
});
