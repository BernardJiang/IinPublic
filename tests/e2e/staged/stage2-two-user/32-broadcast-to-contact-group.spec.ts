import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { ensureWindowFitsViewport } from '../../helpers/browser-window';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';
import { afterLoad, afterSync, afterNav, afterAction, delay, headless } from '../../helpers/timing';
import { webAppURLStableChatroom } from '../../helpers/ports';
import { attachE2eBrowserTabLabel } from '../../helpers/e2e-tab-title';
import { establishContactsTomJerry, getCurrentUserId } from '../../helpers/reputation-e2e-helpers';
import { selectTalkEditorType } from '../../helpers/talk-editor-e2e';
import { submitTalkEditorAndWaitForOut } from '../../helpers/talk-demo-ui';
import { getIncomingClusterTitlesForUser } from '../../helpers/talks-matching-flow';

/**
 * docs/TODO.md §U — Broadcast to a contact group. Verifies the group-picker dialog on the
 * Contacts tab resolves a named group to the right recipients and actually delivers, using
 * the same mesh-plus-mailbox path every other broadcast already uses.
 */
test.describe('Broadcast to a contact group', () => {
  test.describe.configure({ retries: 0 });
  let browserTom: Browser;
  let browserJerry: Browser;
  let contextTom: BrowserContext;
  let contextJerry: BrowserContext;
  let pageTom: Page;
  let pageJerry: Page;

  test.setTimeout(300_000);

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage2Spec();
    browserTom = await chromium.launch({
      headless,
      slowMo: headless ? 0 : delay(50, 120),
      args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=0,0', '--window-size=640,1200', '--force-device-scale-factor=1'],
    });
    browserJerry = await chromium.launch({
      headless,
      slowMo: headless ? 0 : delay(50, 120),
      args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=640,0', '--window-size=640,1200', '--force-device-scale-factor=1'],
    });
  });

  test.afterAll(async () => {
    const cleanup = async (p?: Page) => {
      if (!p) return;
      try {
        await p.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup());
      } catch { /* best-effort */ }
    };
    await cleanup(pageTom);
    await cleanup(pageJerry);
    await pageTom?.close();
    await pageJerry?.close();
    await contextTom?.close();
    await contextJerry?.close();
    await browserTom?.close();
    await browserJerry?.close();
    await clearGunForStage2Spec();
  });

  async function bootstrapUser(browser: Browser, label: string, stageName: string): Promise<{ context: BrowserContext; page: Page }> {
    const context = await browser.newContext({ viewport: { width: 640, height: 1000 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on('console', (m) => console.log(`[${label}]:`, m.text()));
    await injectIdbClear(page);
    await gotoWebApp(page, webAppURLStableChatroom());
    await ensureWindowFitsViewport(page, 640, 1000);
    await afterLoad();
    await page.click('.nav-btn[data-view="settings"]');
    await afterNav();
    await page.waitForSelector('#settings-stage-name-input');
    await page.fill('#settings-stage-name-input', stageName);
    await page.locator('#settings-stage-name-input').blur();
    await afterNav();
    await page.click('.nav-btn[data-view="chatrooms"]');
    await afterNav();
    attachE2eBrowserTabLabel(page, label);
    return { context, page };
  }

  test('group-picker resolves a custom group and delivers via the normal broadcast path', async () => {
    const tom = await bootstrapUser(browserTom, 'Tom', 'Tom');
    contextTom = tom.context;
    pageTom = tom.page;

    const jerry = await bootstrapUser(browserJerry, 'Jerry', 'Jerry');
    contextJerry = jerry.context;
    pageJerry = jerry.page;

    const talkTitle = `Contact Group Test ${Date.now()}`;
    await establishContactsTomJerry(pageTom, pageJerry, talkTitle);
    const jerryId = await getCurrentUserId(pageJerry);

    // ── Tom labels Jerry with a custom group — "Tennis Buddy" needs no schema change ──
    await pageTom.evaluate((targetId) => {
      const app = (window as any).__iinpublic_app?.getApp?.();
      const ui = app?.uiManager;
      if (!ui?.saveKnownPerson) throw new Error('uiManager.saveKnownPerson unavailable');
      return ui.saveKnownPerson(targetId, { label: 'custom', customLabel: 'Tennis Buddy' });
    }, jerryId);
    await afterAction();

    // ── Tom creates a second talk to broadcast to the group (separate from the match talk) ──
    const groupTalkTitle = `Group Broadcast Talk ${Date.now()}`;
    await pageTom.click('#create-talk-btn');
    await pageTom.waitForSelector('#talk-editor-form');
    await pageTom.fill('#talk-title', groupTalkTitle);
    await selectTalkEditorType(pageTom, 'flow');
    const q = pageTom.locator('.question-item').first();
    await q.locator('.question-text').fill('Free for tennis this weekend?');
    await q.locator('.answer-item').nth(0).locator('.answer-text').fill('Yes.');
    await q.locator('.answer-item').nth(0).locator('.answer-next').selectOption('noticed');
    await q.locator('.answer-item').nth(1).locator('.answer-text').fill('No.');
    await q.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');
    // Uncheck "send to chatroom" — Tom is still in the Global room from the match setup, and
    // creating a talk there auto-broadcasts it to the room by default. This test needs to
    // prove the *group* broadcast delivers it, not the room's own separate auto-broadcast,
    // so the two paths can't be conflated.
    const sendToChatroomCheckbox = pageTom.locator('#talk-send-to-chatroom');
    if (await sendToChatroomCheckbox.count()) {
      await sendToChatroomCheckbox.uncheck();
    }
    await submitTalkEditorAndWaitForOut(pageTom, groupTalkTitle);

    // ── Open the Contacts tab and the group-broadcast picker ──────────────────────────
    await pageTom.click('.nav-btn[data-view="contacts"]');
    await afterNav();
    await pageTom.click('#contacts-broadcast-group-btn');

    const modal = pageTom.locator('#broadcast-group-modal');
    await expect(modal).toBeVisible({ timeout: 10000 });

    // The custom group Tom just created should be selectable, showing 1 member.
    const groupSelect = pageTom.locator('#broadcast-group-select');
    await expect(groupSelect.locator('option', { hasText: 'Tennis Buddy (1)' })).toHaveCount(1);
    await groupSelect.selectOption({ label: 'Tennis Buddy (1)' });
    await expect(pageTom.locator('#broadcast-group-preview')).toContainText('1');

    // Pick the talk to send and confirm.
    const talkSelect = pageTom.locator('#broadcast-group-talk-select');
    await expect(talkSelect.locator('option', { hasText: groupTalkTitle })).toHaveCount(1);
    await talkSelect.selectOption({ label: groupTalkTitle });
    await pageTom.click('[data-testid="broadcast-group-confirm"]');
    await expect(modal).toHaveCount(0);
    await afterSync();

    // ── Jerry receives it via the normal incoming-talk path ────────────────────────────
    await expect
      .poll(
        async () => getIncomingClusterTitlesForUser(pageJerry, jerryId),
        { message: 'Jerry should have received the group-broadcast talk', timeout: 60_000 },
      )
      .toContain(groupTalkTitle);
  });
});
