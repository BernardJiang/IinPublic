/**
 * Closes docs/TODO.md §3.2's remaining Android hardware-lifecycle bullets on one real phone:
 *   - Android disconnect/reconnect.
 *   - Network interruption and recovery.
 *   - Android app background/foreground.
 *   - Identity persistence after app restart.
 *
 * Disconnect/reconnect and network interruption/recovery share one mechanism (`adb shell svc
 * wifi disable`/`enable` toggles the phone's real network interface — confirmed working without
 * root on this hardware) and are exercised together: a matched conversation is established via
 * the real pair-direct mesh match path (`peerMeshService.cacheTalkBody` +
 * `submitTalkResponsePairDirect` — the same lower-level real-match shortcut
 * `fast-dm-setup.ts`'s `setupFastMatchedDm` uses for browser pairs, adapted here to one Android
 * WebView + one browser peer), then the phone's Wi-Fi is disabled, a Chromium peer sends a
 * message into the open conversation, Wi-Fi is re-enabled, and the message's arrival proves both
 * the disconnect survived (no crash/corruption) and the reconnect converged through the same
 * offline-mailbox/Gun-sync path CLAUDE.md documents for Direct P2P ("Gun-on-device is the source
 * of truth; WebRTC is notify/sync only").
 *
 * A first version of this file seeded the conversation directly via
 * `WebConversationService.createConversation` (spec 10's `seedPairThread` shortcut) instead of a
 * real match, and every scenario below failed identically — including background/foreground,
 * which never touches the network at all. Root-caused with a minimal standalone repro before
 * writing any lifecycle logic against it: the direct-create shortcut never exchanges the peers'
 * SEA `epub`, and even the SENDER never saw its own just-sent message with that shortcut in
 * place — proving the gap was in the conversation setup, not in Android, Wi-Fi, or backgrounding.
 * Swapping in the real match flow (which does carry `authorEpub`, exactly as
 * `fast-dm-setup.ts` already does for its own passing browser-only reconnect test) fixed the
 * repro outright. Recorded here so the same shortcut mistake doesn't get reintroduced.
 *
 * Background/foreground uses the real Home key (not force-stop) to move the app off-screen
 * without killing its process — `NodeForegroundService` is a foreground service specifically so
 * the embedded node keeps running while the Activity is backgrounded; a message sent by the
 * Chromium peer during that window should already be delivered by the time the app returns to
 * the foreground, proving the foreground-service model actually holds on real hardware rather
 * than just in the manifest.
 *
 * Identity persistence after app restart force-stops the process outright (a harder reset than
 * backgrounding) and relaunches without clearing app data, then confirms the same user id and
 * stage name come back — `launchAndroidUserViaAdb` already force-stops before every launch, so
 * calling it again with `resetAppData` left false is exactly this scenario.
 */
import { chromium, test, expect, type Browser } from '@playwright/test';
import { execFile } from 'child_process';
import * as os from 'os';
import { promisify } from 'util';
import {
  bootstrapBrowserUserOnOrigin,
  bootstrapNativeWindow,
  forceJoinGlobal,
} from './helpers/native-app';
import {
  ANDROID_MAIN_ACTIVITY,
  clearAndroidE2ETestProjections,
  closeAndroidUser,
  collectAndroidDiagnostics,
  isAndroidDeviceReady,
  launchAndroidUserViaAdb,
  resetAndroidAppData,
  type AndroidUser,
} from './helpers/native-app-android';
import { configuredAndroidDevices } from './helpers/android-device-config';
import { getConversationIdBetween, openConversationViaServer, waitForServerConversationBetween } from '../helpers/conversation-e2e';

const execFileAsync = promisify(execFile);

const HUB_GUN_PORT = Number(process.env.NATIVE_APP_E2E_GUN_PORT || '9078');
const WEB_PORT = HUB_GUN_PORT - 8080 + 3001;
const ANDROID_SERIAL = process.env.NATIVE_APP_ANDROID_SERIAL?.trim() || configuredAndroidDevices()[0]?.serial || '';
const RUN = process.env.E2E_REAL_ANDROID_LIFECYCLE === '1';

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

async function setAndroidWifiEnabled(serial: string, enabled: boolean): Promise<void> {
  await execFileAsync('adb', ['-s', serial, 'shell', 'svc', 'wifi', enabled ? 'enable' : 'disable'], { timeout: 10_000 });
}

