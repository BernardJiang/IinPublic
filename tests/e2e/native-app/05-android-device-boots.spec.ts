/**
 * Native app: Android device boot (real hardware or emulator, over adb).
 *
 * Unlike every other native-app spec (Electron, desktop-only, same machine as the test
 * runner), a phone is a physically separate machine — adb over USB is only the automation
 * control channel (Playwright <-> device), NOT how the app itself reaches the hub. The
 * app's own network traffic goes over Wi-Fi/LAN, so hubGunUrl below must be this Mac's
 * real LAN IP, never 127.0.0.1 — a phone cannot reach the Mac's own loopback address.
 * Phone and Mac must be on the same network (separately from the USB debugging link).
 *
 * Skips itself (does not fail) when no adb device is attached, so it's safe to leave in
 * the default native-app suite run — a machine with no phone plugged in just sees it
 * skipped, same idea as the existing `test.skip` gates elsewhere in this repo for
 * hardware/credential-dependent specs.
 *
 * One-time setup, per docs/testing/manual-platform-test-plan.md's Android section:
 *   1. On the phone: Settings -> About phone -> tap "Build number" 7x to unlock Developer
 *      options, then Settings -> Developer options -> enable "USB debugging"
 *   2. Plug the phone into this Mac via USB, accept the "Allow USB debugging?" prompt that
 *      appears on the phone
 *   3. `adb devices` should list it as "device" (not "unauthorized" — if so, check the
 *      phone for a stuck permission dialog and re-accept it)
 *   4. Build + install the debug APK: `npm run android:build && npm run android:install`
 *
 * Companion doc: tests/e2e/native-app/05-android-device-boots.md
 */
import { test, expect, _android as android } from '@playwright/test';
import * as os from 'os';
import { launchAndroidUser, closeAndroidUser, type AndroidUser } from './helpers/native-app-android';

const HUB_GUN_PORT = Number(process.env.NATIVE_APP_E2E_GUN_PORT || '9078');
const ANDROID_SERIAL = process.env.NATIVE_APP_ANDROID_SERIAL?.trim() || undefined;

function resolveLanIp(): string {
  if (process.env.NATIVE_APP_ANDROID_HOST) return process.env.NATIVE_APP_ANDROID_HOST;
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family === 'IPv4' && !addr.internal) return addr.address;
    }
  }
  throw new Error(
    'Could not auto-detect a LAN IPv4 address for this Mac. Set NATIVE_APP_ANDROID_HOST ' +
      'explicitly (e.g. NATIVE_APP_ANDROID_HOST=192.168.10.50) and re-run.',
  );
}

test.describe('Native app: Android device boot', () => {
  let user: AndroidUser | undefined;

  test.afterEach(async () => {
    await closeAndroidUser(user);
    user = undefined;
  });

  test('boots on a real device and serves the embedded SPA', async () => {
    const devices = await android.devices().catch(() => []);
    test.skip(
      devices.length === 0,
      'No adb device attached — connect a phone with USB debugging enabled (see this ' +
        'file\'s header comment) so `adb devices` lists it, then re-run.',
    );

    const hubGunUrl = `http://${resolveLanIp()}:${HUB_GUN_PORT}/gun`;
    user = await launchAndroidUser({ hubGunUrl, ...(ANDROID_SERIAL ? { deviceSerial: ANDROID_SERIAL } : {}) });

    await expect(user.window.locator('#chatroom-list')).toContainText('Global', { timeout: 5_000 });
    await expect(user.window.locator('body')).not.toContainText('Connecting to IinPublic network...', {
      timeout: 45_000,
    });
    await expect(user.window.locator('#app')).toBeVisible();
  });
});
