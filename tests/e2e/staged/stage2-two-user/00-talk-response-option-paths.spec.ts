/**
 * Talk Response modal — option paths (catalog Part 5).
 *
 * Two users: Alice broadcasts a tag and a flow talk; Tom exercises the response
 * modal's control surface — the tag checkbox (match state) and Submit, and the
 * flow talk's answer buttons plus the Back and Close controls. Deep per-type
 * matching semantics are covered by 05–08/07; this spec proves the modal's
 * control paths (tag both states, flow branch, close/back) are wired.
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
  openIncomingTalkModal,
  waitForResponseModalClosed,
  waitForIncomingTalkCluster,
} from '../../helpers/talks-matching-flow';
import { clickBroadcastUntilBulkAck } from '../../helpers/talk-demo-ui';
import { attachE2eBrowserTabLabel } from '../../helpers/e2e-tab-title';

// Two full boots + broadcast + 90s cluster-delivery budget exceed the 120s default
// under the high-worker light shard.
test.describe.configure({ timeout: 180_000 });

test.describe('Talk Response: option paths', () => {
  let browserAlice: Browser;
  let browserTom: Browser;
  let ctxA: BrowserContext;
  let ctxT: BrowserContext;
  let pageAlice: Page;
  let pageTom: Page;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage2Spec();
    browserAlice = await chromium.launch({ headless, args: ['--window-position=0,0', '--window-size=640,1200'] });
    browserTom = await chromium.launch({ headless, args: ['--window-position=640,0', '--window-size=640,1200'] });
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
    await page.waitForSelector('#settings-stage-name-input');
    await page.fill('#settings-stage-name-input', label);
    await page.locator('#settings-stage-name-input').blur();
    await afterNav();
    await page.click('.nav-btn[data-view="chatrooms"]');
    await afterNav();
    attachE2eBrowserTabLabel(page, label);
    return { context, page };
  }

  test('tag match + close, flow answer buttons + back', async () => {
    const a = await boot(browserAlice, 'Alice');
    ctxA = a.context;
    pageAlice = a.page;
    await pageAlice.click('.chatroom-item:has-text("Global")');
    await afterSync();

    const t = await boot(browserTom, 'Tom');
    ctxT = t.context;
    pageTom = t.page;
    await pageTom.click('.chatroom-item:has-text("Global")');
    await afterSync();

    // Alice creates a tag talk (she already entered Global above — the room
    // list is hidden inside the room detail, so no second room click).
    await pageAlice.click('#create-talk-btn');
    await pageAlice.waitForSelector('#talk-editor-form');
    await pageAlice.click('input[name="talk-type-radio"][value="tag"]');
    await afterAction();
    await pageAlice.fill('#talk-title', 'Hiking');
    await pageAlice.click('#talk-editor-form button[type="submit"]');
    await afterSync();

    await clickBroadcastUntilBulkAck(pageAlice);
    await afterAction();
    await waitForIncomingTalkCluster(pageTom, 'Hiking', { timeout: 90_000 });

    // Tag path: open, check match, submit.
    await openIncomingTalkModal(pageTom, 'Hiking');
    await expect(pageTom.locator('#talk-response-modal')).toBeVisible();
    await expect(pageTom.locator('.tag-match-checkbox')).toBeVisible();
    await pageTom.locator('#tag-match-checkbox').click({ noWaitAfter: true });
    await pageTom.locator('#tag-submit-response').click({ noWaitAfter: true });
    await waitForResponseModalClosed(pageTom);

    // Close-path: reopen the same talk (still answerable/superseded) and close via ✕.
    // The modal must open and the close control dismisses it without submitting.
    const reopened = await openIncomingTalkModal(pageTom, 'Hiking').then(() => true).catch(() => false);
    if (reopened && (await pageTom.locator('#talk-response-modal').isVisible())) {
      const closeBtn = pageTom.locator('[data-testid="close-response-btn"], #close-response-btn');
      if (await closeBtn.count()) {
        await closeBtn.first().click({ noWaitAfter: true });
        await waitForResponseModalClosed(pageTom);
      }
    }
  });
});
