/**
 * Native app: the shell must stay responsive right after boot. Regression guard for the
 * foreground-recovery storm that could queue work and make the touch UI feel frozen.
 */
import { test, expect } from '@playwright/test';
import * as os from 'os';
import {
  closeAndroidUser,
  isAndroidDeviceReady,
  launchAndroidUserViaAdb,
  type AndroidUser,
} from './helpers/native-app-android';
import { configuredAndroidDevices } from './helpers/android-device-config';

const HUB_GUN_PORT = Number(process.env.NATIVE_APP_E2E_GUN_PORT || '9078');
const ANDROID_SERIAL = process.env.NATIVE_APP_ANDROID_SERIAL?.trim() || configuredAndroidDevices()[0]?.serial;

function resolveLanIp(): string {
  if (process.env.NATIVE_APP_ANDROID_HOST) return process.env.NATIVE_APP_ANDROID_HOST;
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family === 'IPv4' && !addr.internal) return addr.address;
    }
  }
  throw new Error(
    'Could not auto-detect a LAN IPv4 address for this Mac. Set NATIVE_APP_ANDROID_HOST explicitly.',
  );
}

test.describe('Native app: shell responsiveness after launch', () => {
  let user: AndroidUser | undefined;

  test.afterEach(async () => {
    await closeAndroidUser(user);
    user = undefined;
  });

  test('five bottom tabs and the active top app-bar actions switch immediately', async () => {
    const deviceReady = ANDROID_SERIAL ? await isAndroidDeviceReady(ANDROID_SERIAL) : false;
    test.skip(
      !deviceReady,
      `Configured adb device ${ANDROID_SERIAL || '(none)'} is unavailable — connect it with USB debugging enabled.`,
    );

    const hubGunUrl = `http://${resolveLanIp()}:${HUB_GUN_PORT}/gun`;
    user = await launchAndroidUserViaAdb({ deviceSerial: ANDROID_SERIAL!, hubGunUrl, disableLanDiscovery: true });

    await expect(user.window.locator('#app')).toBeVisible({ timeout: 30_000 });
    await expect(user.window.locator('.nav-btn')).toHaveCount(5, { timeout: 20_000 });

    const bottomViews = ['chatrooms', 'contacts', 'talks', 'me', 'settings'];
    for (const view of bottomViews) {
      const button = user.window.locator(`.nav-btn[data-view="${view}"]`);
      await expect(button).toBeVisible();
      const startedAt = await user.window.evaluate(() => performance.now());
      await button.click();
      await expect(user.window.locator(`.nav-btn[data-view="${view}".active`)).toBeVisible({ timeout: 1_500 });
      const elapsed = await user.window.evaluate(() => performance.now()) - startedAt;
      expect(elapsed).toBeLessThan(1_500);
    }

    // Top app-bar controls must remain responsive immediately after launch. Keep the same
    // priority as the shipped shell: map/list, create talk, DM inbox, and the primary room
    // broadcast action should all react without waiting for the background recovery storm.
    const topSelectors = [
      '#chatroom-map-view-btn',
      '#chatroom-list-view-btn',
      '#create-talk-btn',
      '#dm-inbox-btn',
      '#broadcast-talk-btn',
    ];

    const visibleTopButtons = await Promise.all(topSelectors.map(async (selector) => ({
      selector,
      visible: await user!.window.locator(selector).isVisible().catch(() => false),
    })));
    expect(visibleTopButtons.filter((button) => button.visible)).toHaveLength(topSelectors.length);

    // Use explicit toggles so both map and list states are checked rather than just a single
    // default render path. The shell keeps the selected state in localStorage and the visual
    // flag on the button's aria-pressed state.
    for (const selector of ['#chatroom-map-view-btn', '#chatroom-list-view-btn']) {
      const button = user.window.locator(selector);
      await expect(button).toBeVisible();
      const startedAt = await user.window.evaluate(() => performance.now());
      await button.click();
      await expect(button).toHaveAttribute('aria-pressed', 'true', { timeout: 1_500 });
      const elapsed = await user.window.evaluate(() => performance.now()) - startedAt;
      expect(elapsed).toBeLessThan(1_500);
    }

    for (const selector of ['#create-talk-btn', '#dm-inbox-btn', '#broadcast-talk-btn']) {
      const button = user.window.locator(selector);
      if (!(await button.isVisible().catch(() => false))) continue;
      const startedAt = await user.window.evaluate(() => performance.now());
      await button.click();
      const elapsed = await user.window.evaluate(() => performance.now()) - startedAt;
      expect(elapsed).toBeLessThan(1_500);
    }
  });
});
