/**
 * Me-tab dialogs and answer history (merged: 58-answer-history, 56-my-talks-dialog,
 * 57-preferences-dialog — identical fixture, one boot instead of three).
 * The answer-history localStorage seed (from 58) is applied at shared boot; it is inert
 * for the two dialog open/close tests.
 */
import { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { afterNav, afterSync } from '../../helpers/timing';
import { webBaseURL } from '../../helpers/ports';

test.describe('Me tab — answer history and dialogs (merged)', () => {
  let context: BrowserContext | undefined;
  let page: Page | undefined;

  test.beforeAll(async ({ browser }) => {
    await clearGunForStage1Spec();
    context = await browser.newContext({ viewport: { width: 1100, height: 1100 }, deviceScaleFactor: 1 });
    page = await context.newPage();
    await injectIdbClear(page);
    // Seed one answer-history record before the app boots (58-answer-history).
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
  });

  test.afterAll(async () => {
    await page?.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
    await context?.close().catch(() => {});
    await clearGunForStage1Spec();
  });

  test('seeded answer renders and search filters it', async () => {
    await page!.locator('.nav-btn[data-view="me"]').click();
    await afterNav();
    const p = page!;
    await expect(p.locator('#answers-list')).toBeVisible({ timeout: 10000 });
    // docs/TODO.md §LL.2 follow-up: the row's visible content is the question prompt, not the
    // talk title — "Coffee Meetup" is still searchable (buildSearchText includes talkTitle,
    // answers-view.ts, unaffected by the redesign), just no longer shown as text.
    await expect(p.locator('#answers-list')).toContainText('Do you like coffee?');

    // Matching search (by talk title, still indexed even though not displayed) keeps it.
    await p.fill('#answers-search-input', 'Coffee');
    await afterSync();
    await expect(p.locator('#answers-list')).toContainText('Do you like coffee?');

    // Non-matching search empties the visible rows. (textContent keeps hidden
    // rows, so assert on the rendered text via useInnerText.)
    await p.fill('#answers-search-input', 'zzz-no-match');
    await afterSync();
    await expect(p.locator('#answers-list')).not.toContainText('Do you like coffee?', { useInnerText: true });
    await expect(p.locator('#answers-list .answer-talk-item', { hasText: 'Do you like coffee?' }).first()).toBeHidden();

    // Clearing restores it.
    await p.fill('#answers-search-input', '');
    await afterSync();
    await expect(p.locator('#answers-list')).toContainText('Do you like coffee?');
  });

  test('My Talks dialog opens and closes', async () => {
    const p = page!;
    await p.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.uiManager?.showMyTalksDialog?.());
    await afterNav();
    await expect(p.locator('#my-talks-modal')).toBeVisible({ timeout: 8000 });
    await p.locator('#close-my-talks-modal').click();
    await afterNav();
    await expect(p.locator('#my-talks-modal')).toHaveCount(0);
  });

  test('Preferences dialog opens and closes', async () => {
    const p = page!;
    await p.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.uiManager?.showPreferencesDialog?.());
    await afterNav();
    await expect(p.locator('#preferences-modal')).toBeVisible({ timeout: 8000 });
    await p.locator('#close-preferences-modal').click();
    await afterNav();
    await expect(p.locator('#preferences-modal')).toHaveCount(0);
  });
});
