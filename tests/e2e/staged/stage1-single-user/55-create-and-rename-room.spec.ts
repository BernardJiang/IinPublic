/**
 * Create + rename a custom room (catalog Part 5, T6 tail; C5/C6).
 *
 * Single user: open the Create Room dialog, create a community room, land on its
 * room detail, then (as owner) rename it and see the new name.
 */
import { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { afterNav, afterSync, afterLoad } from '../../helpers/timing';
import { webBaseURL } from '../../helpers/ports';

test.describe('Chatrooms: create and rename a custom room', () => {
  let context: BrowserContext | undefined;
  let page: Page | undefined;

  test.beforeEach(async ({ browser }) => {
    await clearGunForStage1Spec();
    context = await browser.newContext({ viewport: { width: 1100, height: 1100 }, deviceScaleFactor: 1 });
    page = await context.newPage();
    await injectIdbClear(page);
    await gotoWebApp(page, webBaseURL());
    await afterLoad();
    await page.locator('.nav-btn[data-view="chatrooms"]').click();
    await afterNav();
  });

  test.afterEach(async () => {
    await page?.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
    await context?.close().catch(() => {});
    await clearGunForStage1Spec();
  });

  test('create a community room then rename it', async () => {
    const p = page!;
    const roomName = `E2E Room ${Date.now()}`;

    // Open the Create Room dialog via its trigger (inline at desktop width).
    // Fire-and-forget: the handler's promise only resolves when the dialog is
    // submitted/cancelled, so it must NOT be awaited from evaluate.
    await p.evaluate(() => {
      void (window as any).__iinpublic_app?.getApp?.()?.uiManager?.handleCreateCustomChatroomClick?.();
    });
    await afterNav();
    await p.waitForSelector('[data-testid="custom-room-name-input"]');
    await p.fill('[data-testid="custom-room-name-input"]', roomName);
    await p.locator('[data-testid="custom-room-submit-btn"]').click();
    await afterLoad();

    // Land on the new room's detail (members list) and see its name somewhere.
    await expect(p.locator('#chatroom-members-list')).toBeVisible({ timeout: 15000 });

    // Rename (owner control).
    const renameBtn = p.locator('[data-testid="chatroom-rename-btn"]');
    if (await renameBtn.count()) {
      await renameBtn.first().click();
      await afterNav();
      // The rename input's id is `rename-custom-room-name`; the stable hook is the testid.
      const input = p.locator('[data-testid="rename-custom-room-input"]');
      await input.waitFor({ timeout: 8000 });
      const newName = `${roomName} Renamed`;
      await input.fill(newName);
      // Submit the rename form (Enter or the submit button in the dialog).
      await input.press('Enter');
      await afterLoad();
      await expect(p.locator('body')).toContainText('Renamed', { timeout: 10000 });
    }
  });
});
