/**
 * J-START-04 on a real phone (docs/testing/journey-coverage.md) and OPEN-54: a person who refused
 * location (or was never asked) is not stuck. The app places them as a Traveler ✈, and Settings →
 * "Use my location" asks Android again:
 *   1. Location revoked → after boot, Settings shows "Use my location".
 *   2. Tapping it raises the system location dialog; allowing it grants the permission, the page
 *      hears about it, and the button goes away once a real fix arrives.
 *   3. Refused until Android stops showing the dialog → tapping it opens the app's settings page
 *      instead of doing nothing.
 *
 * Opt-in like the other physical-device specs: E2E_REAL_ANDROID_LOCATION=1. Leaves location
 * granted afterwards (the state the other phone specs expect).
 */
import { expect, test } from '@playwright/test';
import { execFile } from 'child_process';
import * as os from 'os';
import { promisify } from 'util';
import {
  ANDROID_PACKAGE,
  closeAndroidUser,
  isAndroidDeviceReady,
  launchAndroidUserViaAdb,
  type AndroidUser,
} from './helpers/native-app-android';
import { configuredAndroidDevices } from './helpers/android-device-config';
import { afterNav } from '../helpers/timing';
import { openSettingsSection, SETTINGS_SECTION } from '../helpers/settings-nav';

const execFileAsync = promisify(execFile);
const RUN = process.env.E2E_REAL_ANDROID_LOCATION === '1';
const HUB_GUN_PORT = Number(process.env.NATIVE_APP_E2E_GUN_PORT || '9078');
const LOCATION_PERMISSIONS = ['android.permission.ACCESS_FINE_LOCATION', 'android.permission.ACCESS_COARSE_LOCATION'];
const PERMISSION_DIALOG = /GrantPermissionsActivity|permissioncontroller|packageinstaller/i;
const APP_SETTINGS = /com\.android\.settings|InstalledAppDetails|AppInfo/i;
const SERIALS = process.env.NATIVE_APP_ANDROID_SERIAL?.trim()
  ? [process.env.NATIVE_APP_ANDROID_SERIAL.trim()]
  : configuredAndroidDevices().map((d) => d.serial);

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

/** Tap the first on-screen element whose resource-id ends in one of `ids`; false if none shown. */
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

async function revokeLocation(serial: string): Promise<void> {
  for (const permission of LOCATION_PERMISSIONS) {
    await adb(serial, 'shell', 'pm', 'revoke', ANDROID_PACKAGE, permission).catch(() => undefined);
    // Clear an earlier "don't ask again" too, so Android shows the dialog (Android 7 lacks this).
    await adb(serial, 'shell', 'pm', 'clear-permission-flags', ANDROID_PACKAGE, permission, 'user-set', 'user-fixed').catch(() => undefined);
  }
}

async function grantLocation(serial: string): Promise<void> {
  for (const permission of LOCATION_PERMISSIONS) {
    await adb(serial, 'shell', 'pm', 'grant', ANDROID_PACKAGE, permission).catch(() => undefined);
  }
}

async function locationGranted(serial: string): Promise<boolean> {
  const dump = await adb(serial, 'shell', 'dumpsys', 'package', ANDROID_PACKAGE);
  return /android\.permission\.ACCESS_(FINE|COARSE)_LOCATION: granted=true/.test(dump);
}

async function openLocationSettings(user: AndroidUser): Promise<void> {
  if (await user.window.locator('[data-testid="walkthrough-modal"]').isVisible().catch(() => false)) {
    await user.window.locator('[data-testid="walkthrough-close-btn"]').click();
  }
  const picker = user.window.locator('#encounter-location-modal');
  if (await picker.isVisible().catch(() => false)) {
    await user.window.keyboard.press('Escape').catch(() => undefined);
    await picker.locator('button').filter({ hasText: /cancel|close|later/i }).first().click().catch(() => undefined);
  }
  await user.window.locator('.nav-btn[data-view="settings"]').click();
  await afterNav();
  await openSettingsSection(user.window, SETTINGS_SECTION.distanceHome);
}

async function launchWithoutLocation(serial: string): Promise<AndroidUser> {
  await revokeLocation(serial);
  const user = await launchAndroidUserViaAdb({ hubGunUrl: `http://${lanIp()}:${HUB_GUN_PORT}/gun`, deviceSerial: serial });
  await expect(user.window.locator('#app')).toBeVisible({ timeout: 45_000 });
  await user.window.evaluate(() => {
    (window as any).__locationGrantedEvents = 0;
    window.addEventListener('iinpublic-location-granted', () => { (window as any).__locationGrantedEvents += 1; });
  });
  return user;
}

