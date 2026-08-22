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
import { afterNav, afterSync, afterLoad, waitForAppReady } from '../../helpers/timing';
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

    await p.locator('[data-testid="set-identity-password-btn"]').scrollIntoViewIfNeeded();
    await p.locator('[data-testid="set-identity-password-btn"]').click();
    await expect(p.locator('[data-testid="set-identity-password-overlay"]')).toBeVisible();
    const passwordDialogOverflow = await p.locator('[data-testid="set-identity-password-overlay"] .modal-content').evaluate(
      (element) => ({ scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }),
    );
    expect(passwordDialogOverflow.scrollWidth).toBeLessThanOrEqual(passwordDialogOverflow.clientWidth);
    await p.keyboard.press('Escape');
    await expect(p.locator('[data-testid="set-identity-password-overlay"]')).toHaveCount(0);
    await expect(p.locator('[data-testid="set-identity-password-btn"]')).toBeFocused();
  });

  test('password custody preserves identity and gates reload/change/lock lifecycle', async () => {
    const p = page!;
    const observedConsole: string[] = [];
    const observedRequests: string[] = [];
    p.on('console', (message) => observedConsole.push(message.text()));
    p.on('request', (request) => {
      observedRequests.push(`${request.url()}\n${request.postData() || ''}`);
    });
    const originalPub = await p.evaluate(
      () => (window as any).__iinpublic_app?.getApp?.()?.gunService?.getStoredPair?.()?.pub || '',
    );
    expect(originalPub).toContain('.');

    await p.locator('[data-testid="settings-linked-devices-btn"]').click();
    await expect(p.locator('[data-testid="set-identity-password-btn"]')).toBeVisible();
    await p.locator('[data-testid="set-identity-password-btn"]').click();
    await expect(p.locator('[data-testid="set-identity-password"]')).toBeFocused();
    await expect(p.locator('[data-testid="set-identity-password-overlay"]')).toContainText(
      'IinPublic does not store your password or identity on a recovery server',
    );
    await expect(p.locator('[data-testid="set-identity-password-submit"]')).toBeDisabled();
    await p.fill('[data-testid="set-identity-password"]', 'correct horse battery staple');
    await p.fill('[data-testid="confirm-identity-password"]', 'correct horse battery staple');
    await expect(p.locator('[data-testid="set-identity-password-submit"]')).toBeDisabled();
    await p.locator('[data-testid="identity-password-warning-ack"]').check();
    await expect(p.locator('[data-testid="set-identity-password-submit"]')).toBeEnabled();
    await p.locator('[data-testid="set-identity-password-submit"]').click();
    await expect(p.locator('[data-testid="identity-protection-card"]')).toContainText(
      'Identity password: Set',
    );
    const storageAfterSet = await p.evaluate((password) => ({
      passwordFound: Object.values(localStorage).some((value) => String(value).includes(password)),
      rawPair: localStorage.getItem('iinpublic_keypair'),
      legacyCustody: localStorage.getItem('iinpublic_key_custody_v1'),
      legacySecret: localStorage.getItem('iinpublic_key_custody_device_secret_v1'),
    }), 'correct horse battery staple');
    expect(storageAfterSet).toEqual({
      passwordFound: false,
      rawPair: null,
      legacyCustody: null,
      legacySecret: null,
    });

    // The unload boundary drops live identity/auth references synchronously before
    // navigation. The encrypted v2 record remains available for the next unlock.
    await p.evaluate(() => window.dispatchEvent(new Event('beforeunload')));
    await expect
      .poll(() => p.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.gunService?.getStoredPair?.()))
      .toBeNull();

    await p.setViewportSize({ width: 320, height: 640 });
    await p.reload();
    await p.waitForLoadState('load');
    await expect(p.locator('[data-testid="identity-unlock-overlay"]')).toBeVisible();
    await expect(p.locator('[data-testid="identity-unlock-password"]')).toBeFocused();
    const unlockDialogOverflow = await p.locator('[data-testid="identity-unlock-overlay"] .modal-content').evaluate(
      (element) => ({ scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }),
    );
    expect(unlockDialogOverflow.scrollWidth).toBeLessThanOrEqual(unlockDialogOverflow.clientWidth);
    await p.keyboard.press('Escape');
    await expect(p.locator('[data-testid="identity-unlock-overlay"]')).toBeVisible();
    await p.fill('[data-testid="identity-unlock-password"]', 'incorrect password value');
    await p.locator('[data-testid="identity-unlock-submit"]').click();
    await expect(p.locator('[data-testid="identity-unlock-error"]')).toContainText('Could not unlock');
    await p.fill('[data-testid="identity-unlock-password"]', 'correct horse battery staple');
    await p.locator('[data-testid="identity-unlock-submit"]').click();
    await waitForAppReady(p);
    await p.setViewportSize({ width: 1000, height: 1100 });
    await expect
      .poll(() => p.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.gunService?.getStoredPair?.()?.pub || ''))
      .toBe(originalPub);

    await p.locator('.nav-btn[data-view="settings"]').click();
    await openSettingsSection(p, SETTINGS_SECTION.linkedDevices);
    await p.locator('[data-testid="settings-linked-devices-btn"]').click();
    await p.locator('[data-testid="change-identity-password-btn"]').click();
    await p.fill('[data-testid="current-identity-password"]', 'incorrect current password');
    await p.fill('[data-testid="change-new-identity-password"]', 'another strong local password');
    await p.fill('[data-testid="change-confirm-identity-password"]', 'another strong local password');
    await p.locator('[data-testid="change-identity-password-submit"]').click();
    await expect(p.locator('[data-testid="change-identity-password-error"]')).toContainText(
      'Could not change the password',
    );
    await expect(p.locator('[data-testid="current-identity-password"]')).toHaveValue('');
    await expect(p.locator('[data-testid="change-new-identity-password"]')).toHaveValue('');

    await p.fill('[data-testid="current-identity-password"]', 'correct horse battery staple');
    await p.fill('[data-testid="change-new-identity-password"]', 'another strong local password');
    await p.fill('[data-testid="change-confirm-identity-password"]', 'another strong local password');
    await p.locator('[data-testid="change-identity-password-submit"]').click();
    await expect(p.locator('[data-testid="change-identity-password-overlay"]')).toHaveCount(0);

    await Promise.all([
      p.waitForEvent('load'),
      p.locator('[data-testid="lock-identity-now-btn"]').click(),
    ]);
    await expect(p.locator('[data-testid="identity-unlock-overlay"]')).toBeVisible();
    await p.fill('[data-testid="identity-unlock-password"]', 'correct horse battery staple');
    await p.locator('[data-testid="identity-unlock-submit"]').click();
    await expect(p.locator('[data-testid="identity-unlock-error"]')).toContainText('Could not unlock');
    await p.fill('[data-testid="identity-unlock-password"]', 'another strong local password');
    await p.locator('[data-testid="identity-unlock-submit"]').click();
    await waitForAppReady(p);
    await expect
      .poll(() => p.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.gunService?.getStoredPair?.()?.pub || ''))
      .toBe(originalPub);

    const persistedPasswordLeak = await p.evaluate(async (passwords) => {
      const record = await new Promise<unknown>((resolve, reject) => {
        const open = indexedDB.open('iinpublic-identity-custody-v2');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const database = open.result;
          const request = database.transaction('custody', 'readonly').objectStore('custody').get('active');
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            database.close();
            resolve(request.result);
          };
        };
      });
      const persisted = `${JSON.stringify(record)}\n${Object.values(localStorage).join('\n')}`;
      return passwords.some((password) => persisted.includes(password));
    }, ['correct horse battery staple', 'another strong local password']);
    expect(persistedPasswordLeak).toBe(false);
    expect(await p.locator('body').textContent()).not.toContain('correct horse battery staple');
    expect(await p.locator('body').textContent()).not.toContain('another strong local password');
    expect(observedConsole.join('\n')).not.toContain('correct horse battery staple');
    expect(observedConsole.join('\n')).not.toContain('another strong local password');
    expect(observedRequests.join('\n')).not.toContain('correct horse battery staple');
    expect(observedRequests.join('\n')).not.toContain('another strong local password');

    await p.locator('.nav-btn[data-view="settings"]').click();
    await openSettingsSection(p, SETTINGS_SECTION.linkedDevices);
    await p.locator('[data-testid="settings-linked-devices-btn"]').click();
    await p.locator('[data-testid="remove-identity-password-btn"]').click();
    await expect(p.locator('[data-testid="remove-identity-password-warning"]')).toContainText(
      'Browser storage will contain everything needed to unlock it',
    );
    await expect(p.locator('[data-testid="remove-identity-password-submit"]')).toBeDisabled();
    await p.fill('[data-testid="remove-current-identity-password"]', 'incorrect current password');
    await p.locator('[data-testid="remove-identity-password-ack"]').check();
    await p.locator('[data-testid="remove-identity-password-submit"]').click();
    await expect(p.locator('[data-testid="remove-identity-password-error"]')).toContainText(
      'Could not remove the password',
    );
    await expect(p.locator('[data-testid="identity-protection-card"]')).toContainText(
      'Identity password: Set',
    );

    await p.fill('[data-testid="remove-current-identity-password"]', 'another strong local password');
    await p.locator('[data-testid="remove-identity-password-submit"]').click();
    await expect(p.locator('[data-testid="remove-identity-password-overlay"]')).toHaveCount(0);
    await expect(p.locator('[data-testid="identity-protection-card"]')).toContainText(
      'Identity password: Not set',
    );
    const downgradeStorage = await p.evaluate(async () => {
      const active = await new Promise<unknown>((resolve, reject) => {
        const open = indexedDB.open('iinpublic-identity-custody-v2');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const database = open.result;
          const request = database.transaction('custody', 'readonly').objectStore('custody').get('active');
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            database.close();
            resolve(request.result ?? null);
          };
        };
      });
      return {
        active,
        legacyRecord: localStorage.getItem('iinpublic_key_custody_v1'),
        legacySecret: localStorage.getItem('iinpublic_key_custody_device_secret_v1'),
      };
    });
    expect(downgradeStorage.active).toBeNull();
    expect(downgradeStorage.legacyRecord).toContain('webcrypto-device-key-v1');
    expect(downgradeStorage.legacySecret).not.toBeNull();

    await p.reload();
    await waitForAppReady(p);
    await expect(p.locator('[data-testid="identity-unlock-overlay"]')).toHaveCount(0);
    await expect
      .poll(() => p.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.gunService?.getStoredPair?.()?.pub || ''))
      .toBe(originalPub);
  });
});
