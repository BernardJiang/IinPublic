import { _android as android, type AndroidDevice, type Page } from '@playwright/test';

export const ANDROID_PACKAGE = 'com.iinpublic.app';
export const ANDROID_MAIN_ACTIVITY = `${ANDROID_PACKAGE}/.MainActivity`;

export type AndroidUser = {
  device: AndroidDevice;
  window: Page;
};

export type LaunchAndroidUserOptions = {
  hubGunUrl: string;
  /** adb device serial (from `adb devices`) — required when more than one device/emulator
   *  is attached; the first detected device is used otherwise. */
  deviceSerial?: string;
};

/**
 * Attaches to a real device (or emulator) over adb and launches IinPublic pointed at a
 * specific hub. Requires, on this machine:
 *   - `adb devices` lists the target as `device` (not `unauthorized`/`offline`) — the phone
 *     must have USB debugging enabled and this Mac authorized on it
 *   - the debug APK is already installed (`npm run android:install`, or `adb install -r
 *     android/app/build/outputs/apk/debug/app-debug.apk`)
 *
 * And, in the app itself (already wired — see MainActivity.kt / NodeForegroundService.kt):
 *   - the debug build's `WebView.setWebContentsDebuggingEnabled(true)` call, which is what
 *     lets Playwright attach to the WebView over CDP/adb at all
 *   - `NodeForegroundService.HUB_GUN_URL_EXTRA` ("hub_gun_url"), an Intent extra MainActivity
 *     forwards from its own launch Intent to override the hardcoded production hub URL
 *
 * `am force-stop` before every launch matters: both `NodeForegroundService.nodeStarted` and
 * `NodeBridge`'s own `started` flag latch for the life of the app process, so relaunching an
 * already-running process with a *different* hub_gun_url extra would silently keep dialing
 * whichever hub the first launch used. Force-stopping guarantees a fresh process picks up
 * this call's override.
 */
export async function launchAndroidUser(options: LaunchAndroidUserOptions): Promise<AndroidUser> {
  const devices = await android.devices();
  const device = options.deviceSerial
    ? devices.find((d) => d.serial() === options.deviceSerial)
    : devices[0];
  if (!device) {
    throw new Error(
      options.deviceSerial
        ? `No adb device with serial "${options.deviceSerial}" found (adb devices: ${devices.map((d) => d.serial()).join(', ') || 'none'})`
        : 'No adb devices found — run `adb devices` and confirm the phone shows as "device", not "unauthorized"',
    );
  }

  await device.shell(`am force-stop ${ANDROID_PACKAGE}`);
  // Single-quoted shell arg; hub URLs in this codebase never contain a literal single quote
  // (LAN IP or hostname + :port + /gun), so no escaping beyond the wrapping quotes is needed.
  await device.shell(`am start -n ${ANDROID_MAIN_ACTIVITY} --es hub_gun_url '${options.hubGunUrl}'`);

  const webView = await device.webView({ pkg: ANDROID_PACKAGE }, { timeout: 30_000 });
  const window = await webView.page();
  return { device, window };
}

export async function closeAndroidUser(user: AndroidUser | undefined): Promise<void> {
  if (!user) return;
  await user.device.shell(`am force-stop ${ANDROID_PACKAGE}`).catch(() => {});
  await user.device.close().catch(() => {});
}
