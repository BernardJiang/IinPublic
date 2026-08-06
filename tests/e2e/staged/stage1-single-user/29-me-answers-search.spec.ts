/**
 * Me tab: answers search filter.
 * Tests text search across answers list: type query → filter to matches only;
 * clear input → restore full list; type garbage → empty results.
 */
import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { ensureWindowFitsViewport } from '../../helpers/browser-window';
import { afterLoad, afterSync, afterNav, afterAction, delay, headless } from '../../helpers/timing';
import { webBaseURL } from '../../helpers/ports';
import { attachE2eBrowserTabLabel } from '../../helpers/e2e-tab-title';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';
import { openSettingsSection, SETTINGS_SECTION } from '../../helpers/settings-nav';

test.describe('Me tab: answers search filter', () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage1Spec();
    browser = await chromium.launch({
      headless,
      slowMo: headless ? 0 : delay(50, 150),
      args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=0,0', '--window-size=960,1400', '--force-device-scale-factor=1'],
    });
  });

  test.afterAll(async () => {
    if (page) await page.close();
    if (context) await context.close();
    if (browser) await browser.close();
    await clearGunForStage1Spec();
  });

  async function bootstrapUser(stageName: string): Promise<void> {
    context = await browser.newContext({ viewport: { width: 960, height: 1200 }, deviceScaleFactor: 1 });
    page = await context.newPage();
    page.on('console', (m) => console.log('[Browser]:', m.text()));
    await injectIdbClear(page);
    await gotoWebApp(page, webBaseURL());
    await ensureWindowFitsViewport(page, 960, 1200);
    await afterLoad();
    await page.click('.nav-btn[data-view="settings"]');
    await afterNav();
    await openSettingsSection(page, SETTINGS_SECTION.profile);
    await page.waitForSelector('#settings-stage-name-input');
    await page.fill('#settings-stage-name-input', stageName);
    await page.locator('#settings-stage-name-input').blur();
    await afterNav();
    await page.click('.nav-btn[data-view="chatrooms"]');
    await afterNav();
    attachE2eBrowserTabLabel(page, stageName);
  }

  async function createTalk(title: string): Promise<void> {
    await page.click('#create-talk-btn');
    await page.waitForSelector('#talk-editor-form');
    await page.fill('#talk-title', title);
    await page.selectOption('#talk-language', 'en');
    await page.selectOption('#talk-type', 'flow');
    const q = page.locator('.question-item').first();
    await q.locator('.question-text').fill('Test question?');
    await q.locator('.answer-item').nth(0).locator('.answer-text').fill('Yes');
    await q.locator('.answer-item').nth(0).locator('.answer-next').selectOption('noticed');
    await q.locator('.answer-item').nth(1).locator('.answer-text').fill('No');
    await q.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');
    await page.click('#talk-editor-form button[type="submit"]');
    await afterSync();
  }

  test('Answers search: type query filters list; clear restores all; garbage query shows empty state', async () => {
    await bootstrapUser('AnswersSearchTestUser');

    // Inject sample flat answer history with 2+ distinct talks before rendering
    await page.evaluate(() => {
      const myAnswerHistory = {
        'coffee-123': {
          id: 'coffee-123',
          talkId: 'talk-coffee-123',
          title: 'Coffee Meetup Discussion',
          type: 'flow',
          language: 'en',
          outcome: 'match' as const,
          answeredAt: new Date().toISOString(),
          senderIds: ['sender-1'],
          items: [
            {
              questionId: 'q1',
              answerId: 'a1',
              kind: 'question' as const,
              prompt: 'Do you like coffee?',
              choice: 'Yes, absolutely',
              contextLabel: '',
              contextPath: [],
            },
          ],
        },
        'book-456': {
          id: 'book-456',
          talkId: 'talk-book-456',
          title: 'Book Club for Authors',
          type: 'flow',
          language: 'en',
          outcome: 'mismatch' as const,
          answeredAt: new Date().toISOString(),
          senderIds: ['sender-2'],
          items: [
            {
              questionId: 'q2',
              answerId: 'a2',
              kind: 'question' as const,
              prompt: 'Do you read frequently?',
              choice: 'Yes, daily',
              contextLabel: '',
              contextPath: [],
            },
          ],
        },
      };
      localStorage.setItem('myAnswerHistory', JSON.stringify(myAnswerHistory));
    });

    // Navigate to Me tab (answers view)
    await page.click('.nav-btn[data-view="me"]');
    await afterNav();

    // Check if the me-view is active
    await page.locator('#me-view.active').waitFor({ state: 'attached', timeout: 10000 });

    // Reload to ensure flat answer history is picked up
    await page.evaluate(() => (window as any).__iinpublic_app?.getApp()?.uiManager?.displayAnswersList?.());
    await afterSync();

    // Wait for answers list and search input to be visible
    const searchInput = page.locator('#answers-search-input');
    await searchInput.waitFor({ state: 'visible', timeout: 15000 });

    // Count initial visible answer items
    const answerItems = page.locator('.answer-talk-item');
    const initialCount = await answerItems.count();
    expect(initialCount).toBeGreaterThanOrEqual(2);

    // Test 1: Type a partial query that should match one talk
    await searchInput.fill('coffee');
    await afterAction();
    const filteredAfterCoffee = await page.locator('.answer-talk-item[style*="display: flex"]').count();
    const hiddenAfterCoffee = await page.locator('.answer-talk-item[style*="display: none"]').count();
    expect(filteredAfterCoffee).toBeGreaterThan(0);
    expect(hiddenAfterCoffee).toBeGreaterThan(0);

    // Test 2: Clear input and verify all items are restored
    await searchInput.fill('');
    await afterAction();
    const restoredCount = await page.locator('.answer-talk-item[style*="display: flex"]').count();
    expect(restoredCount).toBe(initialCount);

    // Test 3: Type garbage query that shouldn't match anything
    await searchInput.fill('xyzabc123notfound');
    await afterAction();
    const emptyResult = await page.locator('.answer-talk-item[style*="display: flex"]').count();
    expect(emptyResult).toBe(0);

    // Clean up
    await page.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup());
  });
});
