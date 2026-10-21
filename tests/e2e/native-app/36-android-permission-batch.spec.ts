/**
 * Runtime permissions are asked ONCE, together, at first launch, and never again by the app itself:
 *   1. Fresh install (app data cleared, no permission flags) → the system dialogs come back to
 *      back before the app loads: notifications (Android 13+), location, Nearby devices (Android
 *      12+; location covers it before that). Camera is not among them (asked on the first scan).
 *   2. Relaunch → no permission dialog.
 *   3. Settings → App permissions shows what Android allows, and its button opens the app's
 *      system settings page.
 *
 * Opt-in like the other physical-device specs: E2E_REAL_ANDROID_PERMISSIONS=1. Clears the app's
 * data on each phone it runs on.
 */
import { expect, test } from '@playwright/test';
import { execFile } from 'child_process';
import * as os from 'os';
import { promisify } from 'util';
import {
  ANDROID_MAIN_ACTIVITY,
  ANDROID_PACKAGE,
  closeAndroidUser,
  isAndroidDeviceReady,
  launchAndroidUserViaAdb,
  resetAndroidAppData,
  type AndroidUser,
} from './helpers/native-app-android';
import { resolveAndroidMatrixDevices } from './helpers/android-device-config';
import { afterNav } from '../helpers/timing';
import { openSettingsSection } from '../helpers/settings-nav';

const execFileAsync = promisify(execFile);
const RUN = process.env.E2E_REAL_ANDROID_PERMISSIONS === '1';
const HUB_GUN_PORT = Number(process.env.NATIVE_APP_E2E_GUN_PORT || '9078');
const PERMISSION_DIALOG = /GrantPermissionsActivity|permissioncontroller|packageinstaller/i;
const APP_SETTINGS = /com\.android\.settings|InstalledAppDetails|AppInfo|AppDetails/i;
const ALLOW_IDS = ['permission_allow_foreground_only_button', 'permission_allow_button', 'permission_allow_one_time_button'];
const RUNTIME_PERMISSIONS = [
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.NEARBY_WIFI_DEVICES',
  'android.permission.BLUETOOTH_SCAN',
  'android.permission.BLUETOOTH_ADVERTISE',
  'android.permission.BLUETOOTH_CONNECT',
  'android.permission.CAMERA',
];
const SERIALS = process.env.NATIVE_APP_ANDROID_SERIAL?.trim()
  ? [process.env.NATIVE_APP_ANDROID_SERIAL.trim()]
  : resolveAndroidMatrixDevices(process.env.NATIVE_APP_ANDROID_SERIALS || '').map((d) => d.serial);

function lanIp(): string {
  if (process.env.NATIVE_APP_ANDROID_HOST) return process.env.NATIVE_APP_ANDROID_HOST;
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) if (a.family === 'IPv4' && !a.internal) return a.address;
  }
  throw new Error('Set NATIVE_APP_ANDROID_HOST');
}

async function adb(serial: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('adb', ['-s', serial, ...args], { timeout: 15_000 });
  return stdout;
}

async function focusedWindow(serial: string): Promise<string> {
  const dump = await adb(serial, 'shell', 'dumpsys', 'window');
  const lines = dump.split('\n').filter((l) => /mCurrentFocus=/.test(l));
  return (lines.find((l) => !/mCurrentFocus=null/.test(l)) ?? lines[0] ?? '').trim();
}

async function dialogMessage(serial: string): Promise<string> {
  await adb(serial, 'shell', 'uiautomator', 'dump', '/sdcard/iinpublic-ui.xml');
  const xml = await adb(serial, 'shell', 'cat', '/sdcard/iinpublic-ui.xml');
  return xml.match(/resource-id="[^"]*:id\/permission_message"[^>]*/)?.[0] ?? xml.match(/text="Allow [^"]*"/)?.[0] ?? '';
}

async function tapById(serial: string, ids: string[]): Promise<boolean> {
  await adb(serial, 'shell', 'uiautomator', 'dump', '/sdcard/iinpublic-ui.xml');
  const xml = await adb(serial, 'shell', 'cat', '/sdcard/iinpublic-ui.xml');
  for (const id of ids) {
    const match = xml.match(new RegExp(`resource-id="[^"]*:id/${id}"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`));
    if (!match) continue;
    const [x1, y1, x2, y2] = match.slice(1).map(Number);
    await adb(serial, 'shell', 'input', 'tap', String(Math.round((x1 + x2) / 2)), String(Math.round((y1 + y2) / 2)));
    return true;
  }
  return false;
}

