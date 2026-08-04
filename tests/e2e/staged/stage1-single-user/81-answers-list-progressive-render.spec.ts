/**
 * TODO §R3: Me tab Answers list progressive render — with more entries than the
 * first-chunk size (ANSWERS_FIRST_CHUNK_SIZE = 25 in answers-view.ts), the first chunk
 * is visible immediately and the remainder fills in shortly after, without dropping or
 * duplicating any row even under several rapid successive re-renders (the scenario that
 * exposed a real missing-isStale bug in R2's Talks-tab equivalent). A deferred-remainder
 * row must also be interactive: displayAnswersList's per-row listener loops were
 * replaced by one delegated click handler on the stable #answers-content container for
 * exactly this reason.
 */
import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { ensureWindowFitsViewport } from '../../helpers/browser-window';
import { afterLoad, afterNav, afterAction } from '../../helpers/timing';
import { webBaseURL } from '../../helpers/ports';
import { attachE2eBrowserTabLabel } from '../../helpers/e2e-tab-title';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';

const ANSWER_COUNT = 40;

test.describe('Me tab: progressive render for long answer lists (R3)', () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage1Spec();
    browser = await chromium.launch({
      args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=0,0', '--window-size=960,1400', '--force-device-scale-factor=1'],
    });
  });

  test.afterAll(async () => {
    if (page) await page.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup?.()).catch(() => {});
    if (page) await page.close();
    if (context) await context.close();
    if (browser) await browser.close();
    await clearGunForStage1Spec();
  });

  async function seedAnswers(count: number): Promise<void> {
    await page.evaluate((n) => {
      const history: Record<string, unknown> = {};
      for (let i = 0; i < n; i += 1) {
        const id = `progressive-answer-${String(i).padStart(3, '0')}`;
        history[id] = {
          id, talkId: `talk-${id}`, title: `Progressive Answer ${i}`,
          type: 'flow', language: 'en', outcome: 'match',
          answeredAt: new Date(2026, 0, 1, 0, 0, i).toISOString(),
          senderIds: [],
          items: [{
            questionId: `q-${id}`, answerId: `a-${id}`, kind: 'question',
            prompt: `Question ${i}?`, choice: `Answer ${i}`, contextLabel: '', contextPath: [],
          }],
        };
      }
      localStorage.setItem('myAnswerHistory', JSON.stringify(history));
    }, count);
  }

  test('rapid successive re-renders settle with no dropped or duplicated rows; a remainder row is fully interactive', async () => {
    context = await browser.newContext({ viewport: { width: 960, height: 1200 }, deviceScaleFactor: 1 });
    page = await context.newPage();
    page.on('console', (m) => console.log('[Browser]:', m.text()));
    await injectIdbClear(page);
    await gotoWebApp(page, webBaseURL());
    await ensureWindowFitsViewport(page, 960, 1200);
    await afterLoad();
    attachE2eBrowserTabLabel(page, 'ProgressiveAnswers');
    await page.click('.nav-btn[data-view="settings"]');
    await afterNav();
    await page.fill('#settings-stage-name-input', 'ProgressiveAnswers');
    await page.locator('#settings-stage-name-input').blur();
    await afterNav();

    await seedAnswers(ANSWER_COUNT);

    await page.click('.nav-btn[data-view="me"]');
    await afterNav();
    await page.evaluate(() => (window as any).__iinpublic_app?.getApp()?.uiManager?.displayAnswersList?.());
    await afterAction();

    // Fire several re-renders synchronously back-to-back and read the row count right as
    // the deferred remainders would fire (one rAF + one setTimeout(0)) — not after
    // crossing back to Playwright and waiting a fixed delay, which would let an
    // unrelated real re-render paper over a brief duplicate-row flash at that moment.
    const idsAtRemainderMoment = await page.evaluate(() => new Promise<(string | undefined)[]>((resolve) => {
      const ui = (window as any).__iinpublic_app?.getApp?.()?.uiManager;
      for (let i = 0; i < 5; i += 1) ui.displayAnswersList();
      requestAnimationFrame(() => {
        setTimeout(() => {
          const rows = Array.from(document.querySelectorAll<HTMLElement>('.answer-talk-item'));
          resolve(rows.map((row) => row.dataset.questionId));
        }, 0);
      });
    }));
    expect(idsAtRemainderMoment).toHaveLength(ANSWER_COUNT);
    expect(new Set(idsAtRemainderMoment).size).toBe(ANSWER_COUNT);

    await afterAction();
    await page.waitForTimeout(300);

    const ids = await page.locator('.answer-talk-item[data-question-id]').evaluateAll(
      (rows) => rows.map((row) => (row as HTMLElement).dataset.questionId),
    );
    expect(ids).toHaveLength(ANSWER_COUNT);
    expect(new Set(ids).size).toBe(ANSWER_COUNT);

    // A row well past ANSWERS_FIRST_CHUNK_SIZE (25) — from the deferred remainder — has
    // its row-tap-to-open-popup fully wired via the delegated listener.
    const remainderRow = page.locator('.answer-talk-item[data-question-id="q-progressive-answer-039"]');
    await expect(remainderRow).toBeVisible();
    await remainderRow.click();
    await expect(page.locator('#item-details-popup')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#item-details-popup')).toContainText('Answer 39');
  });
});