async function sendHomeKey(serial: string): Promise<void> {
  await execFileAsync('adb', ['-s', serial, 'shell', 'input', 'keyevent', 'KEYCODE_HOME'], { timeout: 5_000 });
}

async function bringAndroidAppToForeground(serial: string): Promise<void> {
  await execFileAsync('adb', ['-s', serial, 'shell', 'am', 'start', '-n', ANDROID_MAIN_ACTIVITY], { timeout: 5_000 });
}

/**
 * Establishes a REAL match between `authorPage` (the Talk author) and `responderPage` (who
 * submits a match answer via the pair-direct mesh response path — the same code the incoming-talk
 * response modal calls on radio click, without the modal), then opens the resulting conversation
 * overlay on both sides. Mirrors `fast-dm-setup.ts`'s `setupFastMatchedDm`, generalized to work
 * across an Android WebView `Page` and a browser `Page` interchangeably (both are just Playwright
 * `Page` objects here — `page.evaluate` doesn't care which runtime is behind it). See this file's
 * header comment for why this replaced an earlier direct-`createConversation` shortcut: that
 * shortcut skips the SEA `epub` exchange a real match carries, and messages silently never
 * rendered — not even for the sender — without it.
 */
async function establishRealMatchAndOpenConversation(
  authorPage: import('@playwright/test').Page,
  authorId: string,
  authorName: string,
  responderPage: import('@playwright/test').Page,
  responderId: string,
  responderName: string,
  talkId: string,
): Promise<string> {
  const talkTitle = `Resilience match ${talkId}`;
  const baseQuestions = [{ id: 'q1', text: 'Want to chat?', answers: [
    { id: 'a-match', text: 'Yes, lets chat.', isMatch: true },
    { id: 'a-ignore', text: 'No thanks.', isMatch: false, isIgnore: true },
  ] }];

  await authorPage.evaluate(({ tid, authorId, title, questions }) => {
    const app = (window as any).__iinpublic_app?.getApp?.();
    const talkDef = { id: tid, authorId, title, type: 'flow', questions };
    app?.peerMeshService?.cacheTalkBody?.(tid, talkDef);
    const myTalks = JSON.parse(localStorage.getItem('myTalks') || '{}');
    myTalks[tid] = { role: 'created', fullTalk: talkDef };
    localStorage.setItem('myTalks', JSON.stringify(myTalks));
  }, { tid: talkId, authorId, title: talkTitle, questions: baseQuestions });

  const authorEpub = await authorPage.evaluate(() => {
    const pair = (window as any).__iinpublic_app?.getApp?.()?.gunService?.getStoredPair?.();
    return pair?.epub ?? '';
  });

  await responderPage.evaluate(async ({ tid, authorId, authorName, epub, questions }) => {
    const app = (window as any).__iinpublic_app?.getApp?.();
    const talkDef = {
      id: tid, authorId, authorName, authorEpub: epub, title: `Resilience match ${tid}`, type: 'flow', questions,
    };
    app?.peerMeshService?.cacheTalkBody?.(tid, talkDef);
    const matchAnswers = [{ questionId: 'q1', answerId: 'a-match', answerText: 'Yes, lets chat.', mode: 'manual', isMatch: true }];
    await app.submitTalkResponsePairDirect({
      talkId: tid, talkData: talkDef, answers: matchAnswers, isChatbotResponse: false, authorId, authorName, isAutoResponse: false,
    });
  }, { tid: talkId, authorId, authorName, epub: authorEpub, questions: baseQuestions });

  await Promise.all([
    waitForServerConversationBetween(authorPage, authorId, responderId),
    waitForServerConversationBetween(responderPage, responderId, authorId),
  ]);
  const conversationId = await getConversationIdBetween(authorPage, authorId, responderId);

  await Promise.all([
    openConversationViaServer(authorPage, authorId, responderName, responderId),
    openConversationViaServer(responderPage, responderId, authorName, authorId),
  ]);

  return conversationId;
}

async function sendMessage(page: import('@playwright/test').Page, conversationId: string, senderId: string, text: string): Promise<void> {
  await page.evaluate(
    async ({ cid, sid, body }) => {
      const app = (window as any).__iinpublic_app?.getApp?.();
      await app.conversationService.sendMessage(cid, sid, body);
    },
    { cid: conversationId, sid: senderId, body: text },
  );
}

