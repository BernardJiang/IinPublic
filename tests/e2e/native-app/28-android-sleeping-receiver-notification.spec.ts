/**
 * OPEN-38 on real hardware: an Android 12+ phone (the C10 tablet, Android 14) freezes its WebView
 * page while dozing, so the page's mesh can't take delivery. The sender falls back to the
 * encrypted mailbox; the always-on foreground service's MailboxWatcher polls the embedded node's
 * mailbox and posts a "new activity" notification while the phone sleeps. Waking and opening the
 * app lets the page drain the mailbox, and the Talk appears.
 *
 * Phones: NATIVE_APP_ANDROID_SENDER (default the P30) sends; NATIVE_APP_ANDROID_SLEEPER (default
 * the C10 tablet) is put to sleep with `input keyevent KEYCODE_SLEEP` + `dumpsys deviceidle
 * force-idle`. Both phones' app data is reset — run with exclusive access to them.
 */
import { test, expect } from '@playwright/test';
import { execFile } from 'child_process';
import * as os from 'os';
import { promisify } from 'util';
import { bootstrapNativeWindow, forceJoinGlobal } from './helpers/native-app';
import {
  clearAndroidE2ETestProjections,
  closeAndroidUser,
  collectAndroidDiagnostics,
  isAndroidDeviceReady,
  launchAndroidUserViaAdb,
  resetAndroidAppData,
  type AndroidUser,
} from './helpers/native-app-android';
import { createTagTalkViaEditor, findIncomingTalkIdByTitle } from '../helpers/talk-demo-ui';

const execFileAsync = promisify(execFile);
const HUB_GUN_PORT = Number(process.env.NATIVE_APP_E2E_GUN_PORT || '9078');
const SENDER = process.env.NATIVE_APP_ANDROID_SENDER?.trim() || 'DUM0219418001663';
const SLEEPER = process.env.NATIVE_APP_ANDROID_SLEEPER?.trim() || 'PADC100013000534';
const RUN = process.env.E2E_REAL_ANDROID_SLEEP_NOTIFY === '1';
const NOTIFY_TIMEOUT_MS = Number(process.env.E2E_SLEEP_NOTIFY_TIMEOUT_MS || '240000');
// How long the receiver sleeps before the broadcast. 20 s exercises "page still alive in the
// background"; several minutes lets Android freeze the page so the mailbox watcher path runs.
const SLEEP_SETTLE_MS = Number(process.env.E2E_SLEEP_SETTLE_MS || '20000');

process.env.E2E_PORT_OFFSET = String(HUB_GUN_PORT - 8080);

function resolveLanIp(): string {
  if (process.env.NATIVE_APP_ANDROID_HOST) return process.env.NATIVE_APP_ANDROID_HOST;
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) return address.address;
    }
  }
  throw new Error('No LAN IPv4 address found; set NATIVE_APP_ANDROID_HOST.');
}

async function adb(serial: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('adb', ['-s', serial, 'shell', ...args], { timeout: 20_000, maxBuffer: 16 * 1024 * 1024 });
  return String(stdout);
}

/** True when our "new activity" notification is posted on the phone. */
async function hasActivityNotification(serial: string): Promise<boolean> {
  const dump = await adb(serial, 'dumpsys', 'notification', '--noredact').catch(() => '');
  // Match by channel, or by the activity notification's fixed id (MailboxWatcher NOTIF_ID = 2):
  // MagicOS masks the channel in records ("channel=***") even with --noredact.
  return dump.split('\n').some((line) => line.includes('pkg=com.iinpublic.app')
    && (line.includes('iinpublic_activity') || /\bid=2\b/.test(line)));
}

async function sleepPhone(serial: string): Promise<void> {
  await adb(serial, 'input', 'keyevent', 'KEYCODE_HOME');
  await adb(serial, 'input', 'keyevent', 'KEYCODE_SLEEP');
  // E2E_SLEEP_FORCE_IDLE=0 measures an ordinary screen-off phone (light idle first) instead of
  // forcing deep Doze immediately.
  if (process.env.E2E_SLEEP_FORCE_IDLE !== '0') await adb(serial, 'dumpsys', 'deviceidle', 'force-idle').catch(() => '');
}

async function wakePhone(serial: string): Promise<void> {
  await adb(serial, 'dumpsys', 'deviceidle', 'unforce').catch(() => '');
  await adb(serial, 'input', 'keyevent', 'KEYCODE_WAKEUP');
  await adb(serial, 'wm', 'dismiss-keyguard').catch(() => '');
  await adb(serial, 'am', 'start', '-n', 'com.iinpublic.app/.MainActivity');
}

