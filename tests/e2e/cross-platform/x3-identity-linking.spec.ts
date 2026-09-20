/**
 * X3 — a desktop website and the real Android app exercise the mutual identity-link
 * protocol through the production embedded-node HTTP relay.
 *
 * Opt-in because this clears the selected phone's IinPublic app data. Run through
 * `npm run test:e2e:x3-android`, which checks ADB availability before building, installs
 * the APK with a bounded timeout, and supplies the selected serial.
 */
import type { Page } from '@playwright/test';
import * as os from 'os';
import { test, expect } from '../helpers/fixtures';
import { clearGunForStage2Spec } from '../helpers/e2e-stage-pipeline';
import { gunPort, webBaseURL } from '../helpers/ports';
import { afterNav } from '../helpers/timing';
import { openSettingsSection, SETTINGS_SECTION } from '../helpers/settings-nav';
import {
  bootstrapBrowserUserOnOrigin,
  bootstrapNativeWindow,
} from '../native-app/helpers/native-app';
import {
  clearAndroidE2ETestProjections,
  closeAndroidUser,
  collectAndroidDiagnostics,
  isAndroidDeviceReady,
  launchAndroidUserViaAdb,
  type AndroidUser,
} from '../native-app/helpers/native-app-android';
import { configuredAndroidDevices } from '../native-app/helpers/android-device-config';

const RUN = process.env.E2E_REAL_ANDROID_X3_LINKING === '1';
const ANDROID_SERIAL = process.env.NATIVE_APP_ANDROID_SERIAL?.trim()
  || configuredAndroidDevices()[0]?.serial
  || '';

function resolveLanIp(): string {
  if (process.env.NATIVE_APP_ANDROID_HOST) return process.env.NATIVE_APP_ANDROID_HOST;
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) return address.address;
    }
  }
  throw new Error('No LAN IPv4 address found; set NATIVE_APP_ANDROID_HOST.');
}

async function openIdentityDevices(page: Page): Promise<void> {
  await page.locator('.nav-btn[data-view="settings"]').click();
  await afterNav();
  await openSettingsSection(page, SETTINGS_SECTION.linkedDevices);
  await page.locator('[data-testid="settings-linked-devices-btn"]').click();
  await expect(page.locator('[data-testid="linked-devices-page"]')).toBeVisible({ timeout: 20_000 });
}

async function readSeaPub(page: Page): Promise<string> {
  return page.evaluate(() => String(
    (window as any).__iinpublic_app?.getApp?.()?.gunService?.getStoredPair?.()?.pub || '',
  ));
}

async function isDirectlyLinked(page: Page, peerPub: string): Promise<boolean> {
  return page.evaluate(
    (pub) => (window as any).__iinpublic_app.getApp().identityLinkService.isLinked(pub),
    peerPub,
  );
}

async function enterLinkCode(page: Page, code: string): Promise<void> {
  await page.locator('[data-testid="enter-link-code-btn"]').click();
  await page.locator('[data-testid="enter-link-code-input"]').fill(code);
  await expect(page.locator('[data-testid="enter-link-peer-preview"]')).toContainText('publicly reveal');
  await page.locator('[data-testid="enter-link-code-submit"]').click();
  await expect(page.locator('[data-testid="linked-device-row"]')).toContainText(
    'Waiting for approval',
    { timeout: 30_000 },
  );
}

async function generateLinkCode(page: Page): Promise<string> {
  await page.locator('[data-testid="link-a-device-btn"]').click();
  await expect(page.locator('[data-testid="link-device-start-confirm"]')).toContainText('publicly reveal');
  await page.locator('[data-testid="confirm-generate-link-code"]').click();
  const code = (await page.locator('[data-testid="link-device-code"]').textContent()) || '';
  expect(code).not.toBe('');
  return code;
}

