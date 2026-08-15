import { _android as android, chromium, type AndroidDevice, type Browser, type Page } from '@playwright/test';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export const ANDROID_PACKAGE = 'com.iinpublic.app';
export const ANDROID_MAIN_ACTIVITY = `${ANDROID_PACKAGE}/.MainActivity`;

export type AndroidUser = {
  device?: AndroidDevice;
  deviceSerial: string;
  window: Page;
  cdpBrowser?: Browser;
  cdpForwardPort?: number;
};

async function waitForAndroidApp(
  user: Omit<AndroidUser, 'window'> & { window: Page },
): Promise<AndroidUser> {
  const { window, deviceSerial } = user;
  const diagnostics: string[] = [];
  window.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') diagnostics.push(`console:${message.type()}:${message.text()}`);
  });
  window.on('pageerror', (error) => diagnostics.push(`pageerror:${error.message}`));
  const deadline = Date.now() + 110_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      await window.goto('http://127.0.0.1:8088/?native_platform=android', {
        waitUntil: 'domcontentloaded',
        timeout: 5_000,
      });
      await window.waitForFunction(
        () => {
          const app = (window as any).__iinpublic_app?.getApp?.();
          return app?.initialized === true && Boolean(app?.currentUser?.id);
        },
        undefined,
        { timeout: Math.max(1_000, deadline - Date.now()) },
      );
      return user;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(
    `Android embedded SPA did not become reachable on ${deviceSerial}: ${String(lastError || 'timeout')}` +
      `${diagnostics.length ? `; diagnostics=${diagnostics.slice(-10).join(' | ')}` : ''}`,
  );
}

/** Deterministic multi-phone path that bypasses Playwright's experimental adb enumerator. */
export async function launchAndroidUserViaAdb(options: LaunchAndroidUserOptions & { deviceSerial: string }): Promise<AndroidUser> {
  const serial = options.deviceSerial;
  await execFileAsync('adb', ['-s', serial, 'shell', 'am', 'force-stop', ANDROID_PACKAGE]);
  await execFileAsync('adb', [
    '-s', serial, 'shell', 'am', 'start', '-n', ANDROID_MAIN_ACTIVITY,
    '--es', 'hub_gun_url', options.hubGunUrl,
  ]);
  const deadline = Date.now() + 30_000;
  let pid = '';
  while (Date.now() < deadline && !/^\d+$/.test(pid)) {
    const result = await execFileAsync('adb', ['-s', serial, 'shell', 'pidof', ANDROID_PACKAGE]).catch(() => ({ stdout: '' }));
    pid = String(result.stdout).trim();
    if (!/^\d+$/.test(pid)) await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!/^\d+$/.test(pid)) throw new Error(`IinPublic process did not start on ${serial}`);
  const cdpForwardPort = 19_300 + [...serial].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 1_000;
  await execFileAsync('adb', [
    '-s', serial, 'forward', `tcp:${cdpForwardPort}`,
    `localabstract:webview_devtools_remote_${pid}`,
  ]);
  let cdpBrowser: Browser | undefined;
  for (let attempt = 0; attempt < 30 && !cdpBrowser; attempt += 1) {
    cdpBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpForwardPort}`).catch(() => undefined);
    if (!cdpBrowser) await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!cdpBrowser) throw new Error(`WebView CDP endpoint did not open on ${serial}`);
  const context = cdpBrowser.contexts()[0];
  const window = context.pages()[0] || await context.newPage();
  return waitForAndroidApp({ deviceSerial: serial, window, cdpBrowser, cdpForwardPort });
}

/** Reset only high-volume E2E projections while preserving SEA identity and preferences. */
export async function resetAndroidE2ETestState(user: AndroidUser): Promise<AndroidUser> {
  await user.window.evaluate(async () => {
    // Clearing Gun's cache must not strand a profile that has not yet reached the relay.
    // Publish the current public record first so initialization can resolve the same user id.
    const currentUser = (window as any).__iinpublic_app?.getApp?.()?.currentUser;
    if (currentUser?.id) {
      const response = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(currentUser),
      });
      if (!response.ok) throw new Error(`Could not preserve Android test identity: ${response.status}`);
      // The API acknowledges after scheduling its Gun putFast; allow that graph write to
      // propagate before deleting this WebView's only cached copy and reloading.
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    const volatileKeys = [
      'peerNameCache',
      'myTalks',
      'myAuthoredTalks',
      'myReceivedTalks',
      'localTalkExchanges',
      'myConversations',
      'myAnswerHistory',
      'talkLedger',
    ];
    for (const key of volatileKeys) localStorage.removeItem(key);
    // Gun's localStorage adapter uses a `gun/`-prefixed graph cache. A reused phone can
    // otherwise carry megabytes of earlier E2E graph history and exhaust WebView's quota.
    // The relay remains authoritative and repopulates current graph data after reload.
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (key?.startsWith('gun/')) localStorage.removeItem(key);
    }
  });
  await user.window.reload({ waitUntil: 'domcontentloaded', timeout: 15_000 });
  return waitForAndroidApp(user);
}

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

  let window: Page;
  let cdpBrowser: Browser | undefined;
  let cdpForwardPort: number | undefined;
  try {
    const webView = await device.webView({ pkg: ANDROID_PACKAGE }, { timeout: 30_000 });
    window = await webView.page();
  } catch (discoveryError) {
    // Playwright's experimental Android enumerator misses the WebView on some models even
    // though the standard @webview_devtools_remote_<pid> socket exists. Attach to that same
    // socket explicitly through an adb forward and ordinary CDP.
    const pid = (await device.shell(`pidof ${ANDROID_PACKAGE}`)).toString().trim();
    if (!/^\d+$/.test(pid)) throw discoveryError;
    const serial = device.serial();
    cdpForwardPort = 19_300 + [...serial].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 1_000;
    await execFileAsync('adb', [
      '-s', serial,
      'forward', `tcp:${cdpForwardPort}`,
      `localabstract:webview_devtools_remote_${pid}`,
    ]);
    cdpBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpForwardPort}`);
    const context = cdpBrowser.contexts()[0];
    window = context.pages()[0] || await context.newPage();
  }
  return waitForAndroidApp({ device, deviceSerial: device.serial(), window, cdpBrowser, cdpForwardPort });
}

export async function closeAndroidUser(user: AndroidUser | undefined): Promise<void> {
  if (!user) return;
  await user.device?.shell(`am force-stop ${ANDROID_PACKAGE}`).catch(() => {});
  if (!user.device) {
    await execFileAsync('adb', ['-s', user.deviceSerial, 'shell', 'am', 'force-stop', ANDROID_PACKAGE]).catch(() => {});
  }
  await user.cdpBrowser?.close().catch(() => {});
  if (user.cdpForwardPort) {
    await execFileAsync('adb', ['-s', user.deviceSerial, 'forward', '--remove', `tcp:${user.cdpForwardPort}`]).catch(() => {});
  }
  await user.device?.close().catch(() => {});
}
