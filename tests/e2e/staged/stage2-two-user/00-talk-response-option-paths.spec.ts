/**
 * Incoming Talk response — option paths (catalog Part 5).
 *
 * Two users: Alice broadcasts a tag and Tom exercises the tag's direct Like control. Tags avoid
 * the Flow/Survey/Route auto/manual response surface; deep matching semantics are covered by 07.
 *
 * Renamed 66- → 00-: at ~165s this is the slowest light-shard spec; the 00- prefix makes
 * Playwright schedule it first so it never sets the shard tail (see playwright.config.ts).
 */
import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { ensureWindowFitsViewport } from '../../helpers/browser-window';
import { afterLoad, afterSync, afterNav, afterAction, headless } from '../../helpers/timing';
import { webAppURLStableChatroom } from '../../helpers/ports';
import {
  clickIncomingTagDecision,
  waitForIncomingTalkCluster,
} from '../../helpers/talks-matching-flow';
import { clickBroadcastUntilBulkAck } from '../../helpers/talk-demo-ui';
import { attachE2eBrowserTabLabel } from '../../helpers/e2e-tab-title';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';
import { openSettingsSection, SETTINGS_SECTION } from '../../helpers/settings-nav';
import { openCurrentChatroom } from '../../helpers/chatroom-nav';
import { openTalkEditor } from '../../helpers/open-talk-editor';

// Two full boots + broadcast + 90s cluster-delivery budget exceed the 120s default
// under the high-worker light shard. Raised 180s → 240s on 2026-07-17 after the spec
// (constant ~165s in every run) crossed 180s at 12 light workers — TEMPORARY headroom
// while the stage-timing instrumentation below identifies which budget dominates
// (speed plan §4.4); the aim is to shrink the spec, not keep the ceiling.
test.describe.configure({ timeout: 240_000 });

test.describe('Talk Response: option paths', () => {
  let browserAlice: Browser;
  let browserTom: Browser;
  let ctxA: BrowserContext;
  let ctxT: BrowserContext;
  let pageAlice: Page;
  let pageTom: Page;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage2Spec();
    browserAlice = await chromium.launch({ headless, args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=0,0', '--window-size=640,1200'] });
    browserTom = await chromium.launch({ headless, args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=640,0', '--window-size=640,1200'] });
  });

  test.afterAll(async () => {
    for (const p of [pageAlice, pageTom]) {
      try {
        await p?.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.());
      } catch {
        /* ignore */
      }
    }
    await pageAlice?.close().catch(() => {});
    await pageTom?.close().catch(() => {});
    await ctxA?.close().catch(() => {});
    await ctxT?.close().catch(() => {});
    await browserAlice?.close().catch(() => {});
    await browserTom?.close().catch(() => {});
    await clearGunForStage2Spec();
  });

  async function boot(browser: Browser, label: string): Promise<{ context: BrowserContext; page: Page }> {
    const context = await browser.newContext({ viewport: { width: 640, height: 1000 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await injectIdbClear(page);
    await gotoWebApp(page, webAppURLStableChatroom());
    await ensureWindowFitsViewport(page, 640, 1000);
    await afterLoad();
    await page.click('.nav-btn[data-view="settings"]');
    await afterNav();
    await openSettingsSection(page, SETTINGS_SECTION.profile);
    await page.waitForSelector('#settings-stage-name-input');
    await page.fill('#settings-stage-name-input', label);
    await page.locator('#settings-stage-name-input').blur();
    await afterNav();
    await page.click('.nav-btn[data-view="chatrooms"]');
    await afterNav();
    attachE2eBrowserTabLabel(page, label);
    return { context, page };
  }

  test('tag Like is a direct one-tap response without a response modal', async () => {
    // Stage-timing instrumentation: this spec has run at a suspiciously CONSTANT
    // ~165s in every full-suite run (see speed plan §4.4 — stacked fixed budgets
    // suspected) and blew its 180s ceiling at 12 light workers. Timings are appended
    // to test-logs/perf-00-talk-response.jsonl on every run (pass or fail) so the
    // dominant stage can be identified from any machine's run.
    const t0 = Date.now();
    const stages: Record<string, number> = {};
    let lastMark = t0;
    const mark = (name: string) => {
      const now = Date.now();
      stages[name] = Math.round((now - lastMark) / 100) / 10;
      lastMark = now;
      console.log(`[PERF] 00-talk-response +${Math.round((now - t0) / 1000)}s after ${name}`);
    };

    const a = await boot(browserAlice, 'Alice');
    ctxA = a.context;
    pageAlice = a.page;
    await openCurrentChatroom(pageAlice);
    await afterSync();
    mark('bootAlice');

    const t = await boot(browserTom, 'Tom');
    ctxT = t.context;
    pageTom = t.page;
    await openCurrentChatroom(pageTom);
    await afterSync();
    mark('bootTom');

    // Alice creates a tag talk (she already entered Global above — the room
    // list is hidden inside the room detail, so no second room click). Create Talk is contextual
    // to the Talks tab.
    await pageAlice.click('.nav-btn[data-view="talks"]');
    await afterNav();
    await openTalkEditor(pageAlice);
    await pageAlice.waitForSelector('#talk-editor-form');
    await pageAlice.click('input[name="talk-type-radio"][value="tag"]');
    await afterAction();
    await pageAlice.fill('#talk-title', 'Hiking');
    await pageAlice.click('#talk-submit-btn');
    await afterSync();
    mark('createTalk');

    await clickBroadcastUntilBulkAck(pageAlice);
    await afterAction();
    mark('broadcast');
    await waitForIncomingTalkCluster(pageTom, 'Hiking', { timeout: 90_000 });
    mark('clusterWait');

    const persistStages = async () => {
      stages.total = Math.round((Date.now() - t0) / 100) / 10;
      const fs = await import('node:fs');
      const path = await import('node:path');
      const dir = path.resolve(__dirname, '../../../../test-logs');
      fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(
        path.join(dir, 'perf-00-talk-response.jsonl'),
        JSON.stringify({ at: new Date().toISOString(), workers: process.env.PW_WORKERS || '?', ...stages }) + '\n',
      );
    };

    const hikingRow = pageTom.locator('.talk-list-item[data-role="incoming"]').filter({ hasText: 'Hiking' });
    await clickIncomingTagDecision(pageTom, 'Hiking', 'like', { timeout: 90_000 });
    mark('likeTag');
    await persistStages().catch(() => {});
    await expect(hikingRow).toHaveCount(0);
    await expect(pageTom.locator('#talk-response-modal')).toHaveCount(0);
    await expect(pageTom.locator('.talk-list-item[data-role="copied"]').filter({ hasText: 'Hiking' })).toBeVisible();
  });
});