for (const serial of SERIALS) {
  test.describe(`Android location re-ask on ${serial} (J-START-04, OPEN-54)`, () => {
    test.skip(!RUN, 'Set E2E_REAL_ANDROID_LOCATION=1 (debug build installed) to run the physical-device location test.');

    let user: AndroidUser | undefined;
    test.afterEach(async () => {
      await closeAndroidUser(user);
      user = undefined;
      await grantLocation(serial);
    });

    test('refused location → Traveler with "Use my location"; allowing it grants location and a real fix', async () => {
      test.setTimeout(240_000);
      test.skip(!(await isAndroidDeviceReady(serial)), `${serial} unavailable`);
      user = await launchWithoutLocation(serial);
      // The 15 s GPS fallback makes the phone a Traveler; Settings then offers to ask again.
      await expect.poll(() => user!.window.evaluate(() => {
        const app = (window as any).__iinpublic_app?.getApp?.();
        return !!app?.currentUser && !!app?.currentChatroomId;
      }), { timeout: 60_000 }).toBe(true);
      await user.window.waitForTimeout(16_000);
      await openLocationSettings(user);
      const button = user.window.locator('[data-testid="settings-use-my-location"]');
      await expect(button).toBeVisible({ timeout: 30_000 });

      await button.click();
      await expect.poll(() => focusedWindow(serial), { timeout: 20_000, message: 'the location dialog should take focus' })
        .toMatch(PERMISSION_DIALOG);
      const allowed = await tapById(serial, [
        'permission_allow_foreground_only_button',
        'permission_allow_button',
        'permission_allow_one_time_button',
      ]);
      expect(allowed, 'no Allow button on the location dialog').toBe(true);

      await expect.poll(() => locationGranted(serial), { timeout: 15_000 }).toBe(true);
      await expect.poll(() => user!.window.evaluate(() => (window as any).__locationGrantedEvents), { timeout: 15_000 })
        .toBeGreaterThan(0);
      // A real fix turns the Traveler back into a Resident; Settings stops offering the button.
      await expect(button).toHaveCount(0, { timeout: 90_000 });
    });

    test('refused until Android stops asking → "Use my location" opens the app\'s settings page', async () => {
      test.setTimeout(300_000);
      test.skip(!(await isAndroidDeviceReady(serial)), `${serial} unavailable`);
      user = await launchWithoutLocation(serial);
      await user.window.waitForTimeout(16_000);
      await openLocationSettings(user);
      const button = user.window.locator('[data-testid="settings-use-my-location"]');
      await expect(button).toBeVisible({ timeout: 30_000 });

      // Refuse each dialog, choosing "don't ask again" where offered, until Android sends the
      // person to the app's settings page instead.
      let reachedSettings = false;
      for (let attempt = 0; attempt < 4 && !reachedSettings; attempt += 1) {
        await button.click();
        await expect.poll(async () => {
          const focus = await focusedWindow(serial);
          return PERMISSION_DIALOG.test(focus) || APP_SETTINGS.test(focus);
        }, { timeout: 20_000, message: 'tapping "Use my location" did nothing' }).toBe(true);
        if (APP_SETTINGS.test(await focusedWindow(serial))) {
          reachedSettings = true;
          break;
        }
        await tapById(serial, ['do_not_ask_checkbox']);
        const refused = await tapById(serial, ['permission_deny_and_dont_ask_again_button', 'permission_deny_button']);
        expect(refused, 'no Deny button on the location dialog').toBe(true);
        await expect.poll(() => focusedWindow(serial), { timeout: 10_000 }).not.toMatch(PERMISSION_DIALOG);
        // After a refusal that ends the dialogs, the app opens its settings page by itself.
        await user.window.waitForTimeout(1_500);
        if (APP_SETTINGS.test(await focusedWindow(serial))) reachedSettings = true;
      }
      expect(reachedSettings, 'never reached the app settings page').toBe(true);
      expect(await locationGranted(serial)).toBe(false);
      await adb(serial, 'shell', 'input', 'keyevent', 'KEYCODE_BACK');
    });
  });
}
