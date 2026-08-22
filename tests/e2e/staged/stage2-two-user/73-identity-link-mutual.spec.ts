/**
 * WP3 — two independent installations establish and revoke a direct mutual
 * identity link. Each browser context owns a different SEA keypair and storage.
 */
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { afterLoad, afterSync } from '../../helpers/timing';
import { webBaseURL } from '../../helpers/ports';
import { openSettingsSection, SETTINGS_SECTION } from '../../helpers/settings-nav';

async function openIdentityDevices(page: Page): Promise<void> {
  await page.locator('.nav-btn[data-view="settings"]').click();
  await openSettingsSection(page, SETTINGS_SECTION.linkedDevices);
  await page.locator('[data-testid="settings-linked-devices-btn"]').click();
  await expect(page.locator('[data-testid="linked-devices-page"]')).toBeVisible();
}

async function bootstrapDevice(browser: Browser): Promise<{
  context: BrowserContext;
  page: Page;
}> {
  const context = await browser.newContext({ viewport: { width: 760, height: 960 } });
  const page = await context.newPage();
  await injectIdbClear(page);
  await gotoWebApp(page, webBaseURL());
  await afterLoad();
  return { context, page };
}

test.describe('mutual direct identity linking', () => {
  test.beforeEach(async () => {
    await clearGunForStage2Spec();
  });

  test.afterEach(async () => {
    await clearGunForStage2Spec();
  });

  test('requires both signatures, rejects replay, and converges after revocation', async ({ browser }) => {
    test.setTimeout(90_000);
    const a = await bootstrapDevice(browser);
    const b = await bootstrapDevice(browser);

    try {
      await Promise.all([openIdentityDevices(a.page), openIdentityDevices(b.page)]);

      // A explicitly starts pairing and gives the versioned code to B.
      await a.page.locator('[data-testid="link-a-device-btn"]').click();
      await expect(a.page.locator('[data-testid="link-device-start-confirm"]')).toContainText('publicly reveal');
      await a.page.locator('[data-testid="confirm-generate-link-code"]').click();
      const code = (await a.page.locator('[data-testid="link-device-code"]').textContent()) || '';
      expect(code).not.toBe('');

      // B explicitly accepts the code and publishes only B's signed half.
      await b.page.locator('[data-testid="enter-link-code-btn"]').click();
      await b.page.locator('[data-testid="enter-link-code-input"]').fill(code);
      await expect(b.page.locator('[data-testid="enter-link-peer-preview"]')).toContainText('publicly reveal');
      await b.page.locator('[data-testid="enter-link-code-submit"]').click();
      await expect(b.page.locator('[data-testid="linked-device-row"]')).toContainText(
        'Waiting for approval',
        { timeout: 20_000 },
      );

      // A discovers B's signed request but must still explicitly approve it.
      const check = a.page.locator('[data-testid="link-device-check-request"]');
      await expect(check).toBeVisible();
      for (let attempt = 0; attempt < 8; attempt += 1) {
        await check.click();
        const approve = a.page.locator('[data-testid="approve-link-request"]');
        await expect.poll(async () =>
          (await approve.isVisible().catch(() => false)) || (await check.isEnabled().catch(() => false)),
        { timeout: 12_000 }).toBe(true);
        if (await approve.isVisible().catch(() => false)) break;
        await a.page.waitForTimeout(400);
      }
      await expect(a.page.locator('[data-testid="approve-link-request"]')).toBeVisible();
      await a.page.locator('[data-testid="approve-link-request"]').click();
      await expect(a.page.locator('[data-testid="link-device-code-modal"]')).toHaveCount(0);
      await expect(a.page.locator('[data-testid="linked-device-row"]')).toContainText('Linked');

      // B independently verifies both graph signatures before changing its row.
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await b.page.locator('[data-testid="refresh-linked-devices"]').click();
        if ((await b.page.locator('[data-testid="linked-device-row"]').textContent())?.includes('Linked')) break;
        await b.page.waitForTimeout(500);
      }
      await expect(b.page.locator('[data-testid="linked-device-row"]')).toContainText('Linked');

      // The same one-time code cannot be accepted twice.
      await b.page.locator('[data-testid="enter-link-code-btn"]').click();
      await b.page.locator('[data-testid="enter-link-code-input"]').fill(code);
      await b.page.locator('[data-testid="enter-link-code-submit"]').click();
      await expect(b.page.locator('[data-testid="enter-link-code-error"]')).toContainText('already linked');
      await b.page.locator('#enter-link-code-cancel').click();

      // A revokes locally; B resolves the signed revocation rather than claiming
      // that A or B's remote data was erased.
      await a.page.locator('[data-testid="linked-device-unlink-btn"]').click();
      await a.page.locator('[data-testid="unlink-confirm-btn"]').click();
      await expect(a.page.locator('[data-testid="linked-device-row"]')).toHaveCount(0);
      await afterSync();
      await b.page.locator('[data-testid="refresh-linked-devices"]').click();
      await expect(b.page.locator('[data-testid="linked-device-row"]')).toContainText(
        'Revocation pending',
        { timeout: 20_000 },
      );
    } finally {
      await Promise.all([
        a.page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {}),
        b.page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {}),
      ]);
      await Promise.all([a.context.close(), b.context.close()]);
    }
  });
});
