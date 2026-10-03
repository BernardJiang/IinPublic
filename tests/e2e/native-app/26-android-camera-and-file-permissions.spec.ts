/**
 * Android WebView device permissions (camera / file picker).
 *
 * Regression for 1.0.54: the app declared no CAMERA permission and its WebView had no
 * WebChromeClient, so on a real phone "Take photo" (Settings -> Profile) always failed with
 * "Camera access was denied", Android showed no Camera toggle under Settings -> Apps -> IinPublic,
 * and "Choose photo" never opened a picker.
 *
 * Per configured phone (a DEBUG build must be installed — this attaches to the WebView over CDP
 * exactly like the other Android specs, see README.md):
 *   1. The installed package requests android.permission.CAMERA and does not request RECORD_AUDIO.
 *   2. With Camera revoked, getUserMedia raises the SYSTEM permission dialog (it used to be denied
 *      silently with no dialog); dismissing it rejects with NotAllowedError, the exact failure the
 *      Settings screen turns into "Camera access was denied".
 *   3. With Camera granted, getUserMedia returns a live video track.
 *   4. The Settings "Choose photo" button opens the system file picker (leaves the app's window).
 *
 * Opt-in like the other physical-device specs: E2E_REAL_ANDROID_CAMERA=1.
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
const RUN = process.env.E2E_REAL_ANDROID_CAMERA === '1';
const HUB_GUN_PORT = Number(process.env.NATIVE_APP_E2E_GUN_PORT || '9078');
const CAMERA_PERMISSION = 'android.permission.CAMERA';
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

/** The window that currently has input focus, e.g. `com.iinpublic.app/com.iinpublic.app.MainActivity`. */
async function focusedWindow(serial: string): Promise<string> {
  const dump = await adb(serial, 'shell', 'dumpsys', 'window');
  const line = dump.split('\n').find((l) => /mCurrentFocus=/.test(l)) ?? '';
  return line.trim();
}

/** Dismiss the top dialog/picker (BACK = "not now" for a permission dialog and cancel for a picker). */
async function pressBack(serial: string): Promise<void> {
  await adb(serial, 'shell', 'input', 'keyevent', 'KEYCODE_BACK');
}

async function dismissWalkthrough(user: AndroidUser): Promise<void> {
  if (await user.window.locator('[data-testid="walkthrough-modal"]').isVisible().catch(() => false)) {
    await user.window.locator('[data-testid="walkthrough-close-btn"]').click();
    await expect(user.window.locator('[data-testid="walkthrough-modal"]')).toHaveCount(0);
  }
}

