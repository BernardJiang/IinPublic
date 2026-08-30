import {
  _android as android,
  chromium,
  type AndroidDevice,
  type AndroidWebView,
  type Browser,
  type Page,
} from '@playwright/test';
import { execFile } from 'child_process';
import * as http from 'http';
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

async function settleWithin(work: Promise<unknown>, timeoutMs: number): Promise<void> {
  await resolveWithin(work.catch(() => undefined), timeoutMs).catch(() => undefined);
}

async function resolveWithin<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`operation timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function waitForAppProcessViaAdb(serial: string, timeoutMs = 30_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let pid = '';
  while (Date.now() < deadline) {
    const result = await execFileAsync(
      'adb',
      ['-s', serial, 'shell', 'pidof', ANDROID_PACKAGE],
      { timeout: 3_000 },
    ).catch(() => ({ stdout: '' }));
    pid = String(result.stdout).trim();
    if (/^\d+$/.test(pid)) return pid;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`IinPublic process did not start on ${serial}`);
}

function cdpForwardPortForSerial(serial: string): number {
  return 19_300 + [...serial].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 1_000;
}

function fetchCdpJson(port: number, requestPath: string): Promise<unknown | undefined> {
  return new Promise((resolve) => {
    const request = http.get(
      { host: '127.0.0.1', port, path: requestPath, timeout: 1_000 },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => { body += chunk; });
        response.on('end', () => {
          if (response.statusCode !== 200) {
            resolve(undefined);
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch {
            resolve(undefined);
          }
        });
      },
    );
    request.once('error', () => resolve(undefined));
    request.once('timeout', () => {
      request.destroy();
      resolve(undefined);
    });
  });
}

async function waitForCdpEndpoint(serial: string, pid: string, timeoutMs = 30_000): Promise<number> {
  const port = cdpForwardPortForSerial(serial);
  await execFileAsync(
    'adb',
    ['-s', serial, 'forward', `tcp:${port}`, `localabstract:webview_devtools_remote_${pid}`],
    { timeout: 5_000 },
  );
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [version, targets] = await Promise.all([
      fetchCdpJson(port, '/json/version'),
      fetchCdpJson(port, '/json/list'),
    ]);
    const pageReady = Array.isArray(targets) && targets.some((target) => {
      const row = target as { type?: unknown; url?: unknown };
      return row.type === 'page' && String(row.url || '').startsWith('http://127.0.0.1:8088/');
    });
    if (pageReady) {
      const browser = String((version as { Browser?: unknown } | undefined)?.Browser || '');
      const major = Number(browser.match(/Chrome\/(\d+)/)?.[1] || 0);
      // Chrome 101 on Android 7 advertises the page target before its default browser
      // context is attachable. Let that target settle before page() caches its connection.
      await new Promise((resolve) => setTimeout(resolve, major > 0 && major < 110 ? 15_000 : 1_000));
      return port;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`WebView CDP endpoint did not become ready on ${serial} (PID ${pid})`);
}

async function connectToAppWebView(
  device: AndroidDevice,
  pid: string,
  timeoutMs = 30_000,
): Promise<Page> {
  const deadline = Date.now() + timeoutMs;
  let views: AndroidWebView[] = [];
  let lastConnectionError: unknown;
  while (Date.now() < deadline) {
    views = device.webViews();
    // Android 7 WebView can report an empty package identifier even though its PID and
    // devtools socket are valid. PID is authoritative because it came from `pidof` after
    // this launch's force-stop/start cycle.
    const exactProcess = views.find((view) => String(view.pid()) === pid);
    if (exactProcess) {
      try {
        return await resolveWithin(
          exactProcess.page(),
          Math.min(15_000, Math.max(500, deadline - Date.now())),
        );
      } catch (error) {
        lastConnectionError = error;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `Playwright Android bridge did not expose WebView PID ${pid}; ` +
      `observed=${JSON.stringify(views.map((view) => ({ pid: view.pid(), pkg: view.pkg() })))}` +
      `${lastConnectionError ? `; connection=${String(lastConnectionError)}` : ''}`,
  );
}

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
  const fallbackNavigationAt = Date.now() + 15_000;
  let fallbackNavigationUsed = false;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      await window.waitForFunction(
        () => {
          const app = (window as any).__iinpublic_app?.getApp?.();
          return app?.initialized === true && Boolean(app?.currentUser?.id);
        },
        undefined,
        { timeout: Math.min(5_000, Math.max(1_000, deadline - Date.now())) },
      );
      return user;
    } catch (error) {
      lastError = error;
    }
    // MainActivity owns the initial navigation. Only intervene once if an unusual WebView never
    // receives that load (for example, CDP attached to a newly-created about:blank page).
    if (!fallbackNavigationUsed && Date.now() >= fallbackNavigationAt) {
      fallbackNavigationUsed = true;
      await window.goto('http://127.0.0.1:8088/?native_platform=android', {
        waitUntil: 'domcontentloaded',
        timeout: 5_000,
      }).catch((error) => { lastError = error; });
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
  await execFileAsync(
    'adb',
    ['-s', serial, 'shell', 'am', 'force-stop', ANDROID_PACKAGE],
    { timeout: 5_000 },
  );
  await execFileAsync('adb', [
    '-s', serial, 'shell', 'am', 'start', '-n', ANDROID_MAIN_ACTIVITY,
    '--es', 'hub_gun_url', options.hubGunUrl,
  ], { timeout: 5_000 });
  const pid = await waitForAppProcessViaAdb(serial);
  const cdpForwardPort = await waitForCdpEndpoint(serial, pid);
  // Prefer Playwright's Android WebView transport. It identifies the browser as mobile
  // Chromium ("clank") and therefore avoids browser-context commands unsupported by old
  // WebViews such as Chrome 101 on Android 7.
  // The experimental Android enumerator can remain pending forever after an
  // older phone's adb transport reconnects. Direct CDP below is a complete
  // fallback, so bound enumeration instead of stalling the entire matrix.
  const devices = await resolveWithin(
    android.devices({ omitDriverInstall: true }),
    10_000,
  ).catch((): AndroidDevice[] => []);
  const device = devices.find((candidate) => candidate.serial() === serial);
  let androidBridgeError: unknown;
  if (device) {
    try {
      const window = await connectToAppWebView(device, pid);
      return waitForAndroidApp({ device, deviceSerial: serial, window, cdpForwardPort });
    } catch (error) {
      androidBridgeError = error;
      // Retain the explicit adb/CDP path for devices whose Android WebView enumeration is
      // unavailable. Modern WebViews support the browser-level CDP commands used below.
    }
  }
  let cdpBrowser: Browser | undefined;
  let cdpError: unknown;
  for (let attempt = 0; attempt < 30 && !cdpBrowser; attempt += 1) {
    try {
      cdpBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpForwardPort}`);
    } catch (error) {
      cdpError = error;
    }
    if (!cdpBrowser) await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!cdpBrowser) {
    throw new Error(
      `WebView attach failed on ${serial}; ` +
        `bridge=${String(androidBridgeError || 'device not enumerated')}; directCDP=${String(cdpError || 'timeout')}`,
    );
  }
  const context = cdpBrowser.contexts()[0];
  const window = context.pages()[0] || await context.newPage();
  return waitForAndroidApp({ device, deviceSerial: serial, window, cdpBrowser, cdpForwardPort });
}