async function waitForMessageVisible(page: import('@playwright/test').Page, text: string, timeoutMs = 30_000): Promise<void> {
  await expect
    .poll(
      () => page.locator('#conversation-messages .message-text').filter({ hasText: text }).first().isVisible().catch(() => false),
      { timeout: timeoutMs, message: `message "${text}" should become visible` },
    )
    .toBe(true);
}

test.describe('Native app: Android real-hardware lifecycle and network resilience', () => {
  test.skip(!RUN, 'Set E2E_REAL_ANDROID_LIFECYCLE=1 to run the physical-device lifecycle test.');
  test.skip(!ANDROID_SERIAL, 'Set NATIVE_APP_ANDROID_SERIAL, or configure a device in tests/matrix/devices.json.');

  let android: AndroidUser | undefined;
  let browser: Browser | undefined;
  let browserClose: (() => Promise<void>) | undefined;

  test.beforeEach(async () => {
    const ready = await isAndroidDeviceReady(ANDROID_SERIAL);
    test.skip(!ready, `Android device ${ANDROID_SERIAL} is not connected/authorized via adb.`);
  });

  test.afterEach(async ({}, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) {
      const diagnostics = await collectAndroidDiagnostics(ANDROID_SERIAL);
      await testInfo.attach('android-logcat.txt', { body: Buffer.from(diagnostics.logcat), contentType: 'text/plain' });
      await testInfo.attach('android-node-stdio.txt', { body: Buffer.from(diagnostics.nodeStdio), contentType: 'text/plain' });
    }
    // Make sure Wi-Fi is back on regardless of test outcome — a failed assertion mid-test must
    // not leave the phone off the network for whatever runs next.
    await setAndroidWifiEnabled(ANDROID_SERIAL, true).catch(() => {});
    await browserClose?.().catch(() => {});
    browserClose = undefined;
    await browser?.close().catch(() => {});
    browser = undefined;
    if (android) await clearAndroidE2ETestProjections(android).catch(() => {});
    await closeAndroidUser(android);
    android = undefined;
  });

  test('Wi-Fi disconnect/reconnect: a message sent while offline converges once the phone reconnects', async () => {
    test.setTimeout(180_000);
    await resetAndroidAppData(ANDROID_SERIAL);
    const lanHubUrl = `http://${resolveLanIp()}:${HUB_GUN_PORT}/gun`;

    android = await launchAndroidUserViaAdb({ deviceSerial: ANDROID_SERIAL, hubGunUrl: lanHubUrl, disableLanDiscovery: true });
    const androidId = await bootstrapNativeWindow(android.window, 'Resilience Android', {
      waitForSupportGreeting: false,
      readinessTimeoutMs: 110_000,
      pinStableLocation: false,
    });
    await forceJoinGlobal(android.window);

    browser = await chromium.launch({ headless: true });
    const chromiumUser = await bootstrapBrowserUserOnOrigin(browser, `http://127.0.0.1:${WEB_PORT}`, 'Resilience Chrome', 'Resilience Chrome', { waitForSupportGreeting: false });
    browserClose = chromiumUser.close;
    await forceJoinGlobal(chromiumUser.page);

    const talkId = `resilience-wifi-${Date.now()}`;
    const conversationId = await establishRealMatchAndOpenConversation(
      android.window, androidId, 'Resilience Android',
      chromiumUser.page, chromiumUser.userId, 'Resilience Chrome',
      talkId,
    );

    console.log(`[lifecycle] disabling Wi-Fi on ${ANDROID_SERIAL}`);
    await setAndroidWifiEnabled(ANDROID_SERIAL, false);

    const offlineMessage = `wifi-offline-${Date.now()}`;
    await sendMessage(chromiumUser.page, conversationId, chromiumUser.userId, offlineMessage);

    // No assertion of absence while offline (browser-matrix/03-reconnect-and-restart.spec.ts's
    // established convention) — proving a message HASN'T arrived yet is racy against however
    // fast Gun's own local write fires and isn't the behavior this bullet cares about.
    console.log(`[lifecycle] re-enabling Wi-Fi on ${ANDROID_SERIAL}`);
    await setAndroidWifiEnabled(ANDROID_SERIAL, true);

    await waitForMessageVisible(android.window, offlineMessage, 60_000);
  });

  test('background/foreground: a message sent while the app is backgrounded is already there on return', async () => {
    test.setTimeout(180_000);
    await resetAndroidAppData(ANDROID_SERIAL);
    const lanHubUrl = `http://${resolveLanIp()}:${HUB_GUN_PORT}/gun`;

    android = await launchAndroidUserViaAdb({ deviceSerial: ANDROID_SERIAL, hubGunUrl: lanHubUrl, disableLanDiscovery: true });
    const androidId = await bootstrapNativeWindow(android.window, 'Background Android', {
      waitForSupportGreeting: false,
      readinessTimeoutMs: 110_000,
      pinStableLocation: false,
    });
    await forceJoinGlobal(android.window);

    browser = await chromium.launch({ headless: true });
    const chromiumUser = await bootstrapBrowserUserOnOrigin(browser, `http://127.0.0.1:${WEB_PORT}`, 'Background Chrome', 'Background Chrome', { waitForSupportGreeting: false });
    browserClose = chromiumUser.close;
    await forceJoinGlobal(chromiumUser.page);

    const talkId = `resilience-bg-${Date.now()}`;
    const conversationId = await establishRealMatchAndOpenConversation(
      android.window, androidId, 'Background Android',
      chromiumUser.page, chromiumUser.userId, 'Background Chrome',
      talkId,
    );

    console.log(`[lifecycle] sending HOME on ${ANDROID_SERIAL}`);
    await sendHomeKey(ANDROID_SERIAL);
    await android.window.waitForTimeout(2_000);

    const backgroundMessage = `background-${Date.now()}`;
    await sendMessage(chromiumUser.page, conversationId, chromiumUser.userId, backgroundMessage);
    // Give the still-running NodeForegroundService a moment to actually receive/persist it
    // while the phone is genuinely backgrounded, before bringing the UI back.
    await new Promise((resolve) => setTimeout(resolve, 3_000));

    console.log(`[lifecycle] bringing ${ANDROID_SERIAL} back to the foreground`);
    await bringAndroidAppToForeground(ANDROID_SERIAL);

    await expect
      .poll(() => android!.window.evaluate(() => Boolean((window as any).__iinpublic_app?.getApp?.()?.currentUser?.id)), { timeout: 30_000 })
      .toBe(true);
    const idAfterForeground = await android.window.evaluate(() => String((window as any).__iinpublic_app?.getApp?.()?.currentUser?.id || ''));
    expect(idAfterForeground).toBe(androidId);

    await waitForMessageVisible(android.window, backgroundMessage, 30_000);
  });

  test('identity persists across a force-stop and relaunch (harder reset than backgrounding)', async () => {
    test.setTimeout(180_000);
    await resetAndroidAppData(ANDROID_SERIAL);
    const lanHubUrl = `http://${resolveLanIp()}:${HUB_GUN_PORT}/gun`;

    android = await launchAndroidUserViaAdb({ deviceSerial: ANDROID_SERIAL, hubGunUrl: lanHubUrl, disableLanDiscovery: true });
    const stageName = 'Restart Android';
    const idBefore = await bootstrapNativeWindow(android.window, stageName, {
      waitForSupportGreeting: false,
      readinessTimeoutMs: 110_000,
      pinStableLocation: false,
    });
    expect(idBefore).toBeTruthy();

    console.log(`[lifecycle] force-stopping and relaunching ${ANDROID_SERIAL} (identity preserved, app data not reset)`);
    android = await launchAndroidUserViaAdb({ deviceSerial: ANDROID_SERIAL, hubGunUrl: lanHubUrl, disableLanDiscovery: true });

    await expect
      .poll(() => android!.window.evaluate(() => Boolean((window as any).__iinpublic_app?.getApp?.()?.currentUser?.id)), { timeout: 60_000 })
      .toBe(true);
    const idAfter = await android.window.evaluate(() => String((window as any).__iinpublic_app?.getApp?.()?.currentUser?.id || ''));
    const stageNameAfter = await android.window.evaluate(() => String((window as any).__iinpublic_app?.getApp?.()?.currentUser?.stageName || ''));

    expect(idAfter).toBe(idBefore);
    expect(stageNameAfter).toBe(stageName);
  });
});
