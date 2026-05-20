import { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear } from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { afterNav, afterSync } from '../../helpers/timing';
import { gunBaseURL, webBaseURL } from '../../helpers/ports';

test.describe('P2P roadmap P3 — SEA key custody and relay storage boundaries', () => {
  let context: BrowserContext | undefined;
  let page: Page | undefined;

  test.beforeEach(async ({ browser }) => {
    await clearGunForStage1Spec();
    context = await browser.newContext();
    page = await context.newPage();
    await injectIdbClear(page);
    await page.goto(webBaseURL());
    await page.waitForLoadState('load');
    await afterSync();
  });

  test.afterEach(async () => {
    await page?.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
    await context?.close().catch(() => {});
    await clearGunForStage1Spec();
  });

  test('browser stores encrypted key custody while relay exposes only public identity policy', async ({ request }) => {
    const p = page!;
    const custody = await p.evaluate(() => {
      const rawPair = localStorage.getItem('iinpublic_keypair');
      const rawCustody = localStorage.getItem('iinpublic_key_custody_v1');
      const deviceSecret = localStorage.getItem('iinpublic_key_custody_device_secret_v1');
      return {
        rawPair,
        rawCustody,
        deviceSecret,
        custody: rawCustody ? JSON.parse(rawCustody) : null,
      };
    });

    expect(custody.rawPair).toBeNull();
    expect(custody.deviceSecret).toBeTruthy();
    expect(custody.rawCustody).toBeTruthy();
    expect(custody.rawCustody).not.toContain('"priv"');
    expect(custody.rawCustody).not.toContain('"epriv"');
    expect(custody.custody).toEqual(
      expect.objectContaining({
        version: 1,
        format: 'webcrypto-device-key-v1',
        publicIdentity: expect.objectContaining({
          pub: expect.any(String),
          epub: expect.any(String),
        }),
        ciphertext: expect.any(String),
      }),
    );

    const storage = await request.get(`${gunBaseURL()}/api/debug/storage`);
    expect(storage.ok()).toBeTruthy();
    const payload = await storage.json();
    expect(payload.seaIdentityPolicy.publicKeys).toEqual(['pub', 'epub']);
    expect(payload.seaIdentityPolicy.forbiddenPrivateKeys).toEqual(['priv', 'epriv']);
    expect(payload.seaIdentityPolicy.linkedDeviceRule).toContain('random encrypted manifests');
    expect(payload.seaStorageScan).toEqual(
      expect.objectContaining({
        ok: true,
        privateKeyPaths: [],
        plaintextMessagePaths: [],
      }),
    );

    await p.locator('.nav-btn[data-view="settings"]').click();
    await afterNav();
    await expect(p.locator('#storage-inspector-sea-identity')).toBeVisible();
    await expect(p.locator('#storage-inspector-sea-identity')).toContainText('SEA Identity Custody');
    await expect(p.locator('#storage-inspector-sea-identity')).toContainText('Relay scan');
    await expect(p.locator('#storage-inspector-sea-custody')).toContainText('webcrypto-device-key-v1');
  });
});
