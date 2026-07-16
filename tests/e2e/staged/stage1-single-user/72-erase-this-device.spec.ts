/**
 * Erase this device (GUI redesign §11, TODO item J / T11).
 *
 * Single device: the Erase confirm dialog gates the wipe behind a type-`ERASE`
 * input; Cancel leaves everything intact; confirming wipes all storage and
 * reloads to a fresh boot with a new identity and none of the prior data.
 */
import { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { afterNav, afterSync, afterLoad } from '../../helpers/timing';
import { webBaseURL } from '../../helpers/ports';

test.describe('Erase this device', () => {
  let context: BrowserContext | undefined;
  let page: Page | undefined;

  test.beforeEach(async ({ browser }) => {
    await clearGunForStage1Spec();
    context = await browser.newContext({ viewport: { width: 1000, height: 1100 }, deviceScaleFactor: 1 });
    page = await context.newPage();
    await injectIdbClear(page);
    await gotoWebApp(page, webBaseURL());
    await afterLoad();
  });

  test.afterEach(async () => {
    await context?.close().catch(() => {});
    await clearGunForStage1Spec();
  });

  test('typed-confirm gate, cancel intact, wipe verified, fresh identity', async () => {
    const p = page!;

    // Establish an identity + a marker we can check for after the wipe.
    const idBefore = await p.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.currentUser?.id || '');
    expect(idBefore).not.toEqual('');
    await p.evaluate(() => localStorage.setItem('iinpublic_test_marker', 'present'));

    await p.locator('.nav-btn[data-view="settings"]').click();
    await afterNav();
    await p.waitForSelector('[data-testid="settings-erase-device-btn"]');

    // Open the dialog; the erase button is disabled until the confirm word matches.
    await p.locator('[data-testid="settings-erase-device-btn"]').click();
    await afterNav();
    await expect(p.locator('[data-testid="erase-device-modal"]')).toBeVisible();
    await expect(p.locator('[data-testid="erase-device-btn"]')).toBeDisabled();
    await p.fill('[data-testid="erase-confirm-input"]', 'WRONG');
    await expect(p.locator('[data-testid="erase-device-btn"]')).toBeDisabled();
    await p.fill('[data-testid="erase-confirm-input"]', 'ERASE');
    await expect(p.locator('[data-testid="erase-device-btn"]')).toBeEnabled();

    // Cancel leaves everything intact.
    await p.locator('#erase-cancel-btn').click();
    await afterSync();
    await expect(p.locator('[data-testid="erase-device-modal"]')).toHaveCount(0);
    expect(await p.evaluate(() => localStorage.getItem('iinpublic_test_marker'))).toBe('present');
    expect(await p.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.currentUser?.id || '')).toBe(idBefore);

    // Confirm the wipe → storage cleared + reload to fresh boot.
    await p.locator('[data-testid="settings-erase-device-btn"]').click();
    await afterNav();
    await p.fill('[data-testid="erase-confirm-input"]', 'ERASE');
    await p.locator('[data-testid="erase-device-btn"]').click();

    // The app reloads; wait for a fresh boot.
    await p.waitForLoadState('load');
    await afterLoad();
    await expect
      .poll(async () => p.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.currentUser?.id || ''), {
        timeout: 30_000,
      })
      .not.toEqual('');

    // The prior marker is gone and a new identity exists.
    expect(await p.evaluate(() => localStorage.getItem('iinpublic_test_marker'))).toBeNull();
    const idAfter = await p.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.currentUser?.id || '');
    expect(idAfter).not.toEqual(idBefore);

    await p.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
  });
});
