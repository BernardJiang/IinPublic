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

async function readCurrentPublicUser(page: { evaluate: <T>(fn: () => T | Promise<T>) => Promise<T> }): Promise<Record<string, unknown>> {
  return page.evaluate(() => {
    const app = (window as any).__iinpublic_app?.getApp?.();
    const user = app?.currentUser || {};
    const pair = app?.gunService?.getStoredPair?.();
    return {
      ...user,
      ...(pair?.pub ? { pub: pair.pub } : {}),
      ...(pair?.epub ? { epub: pair.epub } : {}),
    };
  });
}

async function publishPublicUserToHub(user: Record<string, unknown>): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3_000);
  try {
    await fetch(`http://127.0.0.1:${HUB_GUN_PORT}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(user),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

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
    await publishPublicUserToHub(await readCurrentPublicUser(browserUser.page));
    await publishPublicUserToHub(await readCurrentPublicUser(native.window));

    await expect
      .poll(
        async () => {
          const userIds = (await readGlobalMembersFromHub(HUB_GUN_PORT)).map((member) => member.userId);
          return {
            browser: userIds.includes(browserUser.userId),
            desktop: userIds.includes(appUserId),
          };
        },
        { timeout: 30_000, intervals: [1000, 1500, 2000] },
      )
      .toEqual({ browser: true, desktop: true });

    await expect
      .poll(
        () =>
          native!.window.evaluate(
            (uid) =>
              (window as any).__iinpublic_app
                ?.getApp?.()
                ?.uiManager?.getCurrentChatroomMembers?.()
                ?.some((member: { userId?: string }) => member.userId === uid) === true,
            browserUser.userId,
          ),
        { timeout: 30_000, intervals: [1000, 1500, 2000] },
      )
      .toBe(true);

    await expect
      .poll(
        () =>
          browserUser.page.evaluate(
            (uid) =>
              (window as any).__iinpublic_app
                ?.getApp?.()
                ?.uiManager?.getCurrentChatroomMembers?.()
                ?.some((member: { userId?: string }) => member.userId === uid) === true,
            appUserId,
          ),
        { timeout: 30_000, intervals: [1000, 1500, 2000] },
      )
      .toBe(true);
  });

  test('browser user and desktop app user resolve public identities through explicit relay', async () => {
    browser = await chromium.launch({ headless: true });
    const browserUser = await bootstrapBrowserUserOnOrigin(
      browser,
      `http://127.0.0.1:${WEB_PORT}`,
      'Relay DM browser peer',
      'RelayBrowser',
      { waitForSupportGreeting: false },
    );
    closeBrowserUser = browserUser.close;

    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iinpublic-native-e2e-'));
    native = await launchNativeUser({
      localPort: APP_PORT,
      hubGunUrl: `http://127.0.0.1:${HUB_GUN_PORT}/gun`,
      userDataDir,
    });
    const appUserId = await bootstrapNativeWindow(native.window, 'RelayDesktop', { waitForSupportGreeting: false });
    expect(appUserId).toBeTruthy();
    expect(appUserId).not.toBe(browserUser.userId);

    await forceJoinGlobal(browserUser.page);
    await forceJoinGlobal(native.window);
    await publishPublicUserToHub(await readCurrentPublicUser(browserUser.page));
    await publishPublicUserToHub(await readCurrentPublicUser(native.window));

    await expect
      .poll(
        async () => {
          const [browserSeesNative, nativeSeesBrowser] = await Promise.all([
            browserUser.page.evaluate(async (uid) => {
              const app = (window as any).__iinpublic_app?.getApp?.();
              const user = await app?.gunService?.getPublicUser?.(uid).catch(() => null);
              return !!user?.pub && !!user?.epub;
            }, appUserId),
            native.window.evaluate(async (uid) => {
              const app = (window as any).__iinpublic_app?.getApp?.();
              const user = await app?.gunService?.getPublicUser?.(uid).catch(() => null);
              return !!user?.pub && !!user?.epub;
            }, browserUser.userId),
          ]);
          return { browserSeesNative, nativeSeesBrowser };
        },
        { timeout: 45_000, intervals: [1000, 1500, 2000] },
      )
      .toEqual({ browserSeesNative: true, nativeSeesBrowser: true });
  });
});