/** Dialogs the batch should show on this SDK (Android merges FINE+COARSE and the Bluetooth trio). */
function expectedDialogs(sdk: number): number {
  if (sdk >= 33) return 3; // notifications, location, Nearby devices
  if (sdk >= 31) return 2; // location, Nearby devices (notifications are install-time)
  return 1; // location (also covers Wi-Fi Direct; Bluetooth is install-time)
}

/** Launch the way a person does (no automation extras) and answer every dialog with Allow. */
async function firstLaunchAllowingAll(serial: string): Promise<number> {
  await adb(serial, 'shell', 'am', 'start', '-n', ANDROID_MAIN_ACTIVITY, '--es', 'hub_gun_url', `http://${lanIp()}:${HUB_GUN_PORT}/gun`);
  let dialogs = 0;
  const quietUntil = (): number => Date.now() + 8_000;
  let deadline = quietUntil();
  while (Date.now() < deadline) {
    if (PERMISSION_DIALOG.test(await focusedWindow(serial).catch(() => ''))) {
      const message = await dialogMessage(serial);
      expect(await tapById(serial, ALLOW_IDS), 'no Allow button on a permission dialog').toBe(true);
      dialogs += 1;
      // A slow phone (Android 7) keeps the answered dialog on screen for a moment: count the next
      // one only once this one has gone or another question replaced it.
      await expect.poll(async () => !PERMISSION_DIALOG.test(await focusedWindow(serial).catch(() => ''))
        || (await dialogMessage(serial)) !== message, { timeout: 10_000 }).toBe(true);
      deadline = quietUntil();
    } else {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  return dialogs;
}

for (const serial of SERIALS) {
  test.describe(`Android permissions asked once at first launch on ${serial}`, () => {
    test.skip(!RUN, 'Set E2E_REAL_ANDROID_PERMISSIONS=1 (debug build installed) to run the physical-device permission test.');

    let user: AndroidUser | undefined;
    test.afterEach(async () => {
      await closeAndroidUser(user);
      user = undefined;
    });

    test('one batch on first launch, none after, and Settings shows them', async () => {
      test.setTimeout(240_000);
      test.skip(!(await isAndroidDeviceReady(serial)), `${serial} unavailable`);
      const sdk = Number((await adb(serial, 'shell', 'getprop', 'ro.build.version.sdk')).trim());
      await adb(serial, 'shell', 'input', 'keyevent', 'KEYCODE_WAKEUP').catch(() => '');
      await adb(serial, 'shell', 'wm', 'dismiss-keyguard').catch(() => '');
      // This spec tests the permission dialogs themselves: nothing may be granted beforehand.
      await resetAndroidAppData(serial, { grantLocation: false });
      for (const permission of RUNTIME_PERMISSIONS) {
        await adb(serial, 'shell', 'pm', 'clear-permission-flags', ANDROID_PACKAGE, permission, 'user-set', 'user-fixed').catch(() => '');
      }

      expect(await firstLaunchAllowingAll(serial), 'permission dialogs on first launch').toBe(expectedDialogs(sdk));

      await adb(serial, 'shell', 'am', 'force-stop', ANDROID_PACKAGE);
      expect(await firstLaunchAllowingAll(serial), 'permission dialogs on the second launch').toBe(0);

      user = await launchAndroidUserViaAdb({ hubGunUrl: `http://${lanIp()}:${HUB_GUN_PORT}/gun`, deviceSerial: serial });
      await expect(user.window.locator('#app')).toBeVisible({ timeout: 45_000 });
      if (await user.window.locator('[data-testid="walkthrough-modal"]').isVisible().catch(() => false)) {
        await user.window.locator('[data-testid="walkthrough-close-btn"]').click();
      }
      await user.window.locator('.nav-btn[data-view="settings"]').click();
      await afterNav();
      await openSettingsSection(user.window, 'settings-section-app-permissions');
      for (const key of ['notifications', 'location', 'nearby']) {
        await expect(user.window.locator(`[data-testid="app-permission-${key}"]`), key).toHaveAttribute('data-allowed', 'true');
      }
      await expect(user.window.locator('[data-testid="app-permission-camera"]')).toHaveAttribute('data-allowed', 'false');

      await user.window.locator('[data-testid="settings-app-permissions-open"]').click();
      await expect.poll(() => focusedWindow(serial), { timeout: 15_000, message: "the app's system settings page should open" })
        .toMatch(APP_SETTINGS);
      await adb(serial, 'shell', 'input', 'keyevent', 'KEYCODE_BACK');
    });
  });
}
