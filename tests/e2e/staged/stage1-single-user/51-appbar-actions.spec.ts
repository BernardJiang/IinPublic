/**
 * AppBar actions (redesign §2, T1): every icon button fires the same handler the
 * old text buttons had, keeps its data-testid, and the back icon pops correctly.
 */
import { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { afterNav, afterSync } from '../../helpers/timing';
import { webBaseURL } from '../../helpers/ports';

test.describe('AppBar actions', () => {
  let context: BrowserContext | undefined;
  let page: Page | undefined;

  test.beforeEach(async ({ browser }) => {
    await clearGunForStage1Spec();
    context = await browser.newContext();
    page = await context.newPage();
    await injectIdbClear(page);
    await gotoWebApp(page, webBaseURL());
    await afterSync();
  });

  test.afterEach(async () => {
    await page?.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
    await context?.close().catch(() => {});
    await clearGunForStage1Spec();
  });

  test('testids preserved on all migrated buttons', async () => {
    const p = page!;
    await p.locator('.nav-btn[data-view="chatrooms"]').click();
    await afterNav();
    for (const testid of ['create-custom-chatroom-btn', 'return-home-btn', 'broadcast-talk-btn']) {
      await expect(p.locator(`[data-testid="${testid}"]`)).toHaveCount(1);
    }
    await expect(p.locator('[data-testid="bottom-navigation-button-chat"]')).toBeVisible();
  });

  test('➕ opens the talk editor', async () => {
    const p = page!;
    await p.locator('#create-talk-btn').click();
    await afterNav();
    await expect(p.locator('#talk-editor-modal')).toBeVisible();
    await p.locator('#cancel-talk-btn').click();
    await expect(p.locator('#talk-editor-modal')).toHaveCount(0);
  });

  test('🆕 opens the create-room dialog', async () => {
    const p = page!;
    await p.locator('#create-custom-chatroom-btn').click();
    await afterNav();
    await expect(p.locator('[data-testid="custom-room-name-input"]')).toBeVisible();
    await p.locator('#cancel-custom-room-btn').click();
    await expect(p.locator('[data-testid="custom-room-name-input"]')).toHaveCount(0);
  });

  test('📣 broadcast keeps its guard behavior with an empty OUT list', async () => {
    const p = page!;
    await p.locator('.chatroom-item[data-chatroom-id="asia"]').click();
    await afterNav();
    await p.locator('#broadcast-talk-btn').click();
    // Empty OUT list → guard toast, same handler as the old text button.
    await expect(p.locator('.notification', { hasText: /no talks to broadcast/i })).toBeVisible({ timeout: 10_000 });
  });

  test('🏠 return-home enable state carries over and back icon pops one level', async () => {
    const p = page!;
    await p.locator('.chatroom-item[data-chatroom-id="asia"]').click();
    await afterNav();
    // Away from home → enabled.
    await expect(p.locator('#return-home-btn')).toBeEnabled();

    // Back pops exactly one level: room detail → room list.
    await p.locator('#back-to-chatrooms').click();
    await afterNav();
    await expect(p.locator('#chatroom-list-container')).toBeVisible();
    await expect(p.locator('#chatroom-detail-container')).toBeHidden();
  });
});
