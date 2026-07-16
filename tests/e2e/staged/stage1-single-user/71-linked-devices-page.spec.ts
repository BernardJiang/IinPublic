/**
 * Linked devices page (GUI redesign §10.4, TODO item I / T10).
 *
 * Single device: the Settings › Linked devices page opens with an empty state;
 * the Link-a-device dialog shows a code with a live countdown; the Enter-code
 * dialog rejects invalid and expired codes inline and accepts a valid one
 * (adding a row); Unlink removes it via a confirm dialog.
 */
import { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { afterNav, afterSync, afterLoad } from '../../helpers/timing';
import { webBaseURL } from '../../helpers/ports';
import { encodePairingCode, PAIRING_TTL_MS } from '../../../../src/shared/identity-linking';

test.describe('Linked devices page', () => {
  let context: BrowserContext | undefined;
  let page: Page | undefined;

  test.beforeEach(async ({ browser }) => {
    await clearGunForStage1Spec();
    context = await browser.newContext({ viewport: { width: 1000, height: 1100 }, deviceScaleFactor: 1 });
    page = await context.newPage();
    await injectIdbClear(page);
    await gotoWebApp(page, webBaseURL());
    await afterLoad();
    await page.locator('.nav-btn[data-view="settings"]').click();
    await afterNav();
    await page.waitForSelector('[data-testid="settings-linked-devices-btn"]');
  });

  test.afterEach(async () => {
    await page?.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
    await context?.close().catch(() => {});
    await clearGunForStage1Spec();
  });

  test('open/close, empty state, code lifecycle, error paths, unlink', async () => {
    const p = page!;

    // Open the page → empty state.
    await p.locator('[data-testid="settings-linked-devices-btn"]').click();
    await afterNav();
    await expect(p.locator('[data-testid="linked-devices-page"]')).toBeVisible();
    await expect(p.locator('[data-testid="linked-devices-empty"]')).toBeVisible();

    // Link-a-device: code + countdown render; close via Done.
    await p.locator('[data-testid="link-a-device-btn"]').click();
    await afterNav();
    await expect(p.locator('[data-testid="link-device-code-modal"]')).toBeVisible();
    await expect(p.locator('[data-testid="link-device-code"]')).not.toBeEmpty();
    await expect(p.locator('#link-device-countdown')).toContainText(':');
    await p.locator('#link-device-done').click();
    await afterNav();
    await expect(p.locator('[data-testid="link-device-code-modal"]')).toHaveCount(0);

    // Enter-code: invalid.
    await p.locator('[data-testid="enter-link-code-btn"]').click();
    await afterNav();
    await p.fill('[data-testid="enter-link-code-input"]', 'garbage!!!');
    await p.locator('[data-testid="enter-link-code-submit"]').click();
    await afterSync();
    await expect(p.locator('[data-testid="enter-link-code-error"]')).not.toBeEmpty();

    // Enter-code: expired.
    const expiredCode = encodePairingCode({ pub: 'other-device-pub', secret: 'sekret', expiresAt: Date.now() - 1000 });
    await p.fill('[data-testid="enter-link-code-input"]', expiredCode);
    await p.locator('[data-testid="enter-link-code-submit"]').click();
    await afterSync();
    await expect(p.locator('[data-testid="enter-link-code-error"]')).not.toBeEmpty();

    // Enter-code: valid → a row is added.
    const validCode = encodePairingCode({ pub: 'other-device-pub', secret: 'sekret', expiresAt: Date.now() + PAIRING_TTL_MS });
    await p.fill('[data-testid="enter-link-code-input"]', validCode);
    await p.locator('[data-testid="enter-link-code-submit"]').click();
    await afterSync();
    await expect(p.locator('[data-testid="linked-device-row"]')).toHaveCount(1);

    // Unlink via confirm.
    await p.locator('[data-testid="linked-device-unlink-btn"]').first().click();
    await afterNav();
    await expect(p.locator('[data-testid="unlink-device-confirm"]')).toBeVisible();
    await p.locator('[data-testid="unlink-confirm-btn"]').click();
    await afterSync();
    await expect(p.locator('[data-testid="linked-device-row"]')).toHaveCount(0);
    await expect(p.locator('[data-testid="linked-devices-empty"]')).toBeVisible();
  });
});
