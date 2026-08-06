/**
 * TODO §R2: Talks tab progressive render — with more talks than the first-chunk size
 * (TALKS_FIRST_CHUNK_SIZE = 25 in ui-manager.ts), the first chunk is visible immediately
 * and the remainder fills in shortly after, without dropping or duplicating any row even
 * under several rapid successive re-renders (sort change, then filter change) fired
 * before the first render's deferred remainder has had a chance to land — the scenario
 * that would expose a staleness/duplication race in renderListProgressively's usage here.
 * A deferred-remainder row must also be interactive: displayTalksList's per-row listener
 * loops were replaced by one delegated click handler for exactly this reason.
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
import { openSettingsSection, SETTINGS_SECTION } from '../../helpers/settings-nav';

const TALK_COUNT = 40;

test.describe('Talks tab: progressive render for long lists (R2)', () => {
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

  async function seedTalks(userId: string): Promise<void> {
    await page.evaluate(({ authorId, count }) => {
      const talks: Record<string, unknown> = {};
      // WebTalkService.getTalk (loadTalkForEdit's fetch) reads the separate
      // myAuthoredTalks store, not myTalks — both need seeding for a clicked row to
      // actually open the editor with real content.
      const authoredTalks: Record<string, { talkJson: string; createdAt: string }> = {};
      const createdAt = new Date().toISOString();
      for (let i = 1; i <= count; i += 1) {
        const talkId = `progressive-talk-${String(i).padStart(3, '0')}`;
        const fullTalk = {
          id: talkId, authorId, title: `Progressive Talk ${i}`, type: 'flow', language: 'en', isAdult: false,
          questions: [{
            id: `${talkId}-q1`, text: 'Continue?',
            answers: [
              { id: `${talkId}-match`, text: 'Yes', isMatch: true, isTerminal: true },
              { id: `${talkId}-ignore`, text: 'No', isIgnore: true, isTerminal: true },
            ],
          }],
          createdAt,
        };
        talks[talkId] = {
          id: talkId, role: 'created', title: `Progressive Talk ${i}`,
          type: 'flow', language: 'en', timestamp: createdAt, createdAt,
          status: 'OUT', stats: { responses: 0, matched: 0 }, disabled: false,
          lastInteraction: createdAt,
          fullTalk,
        };
        authoredTalks[talkId] = { talkJson: JSON.stringify(fullTalk), createdAt };
      }
      localStorage.setItem('myTalks', JSON.stringify(talks));
      localStorage.setItem('myAuthoredTalks', JSON.stringify(authoredTalks));
    }, { authorId: userId, count: TALK_COUNT });
  }

  test('rapid successive re-renders settle with no dropped or duplicated rows; a remainder row is clickable', async () => {
    context = await browser.newContext({ viewport: { width: 960, height: 1200 }, deviceScaleFactor: 1 });
    page = await context.newPage();
    page.on('console', (m) => console.log('[Browser]:', m.text()));
    await injectIdbClear(page);
    await gotoWebApp(page, webBaseURL());
    await ensureWindowFitsViewport(page, 960, 1200);
    await afterLoad();
    attachE2eBrowserTabLabel(page, 'ProgressiveTalks');
    await page.click('.nav-btn[data-view="settings"]');
    await afterNav();
    await openSettingsSection(page, SETTINGS_SECTION.profile);
    await page.fill('#settings-stage-name-input', 'ProgressiveTalks');
    await page.locator('#settings-stage-name-input').blur();
    await afterNav();

    const userId = await page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.currentUser?.id || '');
    expect(userId).toBeTruthy();
    await seedTalks(userId);

    await page.click('.nav-btn[data-view="talks"]');
    await afterNav();
    // Every direction/type combination renders progressively straight into #talks-list
    // itself (one merged, chronologically-sorted list, no per-mode sub-container) — the
    // same shape as Contacts' listEl, where a stale deferred remainder could visibly
    // duplicate rows in the live container rather than an already-detached one.
    await page.locator('#talks-filter-incoming').uncheck();
    await afterAction();

    // Fire several re-renders synchronously back-to-back, in one JS tick — a Playwright
    // driver action per call (selectOption/fill) has enough of its own CDP round-trip
    // latency that any one call's deferred remainder (rAF + setTimeout(0)) would already
    // have landed before the next driver action even starts, which would never actually
    // exercise the race `talksRenderSeq`/`isStale` guards against. Calling the method
    // directly, several times with zero gap, is the only way to reliably force overlap.
    //
    // Read the row count from *inside* the same evaluate, right as each of the 5 calls'
    // own deferred remainders would fire (one rAF + one setTimeout(0) after the loop) —
    // not after crossing back to Playwright and waiting a fixed real-world delay. A later,
    // unrelated real re-render (e.g. talk-stats arriving) can and does re-render the whole
    // list from scratch shortly afterward, which would silently paper over a brief
    // duplicate-row flash at exactly this moment if measured too late.
    const idsAtRemainderMoment = await page.evaluate(() => new Promise<(string | undefined)[]>((resolve) => {
      const ui = (window as any).__iinpublic_app?.getApp?.()?.uiManager;
      for (let i = 0; i < 5; i += 1) ui.displayTalksList();
      requestAnimationFrame(() => {
        setTimeout(() => {
          const rows = Array.from(document.querySelectorAll('.talk-list-item[data-talk-id]'));
          resolve(rows.map((row) => (row as HTMLElement).dataset.talkId));
        }, 0);
      });
    }));
    expect(idsAtRemainderMoment).toHaveLength(TALK_COUNT);
    expect(new Set(idsAtRemainderMoment).size).toBe(TALK_COUNT);

    await afterAction();
    await page.waitForTimeout(300);

    const ids = await page.locator('.talk-list-item[data-talk-id]').evaluateAll(
      (rows) => rows.map((row) => (row as HTMLElement).dataset.talkId),
    );
    expect(ids).toHaveLength(TALK_COUNT);
    expect(new Set(ids).size).toBe(TALK_COUNT);

    // A row well past TALKS_FIRST_CHUNK_SIZE (25) — from the deferred remainder — opens
    // the talk editor on click, proving the delegated listener covers it with nothing to
    // (re-)attach.
    const remainderRow = page.locator('.talk-list-item[data-talk-id="progressive-talk-040"]');
    await expect(remainderRow).toBeVisible();
    await remainderRow.click();
    await expect(page.locator('#talk-editor-form')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#talk-title')).toHaveValue('Progressive Talk 40');
  });
});