test.describe('Native app: a sleeping Android 12+ phone is notified of a Talk (OPEN-38)', () => {
  test.skip(!RUN, 'Set E2E_REAL_ANDROID_SLEEP_NOTIFY=1 to run the physical sleeping-receiver test.');

  let sender: AndroidUser | undefined;
  let sleeper: AndroidUser | undefined;

  test.afterAll(async () => {
    await wakePhone(SLEEPER).catch(() => {});
    for (const user of [sender, sleeper]) {
      if (user) await clearAndroidE2ETestProjections(user).catch(() => {});
      await closeAndroidUser(user);
    }
  });

  test.afterEach(async ({}, testInfo) => {
    if (testInfo.status === testInfo.expectedStatus) return;
    for (const serial of [SENDER, SLEEPER]) {
      const diagnostics = await collectAndroidDiagnostics(serial);
      await testInfo.attach(`${serial}-logcat.txt`, { body: Buffer.from(diagnostics.logcat), contentType: 'text/plain' });
    }
  });

  test('sleeping receiver gets a notification, then the Talk on wake', async () => {
    test.setTimeout(600_000 + SLEEP_SETTLE_MS);
    test.skip(!(await isAndroidDeviceReady(SENDER)) || !(await isAndroidDeviceReady(SLEEPER)), 'Both phones must be connected via adb.');
    const lanHubUrl = `http://${resolveLanIp()}:${HUB_GUN_PORT}/gun`;

    // Both screens must be on and unlocked before the app is driven (a dark/locked screen leaves
    // the WebView unresponsive to UI automation).
    for (const serial of [SENDER, SLEEPER]) {
      await adb(serial, 'input', 'keyevent', 'KEYCODE_WAKEUP');
      await adb(serial, 'wm', 'dismiss-keyguard').catch(() => '');
      // OEM system sheets (e.g. Huawei's "Use USB to" after a USB re-enumeration) sit over the app
      // and stop its page from rendering; BACK dismisses them.
      await adb(serial, 'input', 'keyevent', 'KEYCODE_BACK').catch(() => '');
      await adb(serial, 'cmd', 'statusbar', 'collapse').catch(() => '');
      await adb(serial, 'cmd', 'notification', 'cancel_all').catch(() => '');
    }
    await Promise.all([resetAndroidAppData(SENDER), resetAndroidAppData(SLEEPER)]);
    sender = await launchAndroidUserViaAdb({ hubGunUrl: lanHubUrl, deviceSerial: SENDER, disableLanDiscovery: true });
    await bootstrapNativeWindow(sender.window, 'sleep-sender', { waitForSupportGreeting: false, readinessTimeoutMs: 110_000, pinStableLocation: false });
    sleeper = await launchAndroidUserViaAdb({ hubGunUrl: lanHubUrl, deviceSerial: SLEEPER, disableLanDiscovery: true });
    await bootstrapNativeWindow(sleeper.window, 'sleep-receiver', { waitForSupportGreeting: false, readinessTimeoutMs: 110_000, pinStableLocation: false });
    await Promise.all([forceJoinGlobal(sender.window), forceJoinGlobal(sleeper.window)]);

    const title = `open38-sleep-${Date.now()}`;
    const talk = await createTagTalkViaEditor(sender.window, { title, timeoutMs: 90_000 });
    expect(await hasActivityNotification(SLEEPER)).toBe(false);

    // Receiver goes to sleep; give Android time to freeze the WebView page.
    await sleepPhone(SLEEPER);
    await sender.window.waitForTimeout(SLEEP_SETTLE_MS);

    // A real room broadcast (the Broadcast button's path). The frozen receiver can't ACK, so the
    // sender's flood/ack loop falls back to the mailbox.
    const sent = await sender.window.evaluate(
      () => (window as any).__iinpublic_app?.getApp?.()?.deliverPendingBroadcastTalksForE2e?.(1),
    );
    console.log('[open38] broadcast result', JSON.stringify(sent));

    const startedAt = Date.now();
    await expect.poll(() => hasActivityNotification(SLEEPER), {
      message: 'activity notification on the sleeping phone',
      timeout: NOTIFY_TIMEOUT_MS,
      intervals: [5_000],
    }).toBe(true);
    console.log(`[open38] notification after ${Math.round((Date.now() - startedAt) / 1000)} s asleep`);

    // Wake and open: the page drains the mailbox and the Talk shows up.
    await wakePhone(SLEEPER);
    await expect.poll(async () => {
      try {
        return await findIncomingTalkIdByTitle(sleeper!.window, title);
      } catch {
        return '';
      }
    }, { message: 'talk delivered after wake', timeout: 120_000, intervals: [3_000] }).toBe(talk.talkId);
  });
});
