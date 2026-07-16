/**
 * Answer history view (catalog Part 5, T6 tail; M1/M2).
 *
 * Single user with a seeded answer-history record: the Me tab renders the answer
 * row, the search input filters it, and a non-matching query empties the list.
 */
import { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { afterNav, afterSync } from '../../helpers/timing';
import { webBaseURL } from '../../helpers/ports';

test.describe('Answer history view', () => {
  let context: BrowserContext | undefined;
  let page: Page | undefined;

  test.beforeEach(async ({ browser }) => {
    await clearGunForStage1Spec();
    context = await browser.newContext({ viewport: { width: 1100, height: 1100 }, deviceScaleFactor: 1 });
    page = await context.newPage();
    await injectIdbClear(page);
    // Seed one answer-history record before the app boots.
    await page.addInitScript(() => {
      const record = {
        id: 'ah-1',
        talkId: 'talk-ah-1',
        title: 'Coffee Meetup',
        type: 'flow',
        language: 'en',
        outcome: 'match',
        answeredAt: new Date().toISOString(),
        senderIds: ['sender-1'],
        items: [
          {
            questionId: 'q1',
            answerId: 'a1',
            prompt: 'Do you like coffee?',
            choice: 'Yes',
            kind: 'question',
            contextPath: [],
          },
        ],
      };
      try {
        localStorage.setItem('myAnswerHistory', JSON.stringify({ 'ah-1': record }));
      } catch {
        /* ignore */
      }
    });
    await gotoWebApp(page, webBaseURL());
    await afterSync();
    await page.locator('.nav-btn[data-view="me"]').click();
    await afterNav();
  });

  test.afterEach(async () => {
    await page?.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
    await context?.close().catch(() => {});
    await clearGunForStage1Spec();
  });

  test('seeded answer renders and search filters it', async () => {
    const p = page!;
    await expect(p.locator('#answers-list')).toBeVisible({ timeout: 10000 });
    await expect(p.locator('#answers-list')).toContainText('Coffee Meetup');

    // Matching search keeps it.
    await p.fill('#answers-search-input', 'Coffee');
    await afterSync();
    await expect(p.locator('#answers-list')).toContainText('Coffee Meetup');

    // Non-matching search empties the visible rows. (textContent keeps hidden
    // rows, so assert on the rendered text via useInnerText.)
    await p.fill('#answers-search-input', 'zzz-no-match');
    await afterSync();
    await expect(p.locator('#answers-list')).not.toContainText('Coffee Meetup', { useInnerText: true });
    await expect(p.locator('#answers-list .answer-talk-item', { hasText: 'Coffee Meetup' }).first()).toBeHidden();

    // Clearing restores it.
    await p.fill('#answers-search-input', '');
    await afterSync();
    await expect(p.locator('#answers-list')).toContainText('Coffee Meetup');
  });
});