for (const serial of SERIALS) {
  test.describe(`Android camera + file-picker permissions on ${serial}`, () => {
    test.skip(!RUN, 'Set E2E_REAL_ANDROID_CAMERA=1 (debug build installed) to run the physical-device permission test.');

    let user: AndroidUser | undefined;
    test.afterEach(async () => {
      await closeAndroidUser(user);
      user = undefined;
      // Leave the phone as we found it for whoever runs next.
      await adb(serial, 'shell', 'pm', 'revoke', ANDROID_PACKAGE, CAMERA_PERMISSION).catch(() => undefined);
    });

    test('the package requests CAMERA (so Android can offer a toggle) and never RECORD_AUDIO', async () => {
      test.skip(!(await isAndroidDeviceReady(serial)), `${serial} unavailable`);
      const dump = await adb(serial, 'shell', 'dumpsys', 'package', ANDROID_PACKAGE);
      const requested = dump.split('requested permissions:')[1]?.split(/install permissions:|runtime permissions:/)[0] ?? '';
      expect(requested).toContain(CAMERA_PERMISSION);
      expect(requested).not.toContain('android.permission.RECORD_AUDIO');
    });

    test('getUserMedia raises the system dialog when denied, and returns a live track once granted', async () => {
      test.setTimeout(240_000);
      test.skip(!(await isAndroidDeviceReady(serial)), `${serial} unavailable`);
      const hubGunUrl = `http://${lanIp()}:${HUB_GUN_PORT}/gun`;
      await adb(serial, 'shell', 'pm', 'revoke', ANDROID_PACKAGE, CAMERA_PERMISSION).catch(() => undefined);
      user = await launchAndroidUserViaAdb({ hubGunUrl, deviceSerial: serial });
      await expect(user.window.locator('#app')).toBeVisible({ timeout: 45_000 });

      // The embedded node is served from 127.0.0.1, a secure context, so the API must exist at all.
      expect(await user.window.evaluate(() => typeof navigator.mediaDevices?.getUserMedia)).toBe('function');

      // --- denied path: a real system prompt, not a silent denial ---
      await user.window.evaluate(() => {
        (window as any).__cameraProbe = navigator.mediaDevices
          .getUserMedia({ video: { facingMode: 'user' }, audio: false })
          .then(
            (stream) => {
              stream.getTracks().forEach((t) => t.stop());
              return { ok: true as const };
            },
            (err: any) => ({ ok: false as const, name: String(err?.name || err) }),
          );
      });
      await expect
        .poll(async () => focusedWindow(serial), {
          timeout: 20_000,
          message: 'the Android runtime-permission dialog should take focus',
        })
        .toMatch(/GrantPermissionsActivity|permissioncontroller|packageinstaller/i);
      await pressBack(serial); // dismiss without allowing
      const denied = await user.window.evaluate(() => (window as any).__cameraProbe);
      expect(denied).toEqual({ ok: false, name: 'NotAllowedError' });
      // Denying via BACK must not have granted anything.
      expect(await adb(serial, 'shell', 'dumpsys', 'package', ANDROID_PACKAGE)).not.toMatch(
        new RegExp(`${CAMERA_PERMISSION.replace(/\./g, '\\.')}: granted=true`),
      );

      // --- granted path ---
      await adb(serial, 'shell', 'pm', 'grant', ANDROID_PACKAGE, CAMERA_PERMISSION);
      const granted = await user.window.evaluate(async () => {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
        const track = stream.getVideoTracks()[0];
        const info = { kind: track?.kind, live: track?.readyState === 'live', audioTracks: stream.getAudioTracks().length };
        stream.getTracks().forEach((t) => t.stop());
        return info;
      });
      expect(granted).toEqual({ kind: 'video', live: true, audioTracks: 0 });
    });

    test('Settings "Take photo" shows the live preview instead of "Camera access was denied" once Camera is allowed', async () => {
      test.setTimeout(240_000);
      test.skip(!(await isAndroidDeviceReady(serial)), `${serial} unavailable`);
      const hubGunUrl = `http://${lanIp()}:${HUB_GUN_PORT}/gun`;
      await adb(serial, 'shell', 'pm', 'grant', ANDROID_PACKAGE, CAMERA_PERMISSION);
      user = await launchAndroidUserViaAdb({ hubGunUrl, deviceSerial: serial });
      await expect(user.window.locator('#app')).toBeVisible({ timeout: 45_000 });
      await dismissWalkthrough(user);
      await user.window.locator('.nav-btn[data-view="settings"]').click();
      await afterNav();
      await openSettingsSection(user.window, SETTINGS_SECTION.profile);

      await user.window.locator('#settings-take-photo-btn').click();
      await expect(user.window.locator('#settings-camera-capture-modal')).toBeVisible({ timeout: 20_000 });
      await expect(user.window.locator('[data-testid="settings-camera-capture"]')).toBeEnabled({ timeout: 20_000 });
      await user.window.locator('[data-testid="settings-camera-cancel"]').click();
      await expect(user.window.locator('#settings-camera-capture-modal')).toHaveCount(0);
    });

    test('Settings "Choose photo" opens the system file picker', async () => {
      test.setTimeout(240_000);
      test.skip(!(await isAndroidDeviceReady(serial)), `${serial} unavailable`);
      const hubGunUrl = `http://${lanIp()}:${HUB_GUN_PORT}/gun`;
      user = await launchAndroidUserViaAdb({ hubGunUrl, deviceSerial: serial });
      await expect(user.window.locator('#app')).toBeVisible({ timeout: 45_000 });
      await dismissWalkthrough(user);
      await user.window.locator('.nav-btn[data-view="settings"]').click();
      await afterNav();
      await openSettingsSection(user.window, SETTINGS_SECTION.profile);

      expect(await focusedWindow(serial)).toContain(ANDROID_PACKAGE);
      // Playwright's own file-chooser interception would mask the bug; a raw click exercises
      // WebChromeClient.onShowFileChooser on the device.
      await user.window.locator('#settings-choose-photo-btn').click({ noWaitAfter: true });
      await expect
        .poll(async () => focusedWindow(serial), {
          timeout: 20_000,
          message: 'the system document picker should take focus (previously nothing happened)',
        })
        .not.toContain(ANDROID_PACKAGE);
      await pressBack(serial); // cancel the picker
      await expect
        .poll(async () => focusedWindow(serial), { timeout: 20_000 })
        .toContain(ANDROID_PACKAGE);
    });
  });
}
