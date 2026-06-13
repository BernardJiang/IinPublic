/**
 * Contextual statistics E2E: local stats events are visible on product tabs without a Stats tab.
 *
 * Since P0 Step 7, stats are local-only. The contextual stats strip (#talks-stats-strip)
 * reads from localTalkExchanges via buildAllLocalTalkResponses + buildStatsDashboard.
 * This test seeds 3 exchange records (2 matches, 1 mismatch) and verifies the strip
 * shows aggregate response + match-rate copy.
 */
import { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear } from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { webBaseURL } from '../../helpers/ports';
import { afterNav, afterSync } from '../../helpers/timing';
import { seedLocalTalkExchange } from '../../helpers/talk-demo-ui';
import { bootstrapUser } from '../../helpers/talks-matching-flow';
import { launchBrowserGrid, shutdownBrowserGrid } from '../../helpers/many-browsers';
import type { Browser } from '@playwright/test';

test.describe('Statistics dashboard', () => {
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let browsers: Browser[] = [];

  test.beforeEach(async () => {
    await clearGunForStage1Spec();
    browsers = await launchBrowserGrid(1);
  });

  test.afterEach(async () => {
    await page?.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
    await context?.close().catch(() => {});
    await shutdownBrowserGrid(browsers);
    await clearGunForStage1Spec();
    browsers = [];
  });

  test('shows aggregate talk, chatroom, peer, and source-of-truth stats', async () => {
    const talkId = 'e2e_stats_dashboard_talk';

    // Bootstrap a user so the app is running and localStorage is writable.
    const tom = await bootstrapUser(browsers[0]!, 'Tom', 'Tom');
    context = tom.context;
    page = tom.page;

    // Seed 3 local exchanges (2 matches, 1 mismatch) into localTalkExchanges.
    // These drive displayContextualStatistics via buildAllLocalTalkResponses.
    await seedLocalTalkExchange(page, talkId, {
      responderId: 'stats_user_a', outcome: 'match', talkType: 'survey',
      answers: [
        { questionId: 'q_color', answerId: 'blue', answerText: 'Blue' },
        { questionId: 'q_sport', answerId: 'tennis', answerText: 'Tennis' },
      ],
    });
    await seedLocalTalkExchange(page, talkId, {
      responderId: 'stats_user_b', outcome: 'mismatch', talkType: 'survey',
      answers: [
        { questionId: 'q_color', answerId: 'green', answerText: 'Green' },
        { questionId: 'q_sport', answerId: 'tennis', answerText: 'Tennis' },
      ],
    });
    await seedLocalTalkExchange(page, talkId, {
      responderId: 'stats_user_c', outcome: 'match', talkType: 'survey',
      answers: [
        { questionId: 'q_color', answerId: 'blue', answerText: 'Blue' },
        { questionId: 'q_sport', answerId: 'tennis', answerText: 'Tennis' },
      ],
    });

    // Navigate to Talks tab; this triggers displayContextualStatistics('talks-stats-strip').
    await page.locator('.nav-btn[data-view="talks"]').click();
    await afterNav();
    await afterSync();

    await expect(page.locator('#talks-view')).toBeVisible();

    // Stats strip should show response data. The contextualStatsSummary template includes
    // "responses", "matches", and "match rate" copy.
    await expect(page.locator('#talks-stats-strip')).toContainText('3', { timeout: 20_000 });
    await expect(page.locator('#talks-stats-strip')).toContainText('match', { timeout: 10_000 });

    // No bottom-nav Stats tab (statistics is only accessible via the Settings-level dashboard).
    await expect(page.locator('.nav-btn[data-view="statistics"]')).toHaveCount(0);
  });
});