async function approveLinkRequest(page: Page): Promise<void> {
  const check = page.locator('[data-testid="link-device-check-request"]');
  await expect(check).toBeVisible();
  for (let attempt = 0; attempt < 18; attempt += 1) {
    await check.click();
    const approve = page.locator('[data-testid="approve-link-request"]');
    await expect.poll(async () =>
      (await approve.isVisible().catch(() => false)) || (await check.isEnabled().catch(() => false)),
    { timeout: 10_000 }).toBe(true);
    if (await approve.isVisible().catch(() => false)) break;
    await page.waitForTimeout(1_000);
  }
  await expect(page.locator('[data-testid="approve-link-request"]')).toBeVisible({ timeout: 20_000 });
  await page.locator('[data-testid="approve-link-request"]').click();
  await expect(page.locator('[data-testid="link-device-code-modal"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="linked-device-row"]')).toContainText('Linked', { timeout: 30_000 });
}

async function refreshUntilState(page: Page, state: string): Promise<void> {
  await expect.poll(async () => {
    await page.locator('[data-testid="refresh-linked-devices"]').click();
    return (await page.locator('[data-testid="linked-device-row"]').textContent()) || '';
  }, { timeout: 60_000, intervals: [1_000, 2_000] }).toContain(state);
}

test.describe('X3: website ↔ physical Android identity linking', () => {
  test.skip(!RUN, 'Run with npm run test:e2e:x3-android (destructively clears the selected app profile).');
  test.skip(!ANDROID_SERIAL, 'Set NATIVE_APP_ANDROID_SERIAL or configure tests/matrix/devices.json.');

  let android: AndroidUser | undefined;
  let website: Awaited<ReturnType<typeof bootstrapBrowserUserOnOrigin>> | undefined;

  test.beforeEach(async () => {
    await clearGunForStage2Spec();
  });

  test.afterEach(async ({}, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus && ANDROID_SERIAL) {
      const diagnostics = await collectAndroidDiagnostics(ANDROID_SERIAL);
      await testInfo.attach('android-logcat.txt', {
        body: Buffer.from(diagnostics.logcat),
        contentType: 'text/plain',
      });
      await testInfo.attach('android-node-stdio.txt', {
        body: Buffer.from(diagnostics.nodeStdio),
        contentType: 'text/plain',
      });
    }
    if (android) await clearAndroidE2ETestProjections(android).catch(() => {});
    await closeAndroidUser(android);
    android = undefined;
    await website?.close().catch(() => {});
    website = undefined;
    await clearGunForStage2Spec().catch(() => {});
  });

  test('a cancelled website code leaves the Android request one-sided and untrusted', async ({ browser }) => {
    test.setTimeout(300_000);
    test.skip(
      !(await isAndroidDeviceReady(ANDROID_SERIAL)),
      `Android device ${ANDROID_SERIAL} is not connected and authorized via adb.`,
    );

    website = await bootstrapBrowserUserOnOrigin(
      browser,
      webBaseURL(),
      'X3 Website Cancel',
      'X3 Website Cancel',
      { waitForSupportGreeting: false },
    );
    android = await launchAndroidUserViaAdb({
      deviceSerial: ANDROID_SERIAL,
      hubGunUrl: `http://${resolveLanIp()}:${gunPort()}/gun`,
      resetAppData: true,
      disableLanDiscovery: true,
    });
    await bootstrapNativeWindow(android.window, 'X3 Android Cancel', {
      waitForSupportGreeting: false,
      readinessTimeoutMs: 110_000,
      pinStableLocation: false,
    });

    const websitePub = await readSeaPub(website.page);
    const androidPub = await readSeaPub(android.window);
    expect(websitePub).not.toBe('');
    expect(androidPub).not.toBe('');
    expect(androidPub).not.toBe(websitePub);

    await Promise.all([openIdentityDevices(website.page), openIdentityDevices(android.window)]);
    const cancelledCode = await generateLinkCode(website.page);
    await website.page.locator('#link-device-done').click();
    await expect(website.page.locator('[data-testid="link-device-code-modal"]')).toHaveCount(0);

    await enterLinkCode(android.window, cancelledCode);
    await expect.poll(() => isDirectlyLinked(website!.page, androidPub), { timeout: 20_000 }).toBe(false);
    await expect.poll(() => isDirectlyLinked(android!.window, websitePub), { timeout: 20_000 }).toBe(false);
    await expect(website.page.locator('[data-testid="linked-devices-empty"]')).toBeVisible();
    expect(await readSeaPub(website.page)).toBe(websitePub);
    expect(await readSeaPub(android.window)).toBe(androidPub);
  });

  test('links durably across Android restart, rejects replay, and converges after unlink', async ({ browser }) => {
    test.setTimeout(600_000);
    test.skip(
      !(await isAndroidDeviceReady(ANDROID_SERIAL)),
      `Android device ${ANDROID_SERIAL} is not connected and authorized via adb.`,
    );

    website = await bootstrapBrowserUserOnOrigin(
      browser,
      webBaseURL(),
      'X3 Website',
      'X3 Website',
      { waitForSupportGreeting: false },
    );
    const lanHubUrl = `http://${resolveLanIp()}:${gunPort()}/gun`;
    android = await launchAndroidUserViaAdb({
      deviceSerial: ANDROID_SERIAL,
      hubGunUrl: lanHubUrl,
      resetAppData: true,
      disableLanDiscovery: true,
    });
    await bootstrapNativeWindow(android.window, 'X3 Android', {
      waitForSupportGreeting: false,
      readinessTimeoutMs: 110_000,
      pinStableLocation: false,
    });

    const websitePub = await readSeaPub(website.page);
    const androidPub = await readSeaPub(android.window);
    expect(websitePub).not.toBe('');
    expect(androidPub).not.toBe('');
    expect(androidPub).not.toBe(websitePub);

    await Promise.all([openIdentityDevices(website.page), openIdentityDevices(android.window)]);
    const code = await generateLinkCode(website.page);
    await enterLinkCode(android.window, code);
    await approveLinkRequest(website.page);
    await refreshUntilState(android.window, 'Linked');
    await expect.poll(() => isDirectlyLinked(website!.page, androidPub), { timeout: 30_000 }).toBe(true);
    await expect.poll(() => isDirectlyLinked(android!.window, websitePub), { timeout: 30_000 }).toBe(true);

    await android.window.locator('[data-testid="enter-link-code-btn"]').click();
    await android.window.locator('[data-testid="enter-link-code-input"]').fill(code);
    await android.window.locator('[data-testid="enter-link-code-submit"]').click();
    await expect(android.window.locator('[data-testid="enter-link-code-error"]')).toContainText('already linked');
    await android.window.locator('#enter-link-code-cancel').click();

    await closeAndroidUser(android);
    android = undefined;
    android = await launchAndroidUserViaAdb({
      deviceSerial: ANDROID_SERIAL,
      hubGunUrl: lanHubUrl,
      resetAppData: false,
      disableLanDiscovery: true,
    });
    await bootstrapNativeWindow(android.window, 'X3 Android', {
      waitForSupportGreeting: false,
      readinessTimeoutMs: 110_000,
      pinStableLocation: false,
      updateStageName: false,
    });
    expect(await readSeaPub(android.window)).toBe(androidPub);
    expect(await readSeaPub(website.page)).toBe(websitePub);
    await openIdentityDevices(android.window);
    await refreshUntilState(android.window, 'Linked');
    await expect.poll(() => isDirectlyLinked(android!.window, websitePub), { timeout: 30_000 }).toBe(true);

    await website.page.locator('[data-testid="linked-device-unlink-btn"]').click();
    await website.page.locator('[data-testid="unlink-confirm-btn"]').click();
    await expect(website.page.locator('[data-testid="linked-device-row"]')).toContainText('Removed', { timeout: 30_000 });
    await refreshUntilState(android.window, 'Removed');
    await expect.poll(() => isDirectlyLinked(website!.page, androidPub), { timeout: 30_000 }).toBe(false);
    await expect.poll(() => isDirectlyLinked(android!.window, websitePub), { timeout: 30_000 }).toBe(false);
    expect(await readSeaPub(website.page)).toBe(websitePub);
    expect(await readSeaPub(android.window)).toBe(androidPub);
  });
});
