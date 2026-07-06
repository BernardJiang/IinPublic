import { chromium, type Browser } from '@playwright/test';
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  bootstrapBrowserUserOnOrigin,
  bootstrapNativeWindow,
  forceJoinGlobal,
  launchNativeUser,
  readGlobalMembersFromHub,
  type NativeUser,
} from './helpers/native-app';

const HUB_GUN_PORT = Number(process.env.NATIVE_APP_E2E_GUN_PORT || '9078');
const WEB_PORT = HUB_GUN_PORT - 8080 + 3001;
const APP_PORT = 19111;

test.describe('Native app: browser + Electron app shared hub presence', () => {
  let browser: Browser | undefined;
  let native: NativeUser | undefined;
  let closeBrowserUser: (() => Promise<void>) | undefined;
  let userDataDir = '';

  test.afterEach(async () => {
    await closeBrowserUser?.().catch(() => {});
    closeBrowserUser = undefined;
    await browser?.close().catch(() => {});
    browser = undefined;
    await native?.app.close().catch(() => {});
    native = undefined;
    if (userDataDir) fs.rmSync(userDataDir, { recursive: true, force: true });
  });

  test('browser user and desktop app user appear together in Global through the shared hub', async () => {
    browser = await chromium.launch({ headless: true });
    const browserUser = await bootstrapBrowserUserOnOrigin(
      browser,
      `http://127.0.0.1:${WEB_PORT}`,
      'Native browser peer',
      'NativeBrowser',
      { waitForSupportGreeting: false },
    );
    closeBrowserUser = browserUser.close;

    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iinpublic-native-e2e-'));
    native = await launchNativeUser({
      localPort: APP_PORT,
      hubGunUrl: `http://127.0.0.1:${HUB_GUN_PORT}/gun`,
      userDataDir,
    });
    const appUserId = await bootstrapNativeWindow(native.window, 'NativeDesktop', { waitForSupportGreeting: false });
    expect(appUserId).toBeTruthy();
    expect(appUserId).not.toBe(browserUser.userId);

    await forceJoinGlobal(browserUser.page);
    await forceJoinGlobal(native.window);

    await expect
      .poll(
        async () => {
          const names = (await readGlobalMembersFromHub(HUB_GUN_PORT)).map((member) => member.stageName);
          return {
            browser: names.includes('NativeBrowser'),
            desktop: names.includes('NativeDesktop'),
          };
        },
        { timeout: 30_000, intervals: [1000, 1500, 2000] },
      )
      .toEqual({ browser: true, desktop: true });

    await expect(native.window.locator('body')).toContainText('NativeBrowser', { timeout: 30_000 });

    await expect(browserUser.page.locator('body')).toContainText('NativeDesktop', { timeout: 30_000 });
  });
});