/** Remove high-volume test projections at teardown without navigating/restarting the SPA. */
export async function clearAndroidE2ETestProjections(user: AndroidUser): Promise<void> {
  await settleWithin(user.window.evaluate(() => {
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
  }), 3_000);
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

  const serial = device.serial();
  await execFileAsync(
    'adb',
    ['-s', serial, 'shell', 'am', 'force-stop', ANDROID_PACKAGE],
    { timeout: 5_000 },
  );
  await execFileAsync(
    'adb',
    ['-s', serial, 'shell', 'am', 'start', '-n', ANDROID_MAIN_ACTIVITY, '--es', 'hub_gun_url', options.hubGunUrl],
    { timeout: 5_000 },
  );

  let window: Page;
  let cdpBrowser: Browser | undefined;
  let cdpForwardPort: number | undefined;
  try {
    const pid = await waitForAppProcessViaAdb(serial);
    cdpForwardPort = await waitForCdpEndpoint(serial, pid);
    window = await connectToAppWebView(device, pid);
  } catch (discoveryError) {
    // Playwright's experimental Android enumerator misses the WebView on some models even
    // though the standard @webview_devtools_remote_<pid> socket exists. Attach to that same
    // socket explicitly through an adb forward and ordinary CDP.
    const pid = await waitForAppProcessViaAdb(serial);
    if (!/^\d+$/.test(pid)) throw discoveryError;
    cdpForwardPort = cdpForwardPort || await waitForCdpEndpoint(serial, pid);
    try {
      cdpBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpForwardPort}`);
    } catch (cdpError) {
      throw new Error(
        `Android WebView attach failed on ${device.serial()}; ` +
          `bridge=${String(discoveryError)}; directCDP=${String(cdpError)}`,
      );
    }
    const context = cdpBrowser.contexts()[0];
    window = context.pages()[0] || await context.newPage();
  }
  return waitForAndroidApp({ device, deviceSerial: device.serial(), window, cdpBrowser, cdpForwardPort });
}

export async function closeAndroidUser(user: AndroidUser | undefined): Promise<void> {
  if (!user) return;
  // Playwright's experimental Android backend can hang while closing a WebView on older
  // Huawei devices. Keep teardown deterministic by using bounded adb subprocesses and by
  // never awaiting an Android bridge close indefinitely.
  await settleWithin(
    execFileAsync(
      'adb',
      ['-s', user.deviceSerial, 'shell', 'am', 'force-stop', ANDROID_PACKAGE],
      { timeout: 5_000 },
    ),
    6_000,
  );
  if (user.cdpBrowser) await settleWithin(user.cdpBrowser.close(), 3_000);
  if (user.cdpForwardPort) {
    await settleWithin(
      execFileAsync(
        'adb',
        ['-s', user.deviceSerial, 'forward', '--remove', `tcp:${user.cdpForwardPort}`],
        { timeout: 5_000 },
      ),
      6_000,
    );
  }
  if (user.device) await settleWithin(user.device.close(), 3_000);
}
