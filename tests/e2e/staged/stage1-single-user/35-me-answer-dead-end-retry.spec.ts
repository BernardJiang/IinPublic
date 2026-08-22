/**
 * TODO §P: a Me-tab answer entry whose source talk no longer resolves (purged from local
 * storage, never re-synced) used to fail past a one-shot error toast whose copy claimed a
 * retry it didn't perform. showTalkDetail now offers a real retry: the toast's click
 * re-attempts the same lookup, and a successful retry opens the talk normally.
 */
import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { ensureWindowFitsViewport } from '../../helpers/browser-window';
import { afterLoad, afterSync, afterNav, headless } from '../../helpers/timing';
import { webBaseURL } from '../../helpers/ports';
import { attachE2eBrowserTabLabel } from '../../helpers/e2e-tab-title';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';

// A syntactically valid talk id (matches TALK_CONTENT_HASH_ID, qa_[0-9a-f]{8}) that was never
// actually created anywhere — guarantees demandFullTalk's mesh-cache/local-storage/short-retry
// lookup fails on the first attempt, deterministically.
const DEAD_TALK_ID = 'qa_deadbeef';

test.describe('Me-tab answer dead-end retry (P)', () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage1Spec();
    browser = await chromium.launch({
      headless,
      args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=0,0', '--window-size=960,1400', '--force-device-scale-factor=1'],
    });
  });

  test.afterAll(async () => {
    if (page) await page.close();
    if (context) await context.close();
    if (browser) await browser.close();
    await clearGunForStage1Spec();
  });

  test('purged talk: Me-tab click shows a real retry affordance; successful retry opens the talk', async () => {
    context = await browser.newContext({ viewport: { width: 960, height: 1200 }, deviceScaleFactor: 1 });
    page = await context.newPage();
    page.on('console', (m) => console.log('[Browser]:', m.text()));
    await injectIdbClear(page);
    await gotoWebApp(page, webBaseURL());
    await ensureWindowFitsViewport(page, 960, 1200);
    await afterLoad();
    attachE2eBrowserTabLabel(page, 'DeadEndUser');

    // Seed a flat answer-history record whose talkId is not present in myTalks — the Me-tab
    // renders this entry (flatHistory is preferred over myTalks-derived entries) but has no
    // local myTalks[talkId] to open from, matching a "purged from local storage" talk.
    await page.evaluate((talkId: string) => {
      const record = {
        id: `${talkId}:hist`,
        talkId,
        title: 'Purged Talk',
        type: 'flow',
        language: 'en',
        outcome: 'match',
        answeredAt: new Date().toISOString(),
        senderIds: ['someone'],
        items: [
          {
            questionId: 'q1',
            answerId: 'a1',
            prompt: 'Do you like tea?',
            choice: 'Yes',
            kind: 'question',
            contextPath: [],
          },
        ],
      };
      localStorage.setItem('myAnswerHistory', JSON.stringify({ [record.id]: record }));
    }, DEAD_TALK_ID);

    await page.click('.nav-btn[data-view="me"]');
    await afterNav();
    await afterSync();

    // docs/TODO.md §LL.2 follow-up: the Me tab no longer shows talk titles (or an expand-in-
    // place popup) — the row is found by its question prompt, and clicking its answer jumps
    // straight to showTalkDetail, hitting the dead-end lookup directly.
    const answerItem = page.locator('.answer-talk-item').filter({ hasText: 'Do you like tea?' }).first();
    await expect(answerItem).toBeVisible({ timeout: 15_000 });
    await answerItem.locator('.answer-context-jump').click();

    // First attempt fails (nothing anywhere resolves DEAD_TALK_ID) — real retry affordance,
    // not just a dead toast: the notification is marked retryable and no talk dialog opened.
    const retryToast = page.locator('.notification[data-retryable="true"]');
    await expect(retryToast).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#talk-response-modal')).toHaveCount(0);

    // Simulate the data becoming available since the first attempt (e.g. a delayed mesh
    // announce catching up) by seeding the mesh cache directly, then click the toast to retry.
    await page.evaluate((talkId: string) => {
      const app = (window as any).__iinpublic_app?.getApp?.();
      const talkDef = {
        id: talkId,
        authorId: 'someone',
        authorName: 'Someone',
        title: 'Purged Talk',
        type: 'flow',
        questions: [
          {
            id: 'q1',
            text: 'Do you like tea?',
            answers: [
              { id: 'a1', text: 'Yes', isMatch: true },
              { id: 'a2', text: 'No', isMatch: false, isIgnore: true },
            ],
          },
        ],
      };
      app?.peerMeshService?.cacheTalkBody?.(talkId, talkDef);
    }, DEAD_TALK_ID);

    await retryToast.click();

    await expect(page.locator('#talk-response-modal')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#talk-response-modal')).toContainText('Purged Talk');
  });
});
