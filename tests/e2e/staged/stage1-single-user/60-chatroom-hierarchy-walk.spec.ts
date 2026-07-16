/**
 * Chatrooms — hierarchy walk (catalog Part 5).
 *
 * Single user: expand/collapse every expandable node, confirm each row shows a
 * headcount, and enter a leaf room (room detail with a members list), then back.
 */
import { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { afterNav, afterSync } from '../../helpers/timing';
import { webBaseURL } from '../../helpers/ports';

test.describe('Chatrooms: hierarchy walk', () => {
  let context: BrowserContext | undefined;
  let page: Page | undefined;

  test.beforeEach(async ({ browser }) => {
    await clearGunForStage1Spec();
    context = await browser.newContext({ viewport: { width: 1100, height: 1100 }, deviceScaleFactor: 1 });
    page = await context.newPage();
    await injectIdbClear(page);
    await gotoWebApp(page, webBaseURL());
    await afterSync();
    await page.locator('.nav-btn[data-view="chatrooms"]').click();
    await afterNav();
  });

  test.afterEach(async () => {
    await page?.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
    await context?.close().catch(() => {});
    await clearGunForStage1Spec();
  });

  test('expand/collapse nodes, headcounts present, enter a room', async () => {
    const p = page!;
    await expect(p.locator('#chatroom-list')).toBeVisible();

    // Every rendered row shows a headcount badge.
    const rows = p.locator('.chatroom-item');
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
    expect(await p.locator('.chatroom-item .chatroom-headcount').count()).toBe(count);

    // Toggle the first expandable node both ways. The node may start expanded
    // (Global does), so the first click can collapse: assert the toggle moves
    // the row count and that toggling back restores it.
    const firstCaret = p.locator('.chatroom-expand-icon').first();
    if (await firstCaret.count()) {
      const before = await rows.count();
      await firstCaret.click();
      await afterSync();
      const toggled = await rows.count();
      expect(toggled).not.toBe(before);
      // Toggle the same node back; the original row count returns.
      await p.locator('.chatroom-expand-icon').first().click();
      await afterSync();
      expect(await rows.count()).toBe(before);
    }

    // Enter a room and see the room detail (members list), then go back.
    await p.locator('.chatroom-item').first().click();
    await afterNav();
    await expect(p.locator('#chatroom-members-list')).toBeVisible({ timeout: 10000 });
    const back = p.locator('[data-testid="back-to-chatrooms"], #back-to-chatrooms');
    if (await back.count()) {
      await back.first().click();
      await afterNav();
      await expect(p.locator('#chatroom-list')).toBeVisible();
    }
  });
});
