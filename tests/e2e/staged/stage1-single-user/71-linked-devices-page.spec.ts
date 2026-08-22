/**
 * Identity & devices page (identity architecture WP1, linking §10.4).
 *
 * Single installation: Settings › Identity & devices shows the identity,
 * protection, current-device, and linked-device cards. The Link-a-device dialog
 * emits the SEA public key with a live countdown; Enter-code rejects invalid and
 * expired codes inline and accepts a valid one; Remove link uses a confirmation.
 */
import { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { afterNav, afterSync, afterLoad } from '../../helpers/timing';
import { webBaseURL } from '../../helpers/ports';
import { decodePairingCode, encodePairingCode, PAIRING_TTL_MS } from '../../../../src/shared/identity-linking';
import { openSettingsSection, SETTINGS_SECTION } from '../../helpers/settings-nav';

test.describe('Identity & devices page', () => {
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
    await openSettingsSection(page, SETTINGS_SECTION.linkedDevices);
    await page.waitForSelector('[data-testid="settings-linked-devices-btn"]');
  });

  test.afterEach(async () => {
    await page?.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
    await context?.close().catch(() => {});
    await clearGunForStage1Spec();
  });

  test('open/close, empty state, code lifecycle, error paths, unlink', async () => {
    const p = page!;

    // Open the page → identity/protection/current-device shell plus linked-device empty state.
    await p.locator('[data-testid="settings-linked-devices-btn"]').click();
    await afterNav();
    await expect(p.locator('[data-testid="linked-devices-page"]')).toBeVisible();
    await expect(p.locator('[data-testid="linked-devices-close"]')).toBeFocused();
    await expect(p.locator('[data-testid="identity-card"]')).toBeVisible();
    await expect(p.locator('[data-testid="identity-fingerprint"]')).toHaveText(/\S{4} \S{4} \S{4} \S{4}/);
    await expect(p.locator('[data-testid="identity-status"]')).toContainText('Available on this device');
    await expect(p.locator('[data-testid="identity-protection-card"]')).toContainText('Identity password: Not set');
    await expect(p.locator('[data-testid="current-device-card"]')).toContainText('This browser');
    await expect(p.locator('[data-testid="linked-devices-empty"]')).toBeVisible();

    // Device labels are local metadata and can be renamed without changing the identity.
    const fingerprintBeforeRename = await p.locator('[data-testid="identity-fingerprint"]').textContent();
    await p.locator('[data-testid="rename-current-device"]').click();
    await expect(p.locator('[data-testid="rename-device-input"]')).toBeFocused();
    await p.keyboard.press('Escape');
    await expect(p.locator('[data-testid="rename-device-modal"]')).toHaveCount(0);
    await expect(p.locator('[data-testid="rename-current-device"]')).toBeFocused();
    await p.locator('[data-testid="rename-current-device"]').click();
    await p.fill('[data-testid="rename-device-input"]', 'My private browser');
    await p.locator('[data-testid="rename-device-save"]').click();
    await expect(p.locator('[data-testid="current-device-name"]')).toHaveText('My private browser');
    await expect(p.locator('[data-testid="identity-fingerprint"]')).toHaveText(fingerprintBeforeRename || '');

    // Link-a-device: code + countdown render; close via Done.
    await p.locator('[data-testid="link-a-device-btn"]').click();
    await expect(p.locator('[data-testid="link-device-start-confirm"]')).toContainText('publicly reveal');
    await p.locator('[data-testid="confirm-generate-link-code"]').click();
    await afterNav();
    await expect(p.locator('[data-testid="link-device-code-modal"]')).toBeVisible();
    await expect(p.locator('[data-testid="link-device-copy"]')).toBeFocused();
    await expect(p.locator('[data-testid="link-device-code"]')).not.toBeEmpty();
    await expect(p.locator('#link-device-qr-canvas')).toHaveAttribute('data-rendered', 'true');
    await expect(p.locator('#link-device-countdown')).toContainText(':');
    const shownCode = (await p.locator('[data-testid="link-device-code"]').textContent()) || '';
    const shownPayload = decodePairingCode(shownCode);
    const internalUserId = await p.evaluate(() => localStorage.getItem('iinpublic_user_id'));
    expect(shownPayload?.pub).toContain('.');
    expect(shownPayload?.pub).not.toBe(internalUserId);
    await p.locator('#link-device-done').click();
    await afterNav();
    await expect(p.locator('[data-testid="link-device-code-modal"]')).toHaveCount(0);
    await expect(p.locator('[data-testid="link-a-device-btn"]')).toBeFocused();

    // Enter-code: invalid.
    await p.locator('[data-testid="enter-link-code-btn"]').click();
    await afterNav();
    await expect(p.locator('[data-testid="enter-link-code-input"]')).toBeFocused();
    await p.keyboard.press('Escape');
    await expect(p.locator('[data-testid="enter-link-code-modal"]')).toHaveCount(0);
    await expect(p.locator('[data-testid="enter-link-code-btn"]')).toBeFocused();
    await p.locator('[data-testid="enter-link-code-btn"]').click();
    await p.fill('[data-testid="enter-link-code-input"]', 'garbage!!!');
    await p.locator('[data-testid="enter-link-code-submit"]').click();
    await afterSync();
    await expect(p.locator('[data-testid="enter-link-code-error"]')).not.toBeEmpty();

    // Enter-code: expired.
    const expiredCode = encodePairingCode({
      version: 1,
      requestId: 'expired-request',
      pub: 'other-device-pub',
      secret: 'expired-secret',
      expiresAt: Date.now() - 1000,
    });
    await p.fill('[data-testid="enter-link-code-input"]', expiredCode);
    await p.locator('[data-testid="enter-link-code-submit"]').click();
    await afterSync();
    await expect(p.locator('[data-testid="enter-link-code-error"]')).not.toBeEmpty();

    // Enter-code: valid → the service publishes a one-sided signed attestation.
    // The UI must not call that a verified link before the other side approves.
    const validCode = encodePairingCode({
      version: 1,
      requestId: 'valid-request-id',
      pub: 'other-device-pub',
      secret: 'valid-secret',
      expiresAt: Date.now() + PAIRING_TTL_MS,
    });
    await p.fill('[data-testid="enter-link-code-input"]', validCode);
    await expect(p.locator('[data-testid="enter-link-peer-preview"]')).toContainText('Identity fingerprint');
    await expect(p.locator('[data-testid="enter-link-peer-preview"]')).toContainText('publicly reveal');
    await p.locator('[data-testid="enter-link-code-submit"]').click();
    await afterSync();
    await expect(p.locator('[data-testid="linked-device-row"]')).toHaveCount(1);
    await expect(p.locator('[data-testid="linked-device-row"]')).toContainText('Waiting for approval');

    // Unlink via confirm. The historical row remains honestly marked Removed;
    // it is no longer an active link and cannot be unlinked again.
    await p.locator('[data-testid="linked-device-unlink-btn"]').first().click();
    await afterNav();
    await expect(p.locator('[data-testid="unlink-device-confirm"]')).toBeVisible();
    await p.locator('[data-testid="unlink-confirm-btn"]').click();
    await afterSync();
    await expect(p.locator('[data-testid="linked-device-row"]')).toContainText('Removed');
    await expect(p.locator('[data-testid="linked-device-unlink-btn"]')).toHaveCount(0);

    // Escape closes the page and returns focus to its Settings opener.
    await p.keyboard.press('Escape');
    await expect(p.locator('[data-testid="linked-devices-page"]')).toHaveCount(0);
    await expect(p.locator('[data-testid="settings-linked-devices-btn"]')).toBeFocused();
  });

  test('320px layout has no horizontal overflow and keeps controls reachable', async () => {
    const p = page!;
    await p.setViewportSize({ width: 320, height: 640 });
    await p.locator('[data-testid="settings-linked-devices-btn"]').click();
    await expect(p.locator('[data-testid="linked-devices-page"]')).toBeVisible();

    const pageBox = await p.locator('[data-testid="linked-devices-page"]').boundingBox();
    expect(pageBox?.x).toBe(0);
    expect(pageBox?.width).toBe(320);
    const overflow = await p.locator('[data-testid="linked-devices-page"]').evaluate((element) => ({
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
    await expect(p.locator('[data-testid="linked-devices-close"]')).toBeVisible();
    await p.locator('[data-testid="link-a-device-btn"]').scrollIntoViewIfNeeded();
    await expect(p.locator('[data-testid="link-a-device-btn"]')).toBeVisible();
    await expect(p.locator('[data-testid="enter-link-code-btn"]')).toBeVisible();
  });
});
